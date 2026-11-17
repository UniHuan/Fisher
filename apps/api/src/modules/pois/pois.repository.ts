import { Injectable } from '@nestjs/common';
import type {
  Poi,
  PoiSyncRun,
  Prisma,
  Spot,
  SpotPoi,
} from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProviderPoiItem } from './poi.types';

export interface AdminPoiFilters {
  poiType?: string;
  status?: string;
  keyword?: string;
  page: number;
  pageSize: number;
}

export interface AdminPoiPageRows {
  rows: Poi[];
  total: number;
}

export type SpotPoiWithPoi = SpotPoi & { poi: Poi };

@Injectable()
export class PoisRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPage(filters: AdminPoiFilters): Promise<AdminPoiPageRows> {
    const where: Prisma.PoiWhereInput = {
      ...(filters.poiType === undefined ? {} : { poi_type: filters.poiType }),
      ...(filters.status === undefined ? {} : { status: filters.status }),
      ...(filters.keyword === undefined
        ? {}
        : { poi_name: { contains: filters.keyword, mode: 'insensitive' } }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.poi.findMany({
        where,
        orderBy: [{ updated_at: 'desc' }, { poi_id: 'desc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.poi.count({ where }),
    ]);
    return { rows, total };
  }

  findById(poiId: string): Promise<Poi | null> {
    return this.prisma.poi.findUnique({ where: { poi_id: poiId } });
  }

  create(data: Prisma.PoiUncheckedCreateInput): Promise<Poi> {
    return this.prisma.poi.create({ data });
  }

  update(poiId: string, data: Prisma.PoiUncheckedUpdateInput): Promise<Poi> {
    return this.prisma.poi.update({ where: { poi_id: poiId }, data });
  }

  findSpot(spotId: string): Promise<Spot | null> {
    return this.prisma.spot.findFirst({
      where: { spot_id: spotId, deleted_at: null },
    });
  }

  findSpotPois(spotId: string): Promise<SpotPoiWithPoi[]> {
    return this.prisma.spotPoi.findMany({
      where: { spot_id: spotId },
      include: { poi: true },
      orderBy: [{ distance_m: 'asc' }, { poi: { poi_name: 'asc' } }],
    });
  }

  findBinding(spotId: string, poiId: string): Promise<SpotPoi | null> {
    return this.prisma.spotPoi.findUnique({
      where: { spot_id_poi_id: { spot_id: spotId, poi_id: poiId } },
    });
  }

  createBinding(data: {
    spotId: string;
    poiId: string;
    distanceM: number;
    poiTypeOverride: string | null;
    sortOrder: number | null;
  }): Promise<SpotPoi> {
    return this.prisma.spotPoi.create({
      data: {
        spot_id: data.spotId,
        poi_id: data.poiId,
        distance_m: data.distanceM,
        poi_type_override: data.poiTypeOverride,
        sort_order: data.sortOrder,
      },
    });
  }

  async deleteBinding(spotId: string, poiId: string): Promise<number> {
    const result = await this.prisma.spotPoi.deleteMany({
      where: { spot_id: spotId, poi_id: poiId },
    });
    return result.count;
  }

  findDueForSync(since: Date, limit: number): Promise<Spot[]> {
    return this.prisma.spot.findMany({
      where: {
        status: 'published',
        deleted_at: null,
        latitude: { not: null },
        longitude: { not: null },
        // The 24-hour cache rule: skip spots that already synced successfully today.
        poi_sync_runs: {
          none: { status: 'success', started_at: { gte: since } },
        },
      },
      orderBy: [{ is_core: 'desc' }, { spot_id: 'asc' }],
      take: limit,
    });
  }

  findLatestSync(spotId: string): Promise<PoiSyncRun | null> {
    return this.prisma.poiSyncRun.findFirst({
      where: { spot_id: spotId },
      orderBy: [{ started_at: 'desc' }, { sync_id: 'desc' }],
    });
  }

  createSyncRun(spotId: string): Promise<PoiSyncRun> {
    return this.prisma.poiSyncRun.create({
      data: {
        sync_id: ulid(),
        spot_id: spotId,
        status: 'running',
      },
    });
  }

  finishSyncRun(
    syncId: string,
    data: {
      status: string;
      poiCount: number;
      quotaUsed: number;
      errorMessage: string | null;
    },
  ): Promise<PoiSyncRun> {
    return this.prisma.poiSyncRun.update({
      where: { sync_id: syncId },
      data: {
        status: data.status,
        poi_count: data.poiCount,
        quota_used: data.quotaUsed,
        error_message: data.errorMessage,
        finished_at: new Date(),
      },
    });
  }

  async getConfigValue(key: string): Promise<string | null> {
    const row = await this.prisma.config.findUnique({ where: { config_key: key } });
    return row?.config_value ?? null;
  }

  upsertSyncedPoi(item: ProviderPoiItem): Promise<Poi> {
    return this.prisma.poi.upsert({
      where: {
        source_external_poi_id: {
          source: 'tencent',
          external_poi_id: item.external_poi_id,
        },
      },
      create: {
        poi_id: ulid(),
        external_poi_id: item.external_poi_id,
        poi_name: item.poi_name,
        poi_type: item.poi_type,
        latitude: item.latitude,
        longitude: item.longitude,
        address: item.address,
        rating: item.rating,
        open_time: item.open_time,
        source: 'tencent',
        status: 'active',
      },
      update: {
        poi_name: item.poi_name,
        poi_type: item.poi_type,
        latitude: item.latitude,
        longitude: item.longitude,
        address: item.address,
        rating: item.rating,
        open_time: item.open_time,
      },
    });
  }

  upsertBinding(spotId: string, poiId: string, distanceM: number): Promise<SpotPoi> {
    return this.prisma.spotPoi.upsert({
      where: { spot_id_poi_id: { spot_id: spotId, poi_id: poiId } },
      create: { spot_id: spotId, poi_id: poiId, distance_m: distanceM },
      update: { distance_m: distanceM },
    });
  }
}
