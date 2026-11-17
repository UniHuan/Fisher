import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Poi, type Spot, type SpotPoi } from '@prisma/client';
import {
  ERROR_CODES,
  OPEN_STATUS,
  POI_TYPE,
  normalizeKeyword,
  splitCsv,
} from '@szfisher/shared';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  CORE_FRESH_DAYS,
  EXPIRED_DAYS,
  NORMAL_FRESH_DAYS,
  POI_SOURCE_LABEL,
  PUBLIC_MAX_PAGE_SIZE,
  PUBLIC_PAGE_SIZE,
  MAP_MAX_POINTS,
} from './public-spot.constants';
import type {
  Freshness,
  PublicMapCluster,
  PublicMapItem,
  PublicMapResult,
  PublicPoiGroup,
  PublicPoiItem,
  PublicPoiList,
  PublicSpotDetail,
  PublicSpotListItem,
} from './public-spot.types';
import type { PublicMapQueryDto } from './dto/public-map-query.dto';
import type { PublicPoiQueryDto } from './dto/public-poi-query.dto';
import type { PublicSpotListQueryDto } from './dto/public-spot-list-query.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_STATUS_VALUES = new Set<string>(Object.values(OPEN_STATUS));
const POI_TYPE_VALUES = Object.values(POI_TYPE);
const POI_TYPE_ORDER = new Map<string, number>(
  POI_TYPE_VALUES.map((type, index) => [type, index]),
);

function decimalString(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(6);
}

function ageDays(verifiedAt: Date | null): number | null {
  if (verifiedAt === null) {
    return null;
  }
  return Math.max(0, Math.floor((Date.now() - verifiedAt.getTime()) / DAY_MS));
}

