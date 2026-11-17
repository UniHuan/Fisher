import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma, type Poi, type Spot } from '@prisma/client';
import {
  ERROR_CODES,
  POI_TYPE,
  isShenzhenCoordinate,
  normalizeKeyword,
} from '@szfisher/shared';
import { ulid } from 'ulid';
import { AppError } from '../../common/errors/app-error';
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
import { AuditLogService } from '../audit/audit-log.service';
import type { AdminPoiListQueryDto } from './dto/admin-poi.dto';
import type { BindPoiDto, CreatePoiDto, UpdatePoiDto } from './dto/admin-poi.dto';
import { distanceMeters } from './poi-distance';
import { toAdminPoiItem, toAdminSpotPoiItem, toPoiSyncRunItem } from './poi.mapper';
import { POI_PROVIDER, type PoiProvider } from './poi.provider';
import type {
  AdminPoiItem,
  AdminSpotPoiItem,
  AdminSpotPoiList,
  PoiSyncRunItem,
  ProviderPoiItem,
} from './poi.types';
import { PoisRepository } from './pois.repository';
import { SpotPoiDistancesService } from './spot-poi-distances.service';

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_SYNC_RADIUS_M = 3_000;
const MIN_SYNC_RADIUS_M = 100;
const MAX_SYNC_RADIUS_M = 10_000;
const DEFAULT_MAX_PER_TYPE = 50;
const MAX_MAX_PER_TYPE = 50;
const POI_TYPE_ORDER = new Map<string, number>(
  Object.values(POI_TYPE).map((type, index) => [type, index]),
);
const POI_TYPE_VALUES = new Set<string>(Object.values(POI_TYPE));

function trimToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function assertCoordinates(latitude: string, longitude: string): void {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!isShenzhenCoordinate(lat, lng)) {
    throw new AppError(
      ERROR_CODES.VALIDATION,
      HttpStatus.BAD_REQUEST,
      'Coordinates must be inside Shenzhen',
    );
  }
}

function normalizeRating(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
    throw new AppError(
      ERROR_CODES.VALIDATION,
      HttpStatus.BAD_REQUEST,
      'rating must be between 0 and 5',
    );
  }
  return rating.toFixed(1);
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (name.length === 0) {
    throw new AppError(
      ERROR_CODES.VALIDATION,
      HttpStatus.BAD_REQUEST,
      'poi_name must not be blank',
    );
  }
  return name;
}

@Injectable()
export class PoisService {
  constructor(
    private readonly pois: PoisRepository,
    private readonly auditLogs: AuditLogService,
    private readonly distances: SpotPoiDistancesService,
    @Inject(POI_PROVIDER) private readonly provider: PoiProvider,
  ) {}

