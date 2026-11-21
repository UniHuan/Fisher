import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PLACEMENT_SCOPE } from '@szfisher/shared';
import { PrismaService } from '../../prisma/prisma.service';

const ACTIVE_STATUS = 'active';
const SCOPE_ORDER = new Map<string, number>([
  [PLACEMENT_SCOPE.SPOT, 0],
  [PLACEMENT_SCOPE.FISH, 1],
]);

export interface PlacementMatch {
  placement_id: string;
  product_id: string;
  scope: string;
  sort_order: number;
}

/**
 * Resolves the active placements that apply to a public surface request.
 * Spot matches always sort before fish matches, then by sort_order.
 */
@Injectable()
export class PlacementService {
  constructor(private readonly prisma: PrismaService) {}

  async match(
    surface: string,
    targetId?: string,
    fishKeys?: string[],
  ): Promise<PlacementMatch[]> {
    const requestedFishKeys = (fishKeys ?? []).filter((key) => key.length > 0);
    const scopeFilters: Prisma.ProductPlacementWhereInput[] = [];
    if (targetId !== undefined) {
      scopeFilters.push({ scope: PLACEMENT_SCOPE.SPOT, target_id: targetId });
    }
    if (requestedFishKeys.length > 0) {
      scopeFilters.push({
        scope: PLACEMENT_SCOPE.FISH,
        fish_keys: { hasSome: requestedFishKeys },
      });
    }
    if (scopeFilters.length === 0) {
      return [];
    }

    const now = new Date();
    const rows = await this.prisma.productPlacement.findMany({
      where: {
        surface,
        status: ACTIVE_STATUS,
        AND: [
          { OR: [{ starts_at: null }, { starts_at: { lte: now } }] },
          { OR: [{ ends_at: null }, { ends_at: { gte: now } }] },
          { OR: scopeFilters },
        ],
      },
      select: {
        placement_id: true,
        product_id: true,
        scope: true,
        sort_order: true,
      },
    });

    return rows.sort((left, right) => {
      const scopeDiff =
        (SCOPE_ORDER.get(left.scope) ?? Number.MAX_SAFE_INTEGER) -
        (SCOPE_ORDER.get(right.scope) ?? Number.MAX_SAFE_INTEGER);
      if (scopeDiff !== 0) {
        return scopeDiff;
      }
      if (left.sort_order !== right.sort_order) {
        return left.sort_order - right.sort_order;
      }
      return left.placement_id.localeCompare(right.placement_id);
    });
  }
}
