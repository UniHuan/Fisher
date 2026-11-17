import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma, Spot } from '@prisma/client';
import {
  ERROR_CODES,
  OPEN_STATUS,
  SPOT_STATUS,
  normalizeKeyword,
  type ValidationIssue,
} from '@szfisher/shared';
import { ulid } from 'ulid';
import { AppError } from '../../common/errors/app-error';
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
import { AuditLogService } from '../audit/audit-log.service';
import { DictionariesRepository } from '../dictionaries/dictionaries.repository';
import { SpotPoiDistancesService } from '../pois/spot-poi-distances.service';
import { StorageService } from '../storage/storage.service';
import {
  DEFAULT_SPOT_SOURCE,
  DUPLICATE_DISTANCE_M,
  MAX_SPOT_IMAGES,
  SPOT_SOURCES,
} from './admin-spot.constants';
import { toAdminSpotDetail, toAdminSpotListItem } from './admin-spot.mapper';
import type {
  AdminSpotDeleteResult,
  AdminSpotDetail,
  AdminSpotListItem,
  AdminSpotWriteResult,
  DuplicateWarning,
} from './admin-spot.types';
import {
  AdminSpotsRepository,
  type AdminSpotFilters,
} from './admin-spots.repository';
import type { AdminSpotListQueryDto } from './dto/admin-spot-list-query.dto';
import type { CreateSpotDto } from './dto/create-spot.dto';
import type { UpdateSpotDto } from './dto/update-spot.dto';
import type { VerifySpotDto } from './dto/verify-spot.dto';
import { IdempotencyService } from './idempotency.service';

const DEFAULT_PAGE_SIZE = 20;
const OPEN_STATUS_VALUES = new Set<string>(Object.values(OPEN_STATUS));
const SOURCE_VALUES = new Set<string>(SPOT_SOURCES);

interface DictionarySets {
  values: Map<string, Set<string>>;
}

interface SpotEditableValues {
  spot_name: string;
  district: string | null;
  latitude: string | null;
  longitude: string | null;
  nav_latitude: string | null;
  nav_longitude: string | null;
  parking_latitude: string | null;
  parking_longitude: string | null;
  address: string | null;
  fish_types: string[];
  fee_status: string | null;
  fee_unit: string | null;
  fee_detail: string | null;
  water_type: string | null;
  venue_type: string | null;
  fishing_method: string[];
  open_status: string | null;
  ban_note: string | null;
  open_hours: string | null;
  description: string | null;
  tips: string | null;
  images: string[];
  cover_image_key: string | null;
  sort_weight: number;
  is_core: boolean;
  source: string | null;
}

function trimToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function hasText(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

function decimalString(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(6);
}

function normalizeSpotName(value: string): string {
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
  if (left === right || left.includes(right) || right.includes(left)) {
    return true;
  }
  return levenshtein(left, right) <= 2;
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

@Injectable()
export class AdminSpotsService {
  constructor(
    private readonly spots: AdminSpotsRepository,
    private readonly dictionaries: DictionariesRepository,
    private readonly auditLogs: AuditLogService,
    private readonly idempotency: IdempotencyService,
    private readonly storage: StorageService,
    private readonly poiDistances: SpotPoiDistancesService,
  ) {}

  async list(query: AdminSpotListQueryDto): Promise<{
    items: AdminSpotListItem[];
    page: number;
    page_size: number;
    total: number;
    has_more: boolean;
  }> {
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
    const keyword = query.keyword === undefined ? undefined : normalizeKeyword(query.keyword);
    const district = query.district?.trim();
    const filters: AdminSpotFilters = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(district === undefined || district.length === 0 ? {} : { district }),
      ...(keyword === undefined || keyword.length === 0 ? {} : { keyword }),
      ...(query.updated_from === undefined ? {} : { updatedFrom: new Date(query.updated_from) }),
      ...(query.updated_to === undefined ? {} : { updatedTo: new Date(query.updated_to) }),
      page,
      pageSize,
    };
    const { rows, total } = await this.spots.findPage(filters);
    return {
      items: await Promise.all(rows.map((row) => this.presentListItem(row))),
      page,
      page_size: pageSize,
      total,
      has_more: page * pageSize < total,
    };
  }

  async getById(spotId: string): Promise<AdminSpotDetail> {
    const row = await this.spots.findById(spotId);
    if (row === null) {
      this.throwNotFound();
    }
    return this.presentDetail(row);
  }

  async create(
    input: CreateSpotDto,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminSpotWriteResult> {
    const dictionaries = await this.loadDictionarySets();
    const values = this.createValues(input);
    this.assertDraftValid(values, dictionaries);

    const row = await this.createRow({
      spot_id: ulid(),
      city_code: '440300',
      status: SPOT_STATUS.DRAFT,
      ...this.toCreateData(values),
    });
    const detail = await this.presentDetail(row);
    const warnings = await this.duplicateWarnings(detail.spot_id, values);
    await this.recordAudit(admin, request, 'spot.create', detail.spot_id, null, detail);
    return { spot: detail, warnings };
  }

  async update(
    spotId: string,
    input: UpdateSpotDto,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminSpotWriteResult> {
    const existing = await this.spots.findById(spotId);
    if (existing === null) {
      this.throwNotFound();
    }

    const dictionaries = await this.loadDictionarySets();
    const values = this.updateValues(existing, input);
    this.assertDraftValid(values, dictionaries);
    if (existing.status === SPOT_STATUS.PUBLISHED) {
      this.assertPublishValid(values, existing.verified_at);
      // New images on an already-published spot must reach the public bucket too.
      await this.storage.publishImages(values.images);
    }

    const updated = await this.updateRow(
      spotId,
      this.toUpdateData(values),
      existing.updated_at,
    );
    if (updated === 0) {
      const current = await this.spots.findById(spotId);
      if (current === null) {
        this.throwNotFound();
      }
      throw new AppError(
        ERROR_CODES.STATE_CONFLICT,
        HttpStatus.CONFLICT,
        'Spot changed concurrently; reload and retry',
      );
    }
    const row = await this.spots.findById(spotId);
    if (row === null) {
      this.throwNotFound();
    }
    if (
      (existing.latitude?.toFixed(6) ?? null) !== (row.latitude?.toFixed(6) ?? null) ||
      (existing.longitude?.toFixed(6) ?? null) !== (row.longitude?.toFixed(6) ?? null)
    ) {
      await this.poiDistances.recalculateForSpot(spotId);
    }
    const detail = await this.presentDetail(row);
    const warnings = await this.duplicateWarnings(spotId, values);
    await this.recordAudit(
      admin,
      request,
      'spot.update',
      spotId,
      toAdminSpotDetail(existing),
      detail,
    );
    return { spot: detail, warnings };
  }

  async publish(
    spotId: string,
    admin: AdminContext,
    request: RequestWithContext,
    idempotencyKey?: string,
  ): Promise<AdminSpotDetail> {
    const result = await this.idempotency.execute<AdminSpotDetail>({
      adminId: admin.adminId,
      key: idempotencyKey,
      scope: `spot.publish:${spotId}`,
      body: null,
      operation: () => this.publishOperation(spotId, admin, request),
    });
    return this.withImageUrls(result.data);
  }

  async offline(
    spotId: string,
    admin: AdminContext,
    request: RequestWithContext,
    idempotencyKey?: string,
  ): Promise<AdminSpotDetail> {
    const result = await this.idempotency.execute<AdminSpotDetail>({
      adminId: admin.adminId,
      key: idempotencyKey,
      scope: `spot.offline:${spotId}`,
      body: null,
      operation: () => this.offlineOperation(spotId, admin, request),
    });
    return this.withImageUrls(result.data);
  }

  async delete(
    spotId: string,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminSpotDeleteResult> {
    const existing = await this.spots.findById(spotId);
    if (existing === null) {
      this.throwNotFound();
    }
    if (existing.status === SPOT_STATUS.PUBLISHED) {
      throw new AppError(
        ERROR_CODES.STATE_CONFLICT,
        HttpStatus.CONFLICT,
        'Published spots must be offlined before deletion',
      );
    }

    const deleted = await this.spots.softDelete(
      spotId,
      [SPOT_STATUS.DRAFT, SPOT_STATUS.OFFLINE],
      existing.updated_at,
    );
    if (deleted === 0) {
      await this.throwStateConflictOrNotFound(spotId);
    }
    await this.recordAudit(
      admin,
      request,
      'spot.delete',
      spotId,
      toAdminSpotDetail(existing),
      null,
    );
    return { deleted: true };
  }

  async verify(
    spotId: string,
    input: VerifySpotDto,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminSpotDetail> {
    const existing = await this.spots.findById(spotId);
    if (existing === null) {
      this.throwNotFound();
    }
    const row = await this.spots.markVerified(spotId);
    if (row === null) {
      this.throwNotFound();
    }
    const detail = await this.presentDetail(row);
    await this.recordAudit(admin, request, 'spot.verify', spotId, toAdminSpotDetail(existing), {
      ...detail,
      method: input.method ?? null,
      note: input.note ?? null,
    });
    return detail;
  }

  private async publishOperation(
    spotId: string,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminSpotDetail> {
    const existing = await this.spots.findById(spotId);
    if (existing === null) {
      this.throwNotFound();
    }
    this.assertPublishValid(this.valuesFromSpot(existing), existing.verified_at);
    // Copy working images to the published bucket before the visibility change.
    await this.storage.publishImages(existing.images);

    const changed = await this.spots.transitionStatus(
      spotId,
      [SPOT_STATUS.DRAFT, SPOT_STATUS.OFFLINE],
      SPOT_STATUS.PUBLISHED,
      existing.updated_at,
    );
    if (changed === 0) {
      await this.throwStateConflictOrNotFound(spotId);
    }
    const row = await this.spots.findById(spotId);
    if (row === null) {
      this.throwNotFound();
    }
    const detail = toAdminSpotDetail(row);
    await this.recordAudit(
      admin,
      request,
      'spot.publish',
      spotId,
      toAdminSpotDetail(existing),
      detail,
    );
    return detail;
  }

  private async offlineOperation(
    spotId: string,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminSpotDetail> {
    const existing = await this.spots.findById(spotId);
    if (existing === null) {
      this.throwNotFound();
    }
    if (existing.status !== SPOT_STATUS.PUBLISHED) {
      throw new AppError(
        ERROR_CODES.STATE_CONFLICT,
        HttpStatus.CONFLICT,
        'Only published spots can be offlined',
      );
    }

    const changed = await this.spots.transitionStatus(
      spotId,
      [SPOT_STATUS.PUBLISHED],
      SPOT_STATUS.OFFLINE,
      existing.updated_at,
    );
    if (changed === 0) {
      await this.throwStateConflictOrNotFound(spotId);
    }
    const row = await this.spots.findById(spotId);
    if (row === null) {
      this.throwNotFound();
    }
    const detail = toAdminSpotDetail(row);
    await this.recordAudit(
      admin,
      request,
      'spot.offline',
      spotId,
      toAdminSpotDetail(existing),
      detail,
    );
    return detail;
  }

  private async throwStateConflictOrNotFound(spotId: string): Promise<never> {
    const current = await this.spots.findById(spotId);
    if (current === null) {
      this.throwNotFound();
    }
    throw new AppError(
      ERROR_CODES.STATE_CONFLICT,
      HttpStatus.CONFLICT,
      `Spot is in ${current.status} state`,
    );
  }

  private throwNotFound(): never {
    throw new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'Spot not found');
  }

  private createValues(input: CreateSpotDto): SpotEditableValues {
    const images = [...(input.images ?? [])];
    let cover = input.cover_image_key ?? null;
    if (cover === null && images.length > 0) {
      cover = images[0] ?? null;
    }
    let navLatitude = input.nav_latitude ?? null;
    let navLongitude = input.nav_longitude ?? null;
    if (navLatitude === null && navLongitude === null) {
      navLatitude = input.latitude ?? null;
      navLongitude = input.longitude ?? null;
    }
    return {
      spot_name: input.spot_name.trim(),
      district: trimToNull(input.district),
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      nav_latitude: navLatitude,
      nav_longitude: navLongitude,
      parking_latitude: input.parking_latitude ?? null,
      parking_longitude: input.parking_longitude ?? null,
      address: trimToNull(input.address),
      fish_types: [...(input.fish_types ?? [])],
      fee_status: trimToNull(input.fee_status),
      fee_unit: trimToNull(input.fee_unit),
      fee_detail: trimToNull(input.fee_detail),
      water_type: trimToNull(input.water_type),
      venue_type: trimToNull(input.venue_type),
      fishing_method: [...(input.fishing_method ?? [])],
      open_status: input.open_status ?? null,
      ban_note: trimToNull(input.ban_note),
      open_hours: trimToNull(input.open_hours),
      description: trimToNull(input.description),
      tips: trimToNull(input.tips),
      images,
      cover_image_key: cover,
      sort_weight: input.sort_weight ?? 0,
      is_core: input.is_core ?? false,
      source: input.source ?? DEFAULT_SPOT_SOURCE,
    };
  }

  private updateValues(existing: Spot, input: UpdateSpotDto): SpotEditableValues {
    const rawSpotName = input.spot_name as string | null | undefined;
    const spotName =
      rawSpotName === undefined
        ? existing.spot_name
        : rawSpotName === null
          ? ''
          : rawSpotName.trim();
    const images =
      input.images === undefined ? [...existing.images] : [...(input.images ?? [])];
    let cover: string | null;
    if (input.cover_image_key === null) {
      cover = images[0] ?? null;
    } else if (input.cover_image_key !== undefined) {
      cover = input.cover_image_key;
    } else if (input.images !== undefined) {
      cover =
        existing.cover_image_key !== null && images.includes(existing.cover_image_key)
          ? existing.cover_image_key
          : (images[0] ?? null);
    } else {
      cover = existing.cover_image_key;
    }

    const spotLatitude =
      input.latitude === undefined ? decimalString(existing.latitude) : (input.latitude ?? null);
    const spotLongitude =
      input.longitude === undefined ? decimalString(existing.longitude) : (input.longitude ?? null);
    const navTouched = input.nav_latitude !== undefined || input.nav_longitude !== undefined;
    let navLatitude =
      input.nav_latitude === undefined
        ? decimalString(existing.nav_latitude)
        : (input.nav_latitude ?? null);
    let navLongitude =
      input.nav_longitude === undefined
        ? decimalString(existing.nav_longitude)
        : (input.nav_longitude ?? null);
    if (
      spotLatitude !== null &&
      spotLongitude !== null &&
      navLatitude === null &&
      navLongitude === null
    ) {
      // PRD 3.2: an absent or explicitly cleared nav pair defaults to spot coords.
      navLatitude = spotLatitude;
      navLongitude = spotLongitude;
    } else if (!navTouched && spotLatitude === null && spotLongitude === null) {
      navLatitude = null;
      navLongitude = null;
    }

    return {
      spot_name: spotName,
      district:
        input.district === undefined ? existing.district : trimToNull(input.district),
      latitude: spotLatitude,
      longitude: spotLongitude,
      nav_latitude: navLatitude,
      nav_longitude: navLongitude,
      parking_latitude:
        input.parking_latitude === undefined
          ? decimalString(existing.parking_latitude)
          : (input.parking_latitude ?? null),
      parking_longitude:
        input.parking_longitude === undefined
          ? decimalString(existing.parking_longitude)
          : (input.parking_longitude ?? null),
      address: input.address === undefined ? existing.address : trimToNull(input.address),
      fish_types:
        input.fish_types === undefined ? [...existing.fish_types] : [...(input.fish_types ?? [])],
      fee_status:
        input.fee_status === undefined ? existing.fee_status : trimToNull(input.fee_status),
      fee_unit: input.fee_unit === undefined ? existing.fee_unit : trimToNull(input.fee_unit),
      fee_detail:
        input.fee_detail === undefined ? existing.fee_detail : trimToNull(input.fee_detail),
      water_type:
        input.water_type === undefined ? existing.water_type : trimToNull(input.water_type),
      venue_type:
        input.venue_type === undefined ? existing.venue_type : trimToNull(input.venue_type),
      fishing_method:
        input.fishing_method === undefined
          ? [...existing.fishing_method]
          : [...(input.fishing_method ?? [])],
      open_status:
        input.open_status === undefined ? existing.open_status : (input.open_status ?? null),
      ban_note: input.ban_note === undefined ? existing.ban_note : trimToNull(input.ban_note),
      open_hours:
        input.open_hours === undefined ? existing.open_hours : trimToNull(input.open_hours),
      description:
        input.description === undefined ? existing.description : trimToNull(input.description),
      tips: input.tips === undefined ? existing.tips : trimToNull(input.tips),
      images,
      cover_image_key: cover,
      sort_weight: input.sort_weight ?? existing.sort_weight,
      is_core: input.is_core ?? existing.is_core,
      source: input.source === undefined ? existing.source : (input.source ?? null),
    };
  }

  private valuesFromSpot(row: Spot): SpotEditableValues {
    return {
      spot_name: row.spot_name,
      district: row.district,
      latitude: decimalString(row.latitude),
      longitude: decimalString(row.longitude),
      nav_latitude: decimalString(row.nav_latitude),
      nav_longitude: decimalString(row.nav_longitude),
      parking_latitude: decimalString(row.parking_latitude),
      parking_longitude: decimalString(row.parking_longitude),
      address: row.address,
      fish_types: row.fish_types,
      fee_status: row.fee_status,
      fee_unit: row.fee_unit,
      fee_detail: row.fee_detail,
      water_type: row.water_type,
      venue_type: row.venue_type,
      fishing_method: row.fishing_method,
      open_status: row.open_status,
      ban_note: row.ban_note,
      open_hours: row.open_hours,
      description: row.description,
      tips: row.tips,
      images: row.images,
      cover_image_key: row.cover_image_key,
      sort_weight: row.sort_weight,
      is_core: row.is_core,
      source: row.source,
    };
  }

  private toCreateData(values: SpotEditableValues): Omit<
    Prisma.SpotUncheckedCreateInput,
    'spot_id' | 'city_code' | 'status'
  > {
    return {
      spot_name: values.spot_name,
      district: values.district,
      latitude: values.latitude,
      longitude: values.longitude,
      nav_latitude: values.nav_latitude,
      nav_longitude: values.nav_longitude,
      parking_latitude: values.parking_latitude,
      parking_longitude: values.parking_longitude,
      address: values.address,
      fish_types: values.fish_types,
      fee_status: values.fee_status,
      fee_unit: values.fee_unit,
      fee_detail: values.fee_detail,
      water_type: values.water_type,
      venue_type: values.venue_type,
      fishing_method: values.fishing_method,
      open_status: values.open_status,
      ban_note: values.ban_note,
      open_hours: values.open_hours,
      description: values.description,
      tips: values.tips,
      images: values.images,
      cover_image_key: values.cover_image_key,
      sort_weight: values.sort_weight,
      is_core: values.is_core,
      source: values.source,
    };
  }

  private toUpdateData(values: SpotEditableValues): Prisma.SpotUncheckedUpdateManyInput {
    return {
      spot_name: values.spot_name,
      district: values.district,
      latitude: values.latitude,
      longitude: values.longitude,
      nav_latitude: values.nav_latitude,
      nav_longitude: values.nav_longitude,
      parking_latitude: values.parking_latitude,
      parking_longitude: values.parking_longitude,
      address: values.address,
      fish_types: values.fish_types,
      fee_status: values.fee_status,
      fee_unit: values.fee_unit,
      fee_detail: values.fee_detail,
      water_type: values.water_type,
      venue_type: values.venue_type,
      fishing_method: values.fishing_method,
      open_status: values.open_status,
      ban_note: values.ban_note,
      open_hours: values.open_hours,
      description: values.description,
      tips: values.tips,
      images: values.images,
      cover_image_key: values.cover_image_key,
      sort_weight: values.sort_weight,
      is_core: values.is_core,
      source: values.source,
    };
  }

  private async loadDictionarySets(): Promise<DictionarySets> {
    const rows = await this.dictionaries.findEnabled();
    const values = new Map<string, Set<string>>();
    for (const row of rows) {
      const existing = values.get(row.dict_type) ?? new Set<string>();
      existing.add(row.dict_key);
      values.set(row.dict_type, existing);
    }
    return { values };
  }

  private assertDraftValid(values: SpotEditableValues, dictionaries: DictionarySets): void {
    const issues: ValidationIssue[] = [];
    if (values.spot_name.length === 0) {
      issues.push({ field: 'spot_name', message: 'spot_name must not be empty' });
    }
    this.validateCoordinatePair(
      values.latitude,
      values.longitude,
      'latitude',
      'longitude',
      issues,
    );
    this.validateCoordinatePair(
      values.nav_latitude,
      values.nav_longitude,
      'nav_latitude',
      'nav_longitude',
      issues,
    );
    this.validateCoordinatePair(
      values.parking_latitude,
      values.parking_longitude,
      'parking_latitude',
      'parking_longitude',
      issues,
    );

    this.assertDictionaryValue(dictionaries, 'district', values.district, 'district', issues);
    for (const fishType of values.fish_types) {
      this.assertDictionaryValue(dictionaries, 'fish_type', fishType, 'fish_types', issues);
    }
    this.assertDictionaryValue(
      dictionaries,
      'fee_status',
      values.fee_status,
      'fee_status',
      issues,
    );
    this.assertDictionaryValue(dictionaries, 'fee_unit', values.fee_unit, 'fee_unit', issues);
    this.assertDictionaryValue(
      dictionaries,
      'water_type',
      values.water_type,
      'water_type',
      issues,
    );
    this.assertDictionaryValue(
      dictionaries,
      'venue_type',
      values.venue_type,
      'venue_type',
      issues,
    );
    for (const method of values.fishing_method) {
      this.assertDictionaryValue(
        dictionaries,
        'fishing_method',
        method,
        'fishing_method',
        issues,
      );
    }

    if (values.open_status !== null && !OPEN_STATUS_VALUES.has(values.open_status)) {
      issues.push({ field: 'open_status', message: 'open_status is not a supported value' });
    }
    if (values.source !== null && !SOURCE_VALUES.has(values.source)) {
      issues.push({ field: 'source', message: 'source is not a supported value' });
    }
    if (values.images.length > MAX_SPOT_IMAGES) {
      issues.push({ field: 'images', message: `At most ${MAX_SPOT_IMAGES} images are allowed` });
    }
    for (const image of values.images) {
      if (image.length === 0 || image.length > 255) {
        issues.push({ field: 'images', message: 'Each image key must be 1-255 characters' });
      }
    }
    if (
      values.cover_image_key !== null &&
      !values.images.includes(values.cover_image_key)
    ) {
      issues.push({
        field: 'cover_image_key',
        message: 'cover_image_key must belong to images',
      });
    }
    this.throwIssues(
      issues,
      ERROR_CODES.VALIDATION,
      HttpStatus.BAD_REQUEST,
      'Validation failed',
    );
  }

  private assertPublishValid(values: SpotEditableValues, verifiedAt: Date | null): void {
    const issues: ValidationIssue[] = [];
    if (!hasText(values.spot_name)) {
      issues.push({ field: 'spot_name', message: 'spot_name is required' });
    }
    if (!hasText(values.district)) {
      issues.push({ field: 'district', message: 'district is required' });
    }
    this.requireCoordinatePair(
      values.latitude,
      values.longitude,
      'latitude',
      'longitude',
      issues,
    );
    this.requireCoordinatePair(
      values.nav_latitude,
      values.nav_longitude,
      'nav_latitude',
      'nav_longitude',
      issues,
    );
    if (!hasText(values.address)) {
      issues.push({ field: 'address', message: 'address is required' });
    }
    if (values.fish_types.length === 0) {
      issues.push({ field: 'fish_types', message: 'At least one fish type is required' });
    }
    if (!hasText(values.fee_status)) {
      issues.push({ field: 'fee_status', message: 'fee_status is required' });
    }
    if (!hasText(values.water_type)) {
      issues.push({ field: 'water_type', message: 'water_type is required' });
    }
    if (!hasText(values.venue_type)) {
      issues.push({ field: 'venue_type', message: 'venue_type is required' });
    }
    if (!hasText(values.open_status)) {
      issues.push({ field: 'open_status', message: 'open_status is required' });
    } else if (values.open_status !== null && !OPEN_STATUS_VALUES.has(values.open_status)) {
      issues.push({ field: 'open_status', message: 'open_status is not a supported value' });
    }
    if (verifiedAt === null) {
      issues.push({ field: 'verified_at', message: 'verified_at is required before publishing' });
    }
    if (!hasText(values.source)) {
      issues.push({ field: 'source', message: 'source is required' });
    } else if (values.source !== null && !SOURCE_VALUES.has(values.source)) {
      issues.push({ field: 'source', message: 'source is not a supported value' });
    }
    if (
      values.open_status === OPEN_STATUS.BANNED &&
      !hasText(values.ban_note)
    ) {
      issues.push({ field: 'ban_note', message: 'A banned spot requires ban_note' });
    }
    if (values.is_core && values.images.length === 0) {
      issues.push({ field: 'images', message: 'A core spot requires at least one image' });
    }
    if (
      values.cover_image_key !== null &&
      !values.images.includes(values.cover_image_key)
    ) {
      issues.push({
        field: 'cover_image_key',
        message: 'cover_image_key must belong to images',
      });
    }
    this.throwIssues(
      issues,
      ERROR_CODES.PUBLISH_VALIDATION,
      HttpStatus.UNPROCESSABLE_ENTITY,
      'Publish validation failed',
    );
  }

  private requireCoordinatePair(
    latitude: string | null,
    longitude: string | null,
    latitudeField: string,
    longitudeField: string,
    issues: ValidationIssue[],
  ): void {
    if (latitude === null || longitude === null) {
      if (latitude === null) {
        issues.push({ field: latitudeField, message: `${latitudeField} is required` });
      }
      if (longitude === null) {
        issues.push({ field: longitudeField, message: `${longitudeField} is required` });
      }
      return;
    }
    this.validateCoordinateRange(latitude, longitude, latitudeField, longitudeField, issues);
  }

  private validateCoordinatePair(
    latitude: string | null,
    longitude: string | null,
    latitudeField: string,
    longitudeField: string,
    issues: ValidationIssue[],
  ): void {
    if ((latitude === null) !== (longitude === null)) {
      issues.push({
        field: latitude === null ? latitudeField : longitudeField,
        message: 'Both coordinates in a pair are required',
      });
      return;
    }
    if (latitude !== null && longitude !== null) {
      this.validateCoordinateRange(latitude, longitude, latitudeField, longitudeField, issues);
    }
  }

  private validateCoordinateRange(
    latitude: string,
    longitude: string,
    latitudeField: string,
    longitudeField: string,
    issues: ValidationIssue[],
  ): void {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || lat < 22.3 || lat > 22.9) {
      issues.push({ field: latitudeField, message: `${latitudeField} is outside Shenzhen bounds` });
    }
    if (!Number.isFinite(lng) || lng < 113.7 || lng > 114.7) {
      issues.push({ field: longitudeField, message: `${longitudeField} is outside Shenzhen bounds` });
    }
  }

  private assertDictionaryValue(
    dictionaries: DictionarySets,
    dictType: string,
    value: string | null,
    field: string,
    issues: ValidationIssue[],
  ): void {
    if (value === null) {
      return;
    }
    if (!dictionaries.values.get(dictType)?.has(value)) {
      issues.push({ field, message: `${field} is not an enabled dictionary value` });
    }
  }

  private throwIssues(
    issues: ValidationIssue[],
    code: number,
    status: number,
    message: string,
  ): void {
    if (issues.length > 0) {
      throw new AppError(code, status, message, issues);
    }
  }

  private async duplicateWarnings(
    spotId: string,
    values: SpotEditableValues,
  ): Promise<DuplicateWarning[]> {
    if (
      values.district === null ||
      values.latitude === null ||
      values.longitude === null
    ) {
      return [];
    }
    const lat = Number(values.latitude);
    const lng = Number(values.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return [];
    }
    const candidates = await this.spots.findDuplicateCandidates(
      values.district,
      spotId,
      lat,
      lng,
    );
    const currentName = normalizeSpotName(values.spot_name);
    const warnings: DuplicateWarning[] = [];
    for (const candidate of candidates) {
      const candidateLat = candidate.latitude?.toNumber();
      const candidateLng = candidate.longitude?.toNumber();
      if (candidateLat === undefined || candidateLng === undefined) {
        continue;
      }
      if (!namesAreSimilar(currentName, normalizeSpotName(candidate.spot_name))) {
        continue;
      }
      const rawDistance = haversineMeters(lat, lng, candidateLat, candidateLng);
      if (rawDistance < DUPLICATE_DISTANCE_M) {
        warnings.push({
          spot_id: candidate.spot_id,
          spot_name: candidate.spot_name,
          distance_m: Math.round(rawDistance),
        });
      }
    }
    return warnings;
  }

  private async presentListItem(row: Spot): Promise<AdminSpotListItem> {
    const item = toAdminSpotListItem(row);
    return {
      ...item,
      cover_image_url: await this.safeImageUrl(
        row.cover_image_key,
        row.status === SPOT_STATUS.PUBLISHED,
      ),
    };
  }

  private presentDetail(row: Spot): Promise<AdminSpotDetail> {
    return this.withImageUrls(toAdminSpotDetail(row));
  }

  private async withImageUrls(detail: AdminSpotDetail): Promise<AdminSpotDetail> {
    const published = detail.status === SPOT_STATUS.PUBLISHED;
    const imageUrls = await Promise.all(
      detail.images.map(async (key) => (await this.safeImageUrl(key, published)) ?? ''),
    );
    const coverKey = detail.cover_image_key ?? detail.images[0] ?? null;
    return {
      ...detail,
      image_urls: imageUrls,
      cover_image_url: await this.safeImageUrl(coverKey, published),
    };
  }

  private async safeImageUrl(key: string | null, published: boolean): Promise<string | null> {
    if (key === null) {
      return null;
    }
    try {
      return await this.storage.getImageUrl(key, published);
    } catch {
      return null;
    }
  }

  private async createRow(data: Prisma.SpotUncheckedCreateInput): Promise<Spot> {
    try {
      return await this.spots.create(data);
    } catch (error) {
      this.mapConstraintError(error);
    }
  }

  private async updateRow(
    spotId: string,
    data: Prisma.SpotUncheckedUpdateManyInput,
    expectedUpdatedAt: Date,
  ): Promise<number> {
    try {
      return await this.spots.update(spotId, data, expectedUpdatedAt);
    } catch (error) {
      this.mapConstraintError(error);
    }
  }

  /**
   * Prisma surfaces PostgreSQL CHECK violations as UnknownRequestError, not a known
   * P-code. Enabled dictionary keys that predate a CHECK constraint must become 40001,
   * not a 50001.
   */
  private mapConstraintError(error: unknown): never {
    const message =
      typeof (error as { message?: unknown })?.message === 'string'
        ? (error as { message: string }).message
        : String(error);
    if (message.includes('violates check constraint') && message.includes('spot_')) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'Spot value violates database constraints',
      );
    }
    throw error;
  }

  private async recordAudit(
    admin: AdminContext,
    request: RequestWithContext,
    action: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    const userAgent = request.headers['user-agent'];
    await this.auditLogs.record({
      adminId: admin.adminId,
      action,
      entityType: 'spot',
      entityId,
      before,
      after,
      ip: request.ip ?? null,
      requestId: request.requestId ?? null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    });
  }
}