  async list(query: AdminPoiListQueryDto): Promise<{
    items: AdminPoiItem[];
    page: number;
    page_size: number;
    total: number;
    has_more: boolean;
  }> {
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
    const keyword = query.keyword === undefined ? undefined : normalizeKeyword(query.keyword);
    const { rows, total } = await this.pois.findPage({
      ...(query.poi_type === undefined ? {} : { poiType: query.poi_type }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(keyword === undefined || keyword.length === 0 ? {} : { keyword }),
      page,
      pageSize,
    });
    return {
      items: rows.map(toAdminPoiItem),
      page,
      page_size: pageSize,
      total,
      has_more: page * pageSize < total,
    };
  }

  async create(
    body: CreatePoiDto,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminPoiItem> {
    const poiName = normalizeName(body.poi_name);
    assertCoordinates(body.latitude, body.longitude);
    const rating = normalizeRating(body.rating);
    const row = await this.pois.create({
      poi_id: ulid(),
      external_poi_id: null,
      poi_name: poiName,
      poi_type: body.poi_type,
      latitude: body.latitude,
      longitude: body.longitude,
      address: trimToNull(body.address),
      rating,
      open_time: trimToNull(body.open_time),
      source: 'manual',
      status: 'active',
    });
    const item = toAdminPoiItem(row);
    await this.recordAudit(admin, request, 'poi.create', 'poi', row.poi_id, null, item);
    return item;
  }

  async update(
    poiId: string,
    body: UpdatePoiDto,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminPoiItem> {
    const row = await this.pois.findById(poiId);
    if (row === null) {
      this.throwPoiNotFound();
    }
    const data: Prisma.PoiUncheckedUpdateInput = {};
    if (body.poi_name !== undefined) {
      data.poi_name = normalizeName(body.poi_name);
    }
    if (body.poi_type !== undefined) {
      data.poi_type = body.poi_type;
    }
    if (body.latitude !== undefined || body.longitude !== undefined) {
      const latitude = body.latitude ?? row.latitude.toFixed(6);
      const longitude = body.longitude ?? row.longitude.toFixed(6);
      assertCoordinates(latitude, longitude);
      data.latitude = latitude;
      data.longitude = longitude;
    }
    if (body.address !== undefined) {
      data.address = trimToNull(body.address);
    }
    if (body.rating !== undefined) {
      data.rating = normalizeRating(body.rating);
    }
    if (body.open_time !== undefined) {
      data.open_time = trimToNull(body.open_time);
    }
    if (body.status !== undefined) {
      data.status = body.status;
    }
    const updated = await this.pois.update(poiId, data);
    if (
      row.latitude.toFixed(6) !== updated.latitude.toFixed(6) ||
      row.longitude.toFixed(6) !== updated.longitude.toFixed(6)
    ) {
      await this.distances.recalculateForPoi(poiId);
    }
    await this.recordAudit(
      admin,
      request,
      'poi.update',
      'poi',
      poiId,
      toAdminPoiItem(row),
      toAdminPoiItem(updated),
    );
    return toAdminPoiItem(updated);
  }

  async listSpotPois(spotId: string): Promise<AdminSpotPoiList> {
    const spot = await this.requireSpot(spotId);
    const rows = await this.pois.findSpotPois(spot.spot_id);
    const lastSync = await this.pois.findLatestSync(spot.spot_id);
    return {
      spot_id: spot.spot_id,
      items: rows.map(toAdminSpotPoiItem).sort((left, right) => {
        const typeDiff =
          (POI_TYPE_ORDER.get(left.effective_type) ?? 99) -
          (POI_TYPE_ORDER.get(right.effective_type) ?? 99);
        if (typeDiff !== 0) {
          return typeDiff;
        }
        if (left.distance_m !== right.distance_m) {
          return left.distance_m - right.distance_m;
        }
        return (left.sort_order ?? 0) - (right.sort_order ?? 0);
      }),
      last_sync: lastSync === null ? null : toPoiSyncRunItem(lastSync),
    };
  }

  async bind(
    spotId: string,
    body: BindPoiDto,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminSpotPoiItem> {
    const spot = await this.requireSpot(spotId);
    const poi = await this.pois.findById(body.poi_id);
    if (poi === null) {
      this.throwPoiNotFound();
    }
    if (spot.latitude === null || spot.longitude === null) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'Spot coordinates are required before binding POIs',
      );
    }
    if (await this.pois.findBinding(spot.spot_id, poi.poi_id)) {
      this.throwAlreadyBound();
    }
    const distance = this.distanceFromSpot(spot, poi);
    let binding;
    try {
      binding = await this.pois.createBinding({
        spotId: spot.spot_id,
        poiId: poi.poi_id,
        distanceM: distance,
        poiTypeOverride: body.poi_type_override ?? null,
        sortOrder: body.sort_order ?? null,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.throwAlreadyBound();
      }
      throw error;
    }
    const item = toAdminSpotPoiItem({ ...binding, poi });
    await this.recordAudit(admin, request, 'poi.bind', 'spot', spot.spot_id, null, {
      poi_id: poi.poi_id,
      distance_m: distance,
      poi_type_override: binding.poi_type_override,
    });
    return item;
  }

  async unbind(
    spotId: string,
    poiId: string,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<{ spot_id: string; poi_id: string; unbound: true }> {
    const spot = await this.requireSpot(spotId);
    const binding = await this.pois.findBinding(spot.spot_id, poiId);
    if (binding === null) {
      throw new AppError(
        ERROR_CODES.NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'POI binding not found',
      );
    }
    await this.pois.deleteBinding(spot.spot_id, poiId);
    await this.recordAudit(admin, request, 'poi.unbind', 'spot', spot.spot_id, {
      poi_id: poiId,
      distance_m: binding.distance_m,
    }, null);
    return { spot_id: spot.spot_id, poi_id: poiId, unbound: true };
  }

  async sync(
    spotId: string,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<PoiSyncRunItem> {
    const spot = await this.requireSpot(spotId);
    this.assertSyncable(spot);
    const { run, error } = await this.executeSync(spot);
    await this.recordAudit(admin, request, 'poi.sync', 'spot', spot.spot_id, null, run);
    if (error !== null) {
      throw new AppError(
        ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'POI sync failed; see the latest sync status for the provider reason',
      );
    }
    return run;
  }

  /**
   * Daily worker entry point. It intentionally has no admin actor: the durable
   * PoiSyncRun rows are the operational record, and successful syncs are cached
   * for 24 hours so a repeated cron invocation does not burn provider quota.
   */
  async syncDueSpots(limit = 100): Promise<{
    candidates: number;
    success: number;
    failed: number;
  }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const spots = await this.pois.findDueForSync(since, Math.min(Math.max(limit, 1), 500));
    let success = 0;
    let failed = 0;
    for (const spot of spots) {
      if (spot.latitude === null || spot.longitude === null) {
        continue;
      }
      try {
        const { error } = await this.executeSync(spot);
        if (error === null) {
          success += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { candidates: spots.length, success, failed };
  }

  private assertSyncable(spot: Spot): void {
    if (spot.latitude === null || spot.longitude === null) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'Spot coordinates are required before syncing POIs',
      );
    }
  }

  private async executeSync(
    spot: Spot,
  ): Promise<{ run: PoiSyncRunItem; error: string | null }> {
    this.assertSyncable(spot);
    const latitude = spot.latitude as Prisma.Decimal;
    const longitude = spot.longitude as Prisma.Decimal;
    const run = await this.pois.createSyncRun(spot.spot_id);
    try {
      const radius = await this.readIntConfig(
        'poi_sync_radius_m',
        DEFAULT_SYNC_RADIUS_M,
        MIN_SYNC_RADIUS_M,
        MAX_SYNC_RADIUS_M,
      );
      const maxPerType = await this.readIntConfig(
        'poi_sync_max_per_type',
        DEFAULT_MAX_PER_TYPE,
        1,
        MAX_MAX_PER_TYPE,
      );
      const result = await this.provider.searchNearby({
        latitude: latitude.toFixed(6),
        longitude: longitude.toFixed(6),
        radiusM: radius,
        maxPerType,
      });
      const selected = this.selectProviderItems(spot, result.items, radius, maxPerType);
      let poiCount = 0;
      for (const item of selected) {
        const poi = await this.pois.upsertSyncedPoi(item);
        await this.pois.upsertBinding(spot.spot_id, poi.poi_id, item.distanceM);
        poiCount += 1;
      }
      const finished = await this.pois.finishSyncRun(run.sync_id, {
        status: 'success',
        poiCount,
        quotaUsed: result.quotaUsed,
        errorMessage: null,
      });
      return { run: toPoiSyncRunItem(finished), error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await this.pois.finishSyncRun(run.sync_id, {
        status: 'failed',
        poiCount: 0,
        quotaUsed: 0,
        errorMessage: message.slice(0, 1_000),
      });
      return { run: toPoiSyncRunItem(failed), error: message };
    }
  }

  private selectProviderItems(
    spot: Spot,
    items: ProviderPoiItem[],
    radiusM: number,
    maxPerType: number,
  ): Array<ProviderPoiItem & { distanceM: number }> {
    const seen = new Set<string>();
    const candidates: Array<ProviderPoiItem & { distanceM: number }> = [];
    for (const item of items) {
      if (
        !POI_TYPE_VALUES.has(item.poi_type) ||
        !Number.isFinite(Number(item.latitude)) ||
        !Number.isFinite(Number(item.longitude)) ||
        !isShenzhenCoordinate(Number(item.latitude), Number(item.longitude)) ||
        seen.has(item.external_poi_id)
      ) {
        continue;
      }
      const distanceM = this.distanceFromSpot(spot, {
        latitude: item.latitude,
        longitude: item.longitude,
      });
      if (distanceM > radiusM) {
        continue;
      }
      seen.add(item.external_poi_id);
      candidates.push({ ...item, distanceM });
    }
    candidates.sort((left, right) => left.distanceM - right.distanceM);
    const perType = new Map<string, number>();
    return candidates.filter((item) => {
      const count = perType.get(item.poi_type) ?? 0;
      if (count >= maxPerType) {
        return false;
      }
      perType.set(item.poi_type, count + 1);
      return true;
    });
  }

  private distanceFromSpot(
    spot: Pick<Spot, 'latitude' | 'longitude'>,
    poi: Pick<Poi, 'latitude' | 'longitude'> | { latitude: string; longitude: string },
  ): number {
    if (spot.latitude === null || spot.longitude === null) {
      throw new Error('Spot coordinates are required');
    }
    const poiLatitude =
      typeof poi.latitude === 'string' ? Number(poi.latitude) : poi.latitude.toNumber();
    const poiLongitude =
      typeof poi.longitude === 'string' ? Number(poi.longitude) : poi.longitude.toNumber();
    return distanceMeters(
      spot.latitude.toNumber(),
      spot.longitude.toNumber(),
      poiLatitude,
      poiLongitude,
    );
  }

  private async readIntConfig(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): Promise<number> {
    const raw = await this.pois.getConfigValue(key);
    if (raw === null) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      return fallback;
    }
    return parsed;
  }

  private async requireSpot(spotId: string): Promise<Spot> {
    const spot = await this.pois.findSpot(spotId);
    if (spot === null) {
      throw new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'Spot not found');
    }
    return spot;
  }

  private throwPoiNotFound(): never {
    throw new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'POI not found');
  }

  private throwAlreadyBound(): never {
    throw new AppError(
      ERROR_CODES.STATE_CONFLICT,
      HttpStatus.CONFLICT,
      'POI is already bound to this spot',
    );
  }

  private async recordAudit(
    admin: AdminContext,
    request: RequestWithContext,
    action: string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    const userAgent = request.headers['user-agent'];
    await this.auditLogs.record({
      adminId: admin.adminId,
      action,
      entityType,
      entityId,
      before,
      after,
      ip: request.ip ?? null,
      requestId: request.requestId ?? null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    });
  }
}
