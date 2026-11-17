import { Injectable } from '@nestjs/common';
import type { Prisma, Spot } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { DuplicateCandidate } from './admin-spot.types';

export interface AdminSpotFilters {
  status?: string;
  district?: string;
  keyword?: string;
  updatedFrom?: Date;
  updatedTo?: Date;
  page: number;
  pageSize: number;
}

export interface AdminSpotPageRows {
  rows: Spot[];
  total: number;
}

/** Owns every Prisma query for the admin spot write path. */
@Injectable()
export class AdminSpotsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPage(filters: AdminSpotFilters): Promise<AdminSpotPageRows> {
    const where: Prisma.SpotWhereInput = {
      deleted_at: null,
      ...(filters.status === undefined ? {} : { status: filters.status }),
      ...(filters.district === undefined ? {} : { district: filters.district }),
      ...(filters.keyword === undefined
        ? {}
        : { spot_name: { contains: filters.keyword, mode: 'insensitive' } }),
      ...(filters.updatedFrom === undefined && filters.updatedTo === undefined
        ? {}
        : {
            updated_at: {
              ...(filters.updatedFrom === undefined ? {} : { gte: filters.updatedFrom }),
              ...(filters.updatedTo === undefined ? {} : { lte: filters.updatedTo }),
            },
          }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.spot.findMany({
        where,
        orderBy: [{ updated_at: 'desc' }, { spot_id: 'desc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.spot.count({ where }),
    ]);
    return { rows, total };
  }

  findById(spotId: string): Promise<Spot | null> {
    return this.prisma.spot.findFirst({
      where: { spot_id: spotId, deleted_at: null },
    });
  }

  create(data: Prisma.SpotUncheckedCreateInput): Promise<Spot> {
    return this.prisma.spot.create({ data });
  }

  /**
   * Optimistic update: the caller must pass the loaded updated_at so a concurrent
   * publish or edit cannot be overwritten by a stale form.
   */
  async update(
    spotId: string,
    data: Prisma.SpotUncheckedUpdateManyInput,
    expectedUpdatedAt: Date,
  ): Promise<number> {
    const result = await this.prisma.spot.updateMany({
      where: { spot_id: spotId, deleted_at: null, updated_at: expectedUpdatedAt },
      data,
    });
    return result.count;
  }

  async transitionStatus(
    spotId: string,
    fromStatuses: string[],
    toStatus: string,
    expectedUpdatedAt: Date,
  ): Promise<number> {
    const result = await this.prisma.spot.updateMany({
      where: {
        spot_id: spotId,
        deleted_at: null,
        status: { in: fromStatuses },
        updated_at: expectedUpdatedAt,
      },
      data: { status: toStatus },
    });
    return result.count;
  }

  async softDelete(
    spotId: string,
    fromStatuses: string[],
    expectedUpdatedAt: Date,
  ): Promise<number> {
    const result = await this.prisma.spot.updateMany({
      where: {
        spot_id: spotId,
        deleted_at: null,
        status: { in: fromStatuses },
        updated_at: expectedUpdatedAt,
      },
      data: { deleted_at: new Date() },
    });
    return result.count;
  }

  async markVerified(spotId: string): Promise<Spot | null> {
    const result = await this.prisma.spot.updateMany({
      where: { spot_id: spotId, deleted_at: null },
      data: { verified_at: new Date() },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.spot.findFirst({
      where: { spot_id: spotId, deleted_at: null },
    });
  }

  findDuplicateCandidates(
    district: string,
    excludeSpotId: string,
    latitude: number,
    longitude: number,
  ): Promise<DuplicateCandidate[]> {
    // 0.002 degrees is at least 205 m in Shenzhen, safely enclosing the 200 m rule.
    const delta = 0.002;
    return this.prisma.spot.findMany({
      where: {
        deleted_at: null,
        district,
        spot_id: { not: excludeSpotId },
        latitude: { gte: latitude - delta, lte: latitude + delta },
        longitude: { gte: longitude - delta, lte: longitude + delta },
      },
      select: {
        spot_id: true,
        spot_name: true,
        latitude: true,
        longitude: true,
      },
      orderBy: { spot_id: 'asc' },
    });
  }
}