function freshnessFor(verifiedAt: Date | null, isCore: boolean): Freshness {
  const days = ageDays(verifiedAt);
  if (days === null || days > EXPIRED_DAYS) {
    return 'expired';
  }
  return days > (isCore ? CORE_FRESH_DAYS : NORMAL_FRESH_DAYS) ? 'stale' : 'fresh';
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
export class PublicSpotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(query: PublicSpotListQueryDto): Promise<{
    items: PublicSpotListItem[];
    page: number;
    page_size: number;
    total: number;
    has_more: boolean;
  }> {
    const hasLatitude = query.latitude !== undefined;
    const hasLongitude = query.longitude !== undefined;
    if (hasLatitude !== hasLongitude) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'latitude and longitude must be provided together',
      );
    }
    if (query.sort === 'distance' && (!hasLatitude || !hasLongitude)) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'Distance sort requires latitude and longitude',
      );
    }

    const statuses = this.openStatuses(query.open_status, query.include_banned ?? false);
    const where = this.buildWhere(query, statuses);
    const rows = await this.prisma.spot.findMany({ where });
    const longitude = query.longitude;
    const latitude = query.latitude;
    const items = rows.map((row) =>
      this.toListItem(row, latitude, longitude),
    );
    const rowById = new Map(rows.map((row) => [row.spot_id, row]));

    const sort = query.sort ?? (hasLatitude ? 'distance' : 'recommended');
    items.sort((left, right) => {
      if (sort === 'distance') {
        return (left.distance_m ?? Number.POSITIVE_INFINITY) - (right.distance_m ?? Number.POSITIVE_INFINITY);
      }
      if (sort === 'updated_at') {
        return right.updated_at.localeCompare(left.updated_at);
      }
      const leftExpired = left.freshness === 'expired' ? 1 : 0;
      const rightExpired = right.freshness === 'expired' ? 1 : 0;
      if (leftExpired !== rightExpired) {
        return leftExpired - rightExpired;
      }
      const leftRow = rowById.get(left.spot_id);
      const rightRow = rowById.get(right.spot_id);
      const weightDiff = (rightRow?.sort_weight ?? 0) - (leftRow?.sort_weight ?? 0);
      if (weightDiff !== 0) {
        return weightDiff;
      }
      return (
        (rightRow?.verified_at?.getTime() ?? 0) -
        (leftRow?.verified_at?.getTime() ?? 0)
      );
    });

    const page = query.page ?? 1;
    const pageSize = Math.min(query.page_size ?? PUBLIC_PAGE_SIZE, PUBLIC_MAX_PAGE_SIZE);
    const total = items.length;
    const start = (page - 1) * pageSize;
    return {
      items: items.slice(start, start + pageSize),
      page,
      page_size: pageSize,
      total,
      has_more: start + pageSize < total,
    };
  }

  async map(query: PublicMapQueryDto): Promise<PublicMapResult> {
    const bounds = this.parseBounds(query);
    const statuses = this.openStatuses(undefined, query.include_banned ?? false);
    const where: Prisma.SpotWhereInput = {
      status: 'published',
      deleted_at: null,
      open_status: { in: statuses },
      latitude: {
        not: null,
        ...(bounds === undefined ? {} : { gte: bounds.south, lte: bounds.north }),
      },
      longitude: {
        not: null,
        ...(bounds === undefined ? {} : { gte: bounds.west, lte: bounds.east }),
      },
    };
    const rows = await this.prisma.spot.findMany({ where });
    const zoom = query.zoom ?? 12;
    const total = rows.length;
    if (total > MAP_MAX_POINTS) {
      return {
        mode: 'clusters',
        total,
        zoom,
        items: [],
        clusters: this.clusterRows(rows, zoom),
      };
    }
    return {
      mode: 'points',
      total,
      zoom,
      items: rows.map((row) => this.toMapItem(row)),
      clusters: [],
    };
  }

  async detail(spotId: string): Promise<PublicSpotDetail> {
    const row = await this.findPublished(spotId);
    if (row.latitude === null || row.longitude === null) {
      this.throwNotFound();
    }
    const base = this.toListItem(row);
    const images = row.images
      .map((key) => this.safePublicUrl(key))
      .filter((url): url is string => url !== null);
    const poiSummary = await this.poiSummary(row.spot_id);
    const banned = row.open_status === OPEN_STATUS.BANNED;
    const navLatitude = decimalString(row.nav_latitude) ?? decimalString(row.latitude);
    const navLongitude = decimalString(row.nav_longitude) ?? decimalString(row.longitude);
    return {
      ...base,
      city_code: row.city_code,
      address: row.address,
      latitude: row.latitude.toFixed(6),
      longitude: row.longitude.toFixed(6),
      fee_unit: row.fee_unit,
      fee_detail: row.fee_detail,
      fishing_method: row.fishing_method,
      ban_note: row.ban_note,
      open_hours: row.open_hours,
      description: row.description,
      tips: row.tips,
      images,
      image_count: images.length,
      navigation:
        banned || navLatitude === null || navLongitude === null
          ? null
          : {
              name: row.spot_name,
              latitude: navLatitude,
              longitude: navLongitude,
              address: row.address,
            },
      is_banned: banned,
      verified_days_ago: ageDays(row.verified_at),
      poi_summary: poiSummary,
    };
  }

  async pois(spotId: string, query: PublicPoiQueryDto): Promise<PublicPoiList> {
    const spot = await this.findPublished(spotId);
    const items = (await this.loadSpotPois(spotId))
      .filter((row) => row.poi.status === 'active')
      .map((row) => this.toPoiItem(row))
      .filter((item) => query.poi_type === undefined || item.poi_type === query.poi_type);
    const labels = Array.from(new Set(items.map((item) => item.source_label)));
    return {
      spot_id: spot.spot_id,
      items,
      data_source: labels.length === 0 ? '暂无' : labels.join('、'),
      poi_type: query.poi_type ?? null,
    };
  }

  private buildWhere(
    query: PublicSpotListQueryDto,
    statuses: string[],
  ): Prisma.SpotWhereInput {
    const keyword = query.keyword === undefined ? '' : normalizeKeyword(query.keyword);
    const fishTypes = query.fish_types === undefined ? [] : splitCsv(query.fish_types);
    const waterTypes = query.water_type === undefined ? [] : splitCsv(query.water_type);
    const venueTypes = query.venue_type === undefined ? [] : splitCsv(query.venue_type);
    return {
      status: 'published',
      deleted_at: null,
      open_status: { in: statuses },
      ...(query.district === undefined || query.district.trim() === ''
        ? {}
        : { district: query.district.trim() }),
      ...(query.fee_status === undefined ? {} : { fee_status: query.fee_status }),
      ...(fishTypes.length === 0 ? {} : { fish_types: { hasSome: fishTypes } }),
      ...(waterTypes.length === 0 ? {} : { water_type: { in: waterTypes } }),
      ...(venueTypes.length === 0 ? {} : { venue_type: { in: venueTypes } }),
      ...(keyword.length === 0
        ? {}
        : { spot_name: { contains: keyword, mode: 'insensitive' } }),
    };
  }

  private openStatuses(
    raw: string | undefined,
    includeBanned: boolean,
  ): string[] {
    const requested =
      raw === undefined
        ? []
        : splitCsv(raw).filter((status) => status.length > 0);
    for (const status of requested) {
      if (!OPEN_STATUS_VALUES.has(status)) {
        throw new AppError(
          ERROR_CODES.VALIDATION,
          HttpStatus.BAD_REQUEST,
          `Unknown open_status: ${status}`,
        );
      }
    }
    let statuses = requested.length === 0 ? [OPEN_STATUS.OPEN, OPEN_STATUS.PAUSED] : requested;
    if (includeBanned && requested.length === 0) {
      statuses = [...statuses, OPEN_STATUS.BANNED];
    }
    if (!includeBanned) {
      statuses = statuses.filter((status) => status !== OPEN_STATUS.BANNED);
    }
    return Array.from(new Set(statuses));
  }

  private async findPublished(spotId: string): Promise<Spot> {
    const row = await this.prisma.spot.findFirst({
      where: {
        spot_id: spotId,
        status: 'published',
        deleted_at: null,
        open_status: { not: null },
      },
    });
    if (row === null) {
      this.throwNotFound();
    }
    return row;
  }

  private toListItem(
    row: Spot,
    latitude?: number,
    longitude?: number,
  ): PublicSpotListItem {
    const coverKey = row.cover_image_key ?? row.images[0] ?? null;
    const distance =
      latitude !== undefined &&
      longitude !== undefined &&
      row.latitude !== null &&
      row.longitude !== null
        ? Math.round(
            haversineMeters(
              latitude,
              longitude,
              row.latitude.toNumber(),
              row.longitude.toNumber(),
            ),
          )
        : undefined;
    return {
      spot_id: row.spot_id,
      spot_name: row.spot_name,
      district: row.district,
      fish_types: row.fish_types,
      fee_status: row.fee_status,
      water_type: row.water_type,
      venue_type: row.venue_type,
      open_status: row.open_status ?? OPEN_STATUS.OPEN,
      is_core: row.is_core,
      cover_image_url: coverKey === null ? null : this.safePublicUrl(coverKey),
      verified_at: row.verified_at?.toISOString() ?? null,
      updated_at: row.updated_at.toISOString(),
      freshness: freshnessFor(row.verified_at, row.is_core),
      ...(distance === undefined ? {} : { distance_m: distance }),
    };
  }

  private toMapItem(row: Spot): PublicMapItem {
    if (row.latitude === null || row.longitude === null) {
      throw new Error('Published spot missing coordinates');
    }
    const coverKey = row.cover_image_key ?? row.images[0] ?? null;
    return {
      spot_id: row.spot_id,
      spot_name: row.spot_name,
      district: row.district,
      latitude: row.latitude.toFixed(6),
      longitude: row.longitude.toFixed(6),
      fee_status: row.fee_status,
      open_status: row.open_status ?? OPEN_STATUS.OPEN,
      is_core: row.is_core,
      cover_image_url: coverKey === null ? null : this.safePublicUrl(coverKey),
    };
  }

  private clusterRows(rows: Spot[], zoom: number): PublicMapCluster[] {
    const cell = this.clusterCellSize(zoom);
    const groups = new Map<
      string,
      {
        count: number;
        latSum: number;
        lngSum: number;
        north: number;
        south: number;
        east: number;
        west: number;
      }
    >();
    for (const row of rows) {
      if (row.latitude === null || row.longitude === null) {
        continue;
      }
      const lat = row.latitude.toNumber();
      const lng = row.longitude.toNumber();
      const key = `${Math.floor(lat / cell)}:${Math.floor(lng / cell)}`;
      const existing = groups.get(key);
      if (existing === undefined) {
        groups.set(key, {
          count: 1,
          latSum: lat,
          lngSum: lng,
          north: lat,
          south: lat,
          east: lng,
          west: lng,
        });
      } else {
        existing.count += 1;
        existing.latSum += lat;
        existing.lngSum += lng;
        existing.north = Math.max(existing.north, lat);
        existing.south = Math.min(existing.south, lat);
        existing.east = Math.max(existing.east, lng);
        existing.west = Math.min(existing.west, lng);
      }
    }
    return Array.from(groups.values())
      .map((group) => ({
        latitude: (group.latSum / group.count).toFixed(6),
        longitude: (group.lngSum / group.count).toFixed(6),
        count: group.count,
        bounds: {
          north: group.north.toFixed(6),
          south: group.south.toFixed(6),
          east: group.east.toFixed(6),
          west: group.west.toFixed(6),
        },
      }))
      .sort((left, right) => right.count - left.count);
  }

  private clusterCellSize(zoom: number): number {
    if (zoom <= 10) {
      return 0.1;
    }
    if (zoom === 11) {
      return 0.05;
    }
    if (zoom === 12) {
      return 0.02;
    }
    if (zoom === 13) {
      return 0.01;
    }
    if (zoom === 14) {
      return 0.005;
    }
    return 0.002;
  }

  private parseBounds(
    query: PublicMapQueryDto,
  ): { north: number; south: number; east: number; west: number } | undefined {
    const bounds = [query.north, query.south, query.east, query.west];
    const provided = bounds.filter((value) => value !== undefined).length;
    if (provided === 0) {
      return undefined;
    }
    if (provided !== 4) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'north, south, east and west must be provided together',
      );
    }
    const north = query.north as number;
    const south = query.south as number;
    const east = query.east as number;
    const west = query.west as number;
    if (south >= north || west >= east) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'Invalid map bounds',
      );
    }
    return { north, south, east, west };
  }

  private async loadSpotPois(spotId: string): Promise<Array<SpotPoi & { poi: Poi }>> {
    return this.prisma.spotPoi.findMany({
      where: { spot_id: spotId },
      include: { poi: true },
      orderBy: [{ distance_m: 'asc' }, { created_at: 'asc' }],
    });
  }

  private async poiSummary(spotId: string): Promise<PublicPoiGroup[]> {
    const rows = (await this.loadSpotPois(spotId)).filter(
      (row) => row.poi.status === 'active',
    );
    const groups = new Map<string, PublicPoiItem[]>();
    for (const row of rows) {
      const item = this.toPoiItem(row);
      const existing = groups.get(item.poi_type) ?? [];
      existing.push(item);
      groups.set(item.poi_type, existing);
    }
    return Array.from(groups.entries())
      .sort(
        ([left], [right]) =>
          (POI_TYPE_ORDER.get(left) ?? 99) - (POI_TYPE_ORDER.get(right) ?? 99),
      )
      .map(([poi_type, items]) => ({
        poi_type,
        count: items.length,
        items: items.slice(0, 3),
      }));
  }

  private toPoiItem(row: SpotPoi & { poi: Poi }): PublicPoiItem {
    const poi = row.poi;
    const poiType = row.poi_type_override ?? poi.poi_type;
    const latitude = poi.latitude.toFixed(6);
    const longitude = poi.longitude.toFixed(6);
    return {
      poi_id: poi.poi_id,
      poi_name: poi.poi_name,
      poi_type: poiType,
      latitude,
      longitude,
      address: poi.address,
      rating: poi.rating === null ? null : poi.rating.toFixed(1),
      open_time: poi.open_time,
      distance_m: row.distance_m,
      source: poi.source,
      source_label: POI_SOURCE_LABEL[poi.source] ?? poi.source,
      navigation: {
        name: poi.poi_name,
        latitude,
        longitude,
        address: poi.address,
      },
    };
  }

  private safePublicUrl(key: string): string | null {
    try {
      return this.storage.getPublicUrl(key);
    } catch {
      return null;
    }
  }

  private throwNotFound(): never {
    throw new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'Spot not found');
  }
}
