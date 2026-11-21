import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PRODUCT_STATUS } from '@szfisher/shared';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';

export const BRAND_PAGE_LIMIT = 100;

export type ProductWithChannels = Prisma.ProductGetPayload<{
  include: { channels: true };
}>;

export type AdminProductRow = Prisma.ProductGetPayload<{
  include: { channels: true; _count: { select: { placements: true } } };
}>;

export interface ProductChannelWrite {
  channel: string;
  external_product_id: string | null;
  purchase_action: string;
  action_payload: Prisma.InputJsonValue;
  price_display: string | null;
  status: string;
}

export interface AdminProductWriteData {
  product_id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  category: string;
  image_keys: string[];
  cover_image_key: string | null;
  status: string;
  sort_weight: number;
}

export interface AdminProductFilters {
  status?: string;
  category?: string;
  keyword?: string;
  page: number;
  pageSize: number;
}

export interface AdminProductPageRows {
  rows: AdminProductRow[];
  total: number;
}

const ADMIN_PRODUCT_INCLUDE = {
  channels: true,
  _count: { select: { placements: true } },
} satisfies Prisma.ProductInclude;

function channelCreateData(
  productId: string,
  channel: ProductChannelWrite,
): Prisma.ProductChannelUncheckedCreateInput {
  return {
    channel_id: ulid(),
    product_id: productId,
    channel: channel.channel,
    external_product_id: channel.external_product_id,
    purchase_action: channel.purchase_action,
    action_payload: channel.action_payload,
    price_display: channel.price_display,
    status: channel.status,
  };
}

/** Owns the public product reads and the admin product write path. */
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

  async findAdminPage(filters: AdminProductFilters): Promise<AdminProductPageRows> {
    const where: Prisma.ProductWhereInput = {
      deleted_at: null,
      ...(filters.status === undefined ? {} : { status: filters.status }),
      ...(filters.category === undefined ? {} : { category: filters.category }),
      ...(filters.keyword === undefined
        ? {}
        : { title: { contains: filters.keyword, mode: 'insensitive' } }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: ADMIN_PRODUCT_INCLUDE,
        orderBy: [{ updated_at: 'desc' }, { product_id: 'desc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { rows, total };
  }

  findAdminById(productId: string): Promise<AdminProductRow | null> {
    return this.prisma.product.findFirst({
      where: { product_id: productId, deleted_at: null },
      include: ADMIN_PRODUCT_INCLUDE,
    });
  }

  createAdminProduct(
    data: AdminProductWriteData,
    channels: ProductChannelWrite[],
  ): Promise<AdminProductRow> {
    return this.prisma.$transaction(async (tx) => {
      await tx.product.create({ data });
      if (channels.length > 0) {
        await tx.productChannel.createMany({
          data: channels.map((channel) => channelCreateData(data.product_id, channel)),
        });
      }
      return tx.product.findUniqueOrThrow({
        where: { product_id: data.product_id },
        include: ADMIN_PRODUCT_INCLUDE,
      });
    });
  }

  async updateAdminFields(
    productId: string,
    data: Prisma.ProductUncheckedUpdateInput,
  ): Promise<void> {
    await this.prisma.product.update({ where: { product_id: productId }, data });
  }

  /** Replaces the channel set: submitted channels are upserted, the rest removed. */
  async replaceAdminChannels(
    productId: string,
    channels: ProductChannelWrite[],
  ): Promise<void> {
    const submitted = channels.map((channel) => channel.channel);
    await this.prisma.$transaction(async (tx) => {
      await tx.productChannel.deleteMany({
        where: { product_id: productId, channel: { notIn: submitted } },
      });
      for (const channel of channels) {
        await tx.productChannel.upsert({
          where: {
            product_id_channel: { product_id: productId, channel: channel.channel },
          },
          create: channelCreateData(productId, channel),
          update: {
            external_product_id: channel.external_product_id,
            purchase_action: channel.purchase_action,
            action_payload: channel.action_payload,
            price_display: channel.price_display,
            status: channel.status,
          },
        });
      }
    });
  }
}
