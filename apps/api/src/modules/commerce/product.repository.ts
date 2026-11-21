import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PRODUCT_STATUS } from '@szfisher/shared';
import { PrismaService } from '../../prisma/prisma.service';

export const BRAND_PAGE_LIMIT = 100;

export type ProductWithChannels = Prisma.ProductGetPayload<{
  include: { channels: true };
}>;

/** Owns the public product reads. Admin writes live in later tasks. */
@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  listBrandPage(category?: string): Promise<ProductWithChannels[]> {
    return this.prisma.product.findMany({
      where: {
        status: PRODUCT_STATUS.ACTIVE,
        deleted_at: null,
        ...(category === undefined ? {} : { category }),
      },
      include: { channels: true },
      orderBy: [{ sort_weight: 'desc' }, { product_id: 'asc' }],
      take: BRAND_PAGE_LIMIT,
    });
  }

  findActiveByIds(productIds: string[]): Promise<ProductWithChannels[]> {
    if (productIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.prisma.product.findMany({
      where: {
        product_id: { in: productIds },
        status: PRODUCT_STATUS.ACTIVE,
        deleted_at: null,
      },
      include: { channels: true },
    });
  }
}
