import { Injectable } from '@nestjs/common';
import type { ImportJob, Prisma } from '@prisma/client';
import { isShenzhenCoordinate } from '@szfisher/shared';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { DictionariesRepository } from '../dictionaries/dictionaries.repository';
import { StorageService } from '../storage/storage.service';
import {
  MAX_IMPORT_ROWS,
  OPEN_STATUS_LABEL_TO_KEY,
  SOURCE_LABEL_TO_KEY,
} from './import.constants';
import {
  dataRowNumbers,
  loadImportWorkbook,
  rowValues,
  validateImportHeaders,
} from './import-excel';

interface RowIssue {
  row: number;
  level: 'error' | 'warning';
  field: string;
  message: string;
}

interface RowResult {
  data: Prisma.SpotUncheckedCreateInput | null;
  errors: Array<{ field: string; message: string }>;
}

interface DuplicateCandidate {
  spot_id: string;
  spot_name: string;
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function levenshtein(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length] ?? 0;
}

function namesAreSimilar(left: string, right: string): boolean {
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  return (
    left === right ||
    left.includes(right) ||
    right.includes(left) ||
    levenshtein(left, right) <= 2
  );
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadius = 6_371_000;
  const toRadians = (value: number): number => (value * Math.PI) / 180;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function splitList(value: string): string[] {
  return value
    .split(/[;；]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function csvEscape(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

@Injectable()
export class ImportWorker {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaries: DictionariesRepository,
    private readonly storage: StorageService,
  ) {}

  async process(jobId: string): Promise<void> {
    const claimed = await this.prisma.importJob.updateMany({
      where: { job_id: jobId, status: 'pending' },
      data: { status: 'processing' },
    });
    if (claimed.count === 0) {
      return;
    }
    const job = await this.prisma.importJob.findUnique({ where: { job_id: jobId } });
    if (job === null) {
      return;
    }

    try {
      const buffer = await this.storage.readObject(job.file_key, 'working');
      const { worksheet, headerIndex } = await loadImportWorkbook(buffer);
      validateImportHeaders(headerIndex);
      const rowNumbers = dataRowNumbers(worksheet, headerIndex);
      if (rowNumbers.length === 0) {
        await this.failJob(job, 'Excel 中没有可导入的数据行');
        return;
      }
      if (rowNumbers.length > MAX_IMPORT_ROWS) {
        await this.failJob(job, `单次最多导入 ${MAX_IMPORT_ROWS} 行`);
        return;
      }

      const dictionaries = await this.dictionaryMaps();
      const issues: RowIssue[] = [];
      let successRows = 0;
      let failedRows = 0;

      for (const rowNumber of rowNumbers) {
        const values = rowValues(worksheet, headerIndex, rowNumber);
        const result = this.validateRow(values, dictionaries);
        if (result.data === null) {
          failedRows += 1;
          issues.push(
            ...result.errors.map((issue) => ({
              row: rowNumber,
              level: 'error' as const,
              field: issue.field,
              message: issue.message,
            })),
          );
          continue;
        }

        const warnings = await this.duplicateWarnings(result.data, rowNumber);
        issues.push(...warnings);
        try {
          await this.prisma.spot.create({ data: result.data });
          successRows += 1;
        } catch {
          failedRows += 1;
          issues.push({
            row: rowNumber,
            level: 'error',
            field: 'row',
            message: '数据库写入失败，请检查字段约束',
          });
        }
      }

      const errorFileKey =
        issues.length === 0
          ? null
          : `imports/${job.admin_id}/${job.job_id}-issues.csv`;
      if (errorFileKey !== null) {
        await this.storage.putObject(
          errorFileKey,
          Buffer.from(this.toCsv(issues), 'utf8'),
          'text/csv; charset=utf-8',
        );
      }
      await this.prisma.importJob.update({
        where: { job_id: job.job_id },
        data: {
          status: 'completed',
          total_rows: rowNumbers.length,
          success_rows: successRows,
          failed_rows: failedRows,
          error_file_key: errorFileKey,
          finished_at: new Date(),
        },
      });
    } catch (error) {
      await this.failJob(
        job,
        error instanceof Error ? `文件处理失败：${error.message}` : '文件处理失败',
      );
    }
  }

  private async failJob(job: ImportJob, message: string): Promise<void> {
    const issue: RowIssue = { row: 1, level: 'error', field: 'file', message };
    const errorFileKey = `imports/${job.admin_id}/${job.job_id}-issues.csv`;
    try {
      await this.storage.putObject(
        errorFileKey,
        Buffer.from(this.toCsv([issue]), 'utf8'),
        'text/csv; charset=utf-8',
      );
    } catch {
      // A failed report write must not leave the job in processing forever.
    }
    await this.prisma.importJob.update({
      where: { job_id: job.job_id },
      data: {
        status: 'failed',
        failed_rows: 1,
        error_file_key: errorFileKey,
        finished_at: new Date(),
      },
    });
  }

  private toCsv(issues: RowIssue[]): string {
    const lines = ['﻿row,level,field,message'];
    for (const issue of issues) {
      lines.push(
        [issue.row, issue.level, csvEscape(issue.field), csvEscape(issue.message)].join(','),
      );
    }
    return `${lines.join('\n')}\n`;
  }

  private async dictionaryMaps(): Promise<Map<string, Map<string, string>>> {
    const rows = await this.dictionaries.findEnabled();
    const maps = new Map<string, Map<string, string>>();
    for (const row of rows) {
      const map = maps.get(row.dict_type) ?? new Map<string, string>();
      map.set(row.dict_label.trim(), row.dict_key);
      maps.set(row.dict_type, map);
    }
    return maps;
  }

  private lookup(
    maps: Map<string, Map<string, string>>,
    type: string,
    label: string,
  ): string | undefined {
    return maps.get(type)?.get(label.trim());
  }

  private validateRow(
    values: Record<string, string>,
    dictionaries: Map<string, Map<string, string>>,
  ): RowResult {
    const errors: Array<{ field: string; message: string }> = [];
    const add = (field: string, message: string): void => {
      errors.push({ field, message });
    };
    const spotName = values.spot_name?.trim() ?? '';
    if (spotName.length === 0 || spotName.length > 60) {
      add('钓点名称', '必填，且不超过 60 字');
    }
    const address = values.address?.trim() ?? '';
    if (address.length === 0 || address.length > 120) {
      add('详细地址', '必填，且不超过 120 字');
    }

    const district = this.lookup(dictionaries, 'district', values.district ?? '');
    if (district === undefined) {
      add('区域', `未知区域：${values.district ?? ''}`);
    }

    const latitudeText = values.latitude?.trim() ?? '';
    const longitudeText = values.longitude?.trim() ?? '';
    const latitude = latitudeText === '' ? NaN : Number(latitudeText);
    const longitude = longitudeText === '' ? NaN : Number(longitudeText);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      add('坐标', '纬度和经度必填且为数字');
    } else if (!isShenzhenCoordinate(latitude, longitude)) {
      add('坐标', '坐标超出深圳范围');
    }

    let navLatitude = values.nav_latitude?.trim() ?? '';
    let navLongitude = values.nav_longitude?.trim() ?? '';
    if (navLatitude === '' && navLongitude === '') {
      navLatitude = latitudeText;
      navLongitude = longitudeText;
    } else if (navLatitude === '' || navLongitude === '') {
      add('导航坐标', '导航纬度和经度必须同时填写');
    } else if (!isShenzhenCoordinate(Number(navLatitude), Number(navLongitude))) {
      add('导航坐标', '导航坐标超出深圳范围');
    }

    const parkingLatitude = values.parking_latitude?.trim() ?? '';
    const parkingLongitude = values.parking_longitude?.trim() ?? '';
    if ((parkingLatitude === '') !== (parkingLongitude === '')) {
      add('停车场坐标', '停车场纬度和经度必须同时填写');
    } else if (
      parkingLatitude !== '' &&
      !isShenzhenCoordinate(Number(parkingLatitude), Number(parkingLongitude))
    ) {
      add('停车场坐标', '停车场坐标超出深圳范围');
    }

    const fishLabels = splitList(values.fish_types ?? '');
    if (fishLabels.length === 0) {
      add('鱼种', '至少填写一个鱼种');
    }
    const fishTypes: string[] = [];
    for (const label of fishLabels) {
      const key = this.lookup(dictionaries, 'fish_type', label);
      if (key === undefined) {
        add('鱼种', `未知鱼种：${label}`);
      } else {
        fishTypes.push(key);
      }
    }

    const feeStatus = this.lookup(dictionaries, 'fee_status', values.fee_status ?? '');
    if (feeStatus === undefined) {
      add('收费状态', '必须是启用的收费状态字典值');
    }
    const feeUnitText = values.fee_unit?.trim() ?? '';
    const feeUnit =
      feeUnitText === ''
        ? null
        : (this.lookup(dictionaries, 'fee_unit', feeUnitText) ?? null);
    if (feeUnitText !== '' && feeUnit === null) {
      add('收费单位', '未知收费单位');
    }
    const waterType = this.lookup(dictionaries, 'water_type', values.water_type ?? '');
    if (waterType === undefined) {
      add('水域类型', '必须是启用的水域类型字典值');
    }
    const venueType = this.lookup(dictionaries, 'venue_type', values.venue_type ?? '');
    if (venueType === undefined) {
      add('场所类型', '必须是启用的场所类型字典值');
    }
    const fishingMethods: string[] = [];
    for (const label of splitList(values.fishing_method ?? '')) {
      const key = this.lookup(dictionaries, 'fishing_method', label);
      if (key === undefined) {
        add('钓法', `未知钓法：${label}`);
      } else {
        fishingMethods.push(key);
      }
    }

    const openStatus = OPEN_STATUS_LABEL_TO_KEY[values.open_status?.trim() ?? ''];
    if (openStatus === undefined) {
      add('开放状态', '必须是开放、暂停或禁钓');
    }
    const source = SOURCE_LABEL_TO_KEY[values.source?.trim() ?? ''];
    if (source === undefined) {
      add('数据来源', '必须是官方、运营、用户上报或第三方');
    }

    const verifiedDateText = values.verified_at?.trim() ?? '';
    const verifiedDate =
      DATE_PATTERN.test(verifiedDateText) &&
      !Number.isNaN(new Date(`${verifiedDateText}T00:00:00.000Z`).getTime())
        ? new Date(`${verifiedDateText}T00:00:00.000Z`)
        : null;
    if (verifiedDate === null) {
      add('核实时间', '必须填写 YYYY-MM-DD 格式的有效日期');
    }

    const images = splitList(values.images ?? '');
    if (images.length > 9) {
      add('图片', '最多 9 张');
    }
    if (images.some((image) => image.length > 255)) {
      add('图片', '单个图片 key 不超过 255 字');
    }

    const feeDetail = values.fee_detail?.trim() ?? '';
    const banNote = values.ban_note?.trim() ?? '';
    const openHours = values.open_hours?.trim() ?? '';
    const description = values.description?.trim() ?? '';
    const tips = values.tips?.trim() ?? '';
    if (feeDetail.length > 200) {
      add('收费说明', '不超过 200 字');
    }
    if (banNote.length > 200) {
      add('禁钓说明', '不超过 200 字');
    }
    if (openHours.length > 100) {
      add('开放时间', '不超过 100 字');
    }
    if (description.length > 1000) {
      add('简介', '不超过 1000 字');
    }
    if (tips.length > 1000) {
      add('注意事项', '不超过 1000 字');
    }
    if (openStatus === 'banned' && banNote.length === 0) {
      add('禁钓说明', '禁钓点必须填写禁钓说明');
    }

    const sortWeightText = values.sort_weight?.trim() ?? '';
    const sortWeight = sortWeightText === '' ? 0 : Number(sortWeightText);
    if (!Number.isInteger(sortWeight) || sortWeight < 0 || sortWeight > 1_000_000) {
      add('排序权重', '必须是非负整数');
    }
    const isCoreText = values.is_core?.trim().toLowerCase() ?? '';
    let isCore = false;
    if (isCoreText !== '') {
      if (['是', 'yes', 'true', '1'].includes(isCoreText)) {
        isCore = true;
      } else if (!['否', 'no', 'false', '0'].includes(isCoreText)) {
        add('核心钓点', '必须是“是”或“否”');
      }
    }

    if (errors.length > 0) {
      return { data: null, errors };
    }

    return {
      data: {
        spot_id: ulid(),
        spot_name: spotName,
        city_code: '440300',
        district: district ?? null,
        latitude,
        longitude,
        nav_latitude: navLatitude,
        nav_longitude: navLongitude,
        parking_latitude: parkingLatitude === '' ? null : parkingLatitude,
        parking_longitude: parkingLongitude === '' ? null : parkingLongitude,
        address,
        fish_types: fishTypes,
        fee_status: feeStatus ?? null,
        fee_unit: feeUnit,
        fee_detail: feeDetail === '' ? null : feeDetail,
        water_type: waterType ?? null,
        venue_type: venueType ?? null,
        fishing_method: fishingMethods,
        open_status: openStatus ?? null,
        ban_note: banNote === '' ? null : banNote,
        open_hours: openHours === '' ? null : openHours,
        description: description === '' ? null : description,
        tips: tips === '' ? null : tips,
        images,
        cover_image_key: images[0] ?? null,
        sort_weight: sortWeight,
        is_core: isCore,
        status: 'draft',
        source: source ?? null,
        verified_at: verifiedDate,
      },
      errors: [],
    };
  }

  private async duplicateWarnings(
    data: Prisma.SpotUncheckedCreateInput,
    rowNumber: number,
  ): Promise<RowIssue[]> {
    if (
      data.district === undefined ||
      data.district === null ||
      data.latitude === undefined ||
      data.latitude === null ||
      data.longitude === undefined ||
      data.longitude === null
    ) {
      return [];
    }
    const latitude = Number(data.latitude);
    const longitude = Number(data.longitude);
    const delta = 0.002;
    const candidates = await this.prisma.spot.findMany({
      where: {
        deleted_at: null,
        district: data.district,
        spot_id: { not: data.spot_id },
        latitude: { gte: latitude - delta, lte: latitude + delta },
        longitude: { gte: longitude - delta, lte: longitude + delta },
      },
      select: {
        spot_id: true,
        spot_name: true,
        latitude: true,
        longitude: true,
      },
    });
    const warnings: RowIssue[] = [];
    const currentName = normalizeName(data.spot_name);
    for (const candidate of candidates as DuplicateCandidate[]) {
      if (!namesAreSimilar(currentName, normalizeName(candidate.spot_name))) {
        continue;
      }
      const distance = Math.round(
        haversineMeters(
          latitude,
          longitude,
          candidate.latitude.toNumber(),
          candidate.longitude.toNumber(),
        ),
      );
      if (distance < 200) {
        warnings.push({
          row: rowNumber,
          level: 'warning',
          field: 'duplicate',
          message: `与「${candidate.spot_name}」相似，约 ${distance} 米`,
        });
      }
    }
    return warnings;
  }
}
