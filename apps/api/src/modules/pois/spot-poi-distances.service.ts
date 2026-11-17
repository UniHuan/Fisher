import { Injectable } from '@nestjs/common';
import type { Poi, Spot } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { distanceMeters } from './poi-distance';

/**
 * Keeps spot_poi.distance_m aligned when either side of the relation moves.
 * Binding and syncing compute the initial value; coordinate edits call these
 * methods so public distance sorting never uses a stale value.
 */
@Injectable()
export class SpotPoiDistancesService {
  constructor(private readonly prisma: PrismaService) {}

  async recalculateForSpot(spotId: string): Promise<number> {
    const spot = await this.prisma.spot.findFirst({
      where: { spot_id: spotId, deleted_at: null },
    });
    if (spot === null || spot.latitude === null || spot.longitude === null) {
      return 0;
    }
    const bindings = await this.prisma.spotPoi.findMany({
      where: { spot_id: spotId },
      include: { poi: true },
    });
    return this.updateDistances(
      bindings.map((binding) => ({
        spotId: binding.spot_id,
        poiId: binding.poi_id,
        distance: this.distance(spot, binding.poi),
      })),
    );
  }

  async recalculateForPoi(poiId: string): Promise<number> {
    const poi = await this.prisma.poi.findUnique({ where: { poi_id: poiId } });
    if (poi === null) {
      return 0;
    }
    const bindings = await this.prisma.spotPoi.findMany({
      where: { poi_id: poiId },
      include: { spot: true },
    });
    return this.updateDistances(
      bindings
        .filter(
          (binding) =>
            binding.spot.latitude !== null && binding.spot.longitude !== null,
        )
        .map((binding) => ({
          spotId: binding.spot_id,
          poiId: binding.poi_id,
          distance: this.distance(binding.spot, poi),
        })),
    );
  }

  private distance(spot: Spot, poi: Poi): number | null {
    if (spot.latitude === null || spot.longitude === null) {
      return null;
    }
    return distanceMeters(
      spot.latitude.toNumber(),
      spot.longitude.toNumber(),
      poi.latitude.toNumber(),
      poi.longitude.toNumber(),
    );
  }

  private async updateDistances(
    rows: Array<{ spotId: string; poiId: string; distance: number | null }>,
  ): Promise<number> {
    let updated = 0;
    for (const row of rows) {
      if (row.distance === null) {
        continue;
      }
      const result = await this.prisma.spotPoi.updateMany({
        where: { spot_id: row.spotId, poi_id: row.poiId },
        data: { distance_m: row.distance },
      });
      updated += result.count;
    }
    return updated;
  }
}
