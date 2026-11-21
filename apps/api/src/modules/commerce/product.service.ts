import { HttpStatus, Injectable } from '@nestjs/common';
import type { ProductChannel } from '@prisma/client';
import {
  COMMERCE_CHANNEL,
  ERROR_CODES,
  PRODUCT_QUERY_SURFACE,
} from '@szfisher/shared';
import { AppError } from '../../common/errors/app-error';
import { ClientConfigService } from '../config/config.service';
import { StorageService } from '../storage/storage.service';
import type { PublicProductQueryDto } from './dto/public-product-query.dto';
import type { ProductCardDto, ProductCardListDto } from './dto/product-card.dto';
import type { PurchaseActionDto } from './dto/purchase-action.dto';
import { PlacementService } from './placement.service';
import { ProductRepository, type ProductWithChannels } from './product.repository';

const CHANNEL_STATUS_ACTIVE = 'active';
const SPOT_DETAIL_DEFAULT_LIMIT = 6;
const CHANNEL_LABELS: Record<string, string> = {
  [COMMERCE_CHANNEL.WEIDIAN]: '微店',
  [COMMERCE_CHANNEL.JD]: '京东',
};
const CHANNEL_ORDER = new Map<string, number>([
  [COMMERCE_CHANNEL.WEIDIAN, 0],
  [COMMERCE_CHANNEL.JD, 1],
]);

function channelRank(channel: string): number {
  return CHANNEL_ORDER.get(channel) ?? Number.MAX_SAFE_INTEGER;
}

function toPurchaseAction(channel: ProductChannel): PurchaseActionDto {
  const payload = (channel.action_payload ?? {}) as Record<string, unknown>;
  return { ...payload, type: channel.purchase_action } as unknown as PurchaseActionDto;
}

@Injectable()
export class ProductService {
  constructor(
    private readonly config: ClientConfigService,
    private readonly products: ProductRepository,
    private readonly placements: PlacementService,
    private readonly storage: StorageService,
  ) {}

  async listPublic(query: PublicProductQueryDto): Promise<ProductCardListDto> {
    const clientConfig = await this.config.getClientConfig();
    if (!clientConfig.features.shop) {
      return { items: [] };
    }

    switch (query.surface) {
      case PRODUCT_QUERY_SURFACE.BRAND_PAGE:
        return this.listBrandPage(query.category);
      case PRODUCT_QUERY_SURFACE.SPOT_DETAIL:
        return this.listSpotDetail(query);
      default:
        // home and report_detail are reserved surfaces that stay empty in V1.
        return { items: [] };
    }
  }

  private async listBrandPage(category?: string): Promise<ProductCardListDto> {
    const rows = await this.products.listBrandPage(category);
    return { items: this.toCards(rows) };
  }

  private async listSpotDetail(query: PublicProductQueryDto): Promise<ProductCardListDto> {
    if (query.target_id === undefined) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'target_id is required for spot_detail',
      );
    }

    const matches = await this.placements.match(
      query.surface,
      query.target_id,
      query.fish_keys,
    );
    const orderedIds: string[] = [];
    const seen = new Set<string>();
    for (const match of matches) {
      if (!seen.has(match.product_id)) {
        seen.add(match.product_id);
        orderedIds.push(match.product_id);
      }
    }
    if (orderedIds.length === 0) {
      return { items: [] };
    }

    const rows = await this.products.findActiveByIds(orderedIds);
    const rowById = new Map(rows.map((row) => [row.product_id, row]));
    const limit = query.limit ?? SPOT_DETAIL_DEFAULT_LIMIT;
    const items: ProductCardDto[] = [];
    for (const productId of orderedIds) {
      const row = rowById.get(productId);
      if (row === undefined) {
        continue;
      }
      const card = this.toCard(row);
      if (card === null) {
        continue;
      }
      items.push(card);
      if (items.length >= limit) {
        break;
      }
    }
    return { items };
  }

  private toCards(rows: ProductWithChannels[]): ProductCardDto[] {
    const cards: ProductCardDto[] = [];
    for (const row of rows) {
      const card = this.toCard(row);
      if (card !== null) {
        cards.push(card);
      }
    }
    return cards;
  }

  /** Products without an active channel are unusable and stay out of public cards. */
  private toCard(product: ProductWithChannels): ProductCardDto | null {
    const activeChannels = product.channels
      .filter((channel) => channel.status === CHANNEL_STATUS_ACTIVE)
      .sort((left, right) => channelRank(left.channel) - channelRank(right.channel));
    if (activeChannels.length === 0) {
      return null;
    }

    return {
      product_id: product.product_id,
      title: product.title,
      subtitle: product.subtitle,
      category: product.category,
      image_url: this.imageUrl(product),
      channels: activeChannels.map((channel) => ({
        channel: channel.channel,
        label: CHANNEL_LABELS[channel.channel] ?? channel.channel,
        price_display: channel.price_display,
        purchase_action: toPurchaseAction(channel),
      })),
    };
  }

  private imageUrl(product: ProductWithChannels): string | null {
    const key = product.cover_image_key ?? product.image_keys[0];
    if (key === undefined || key === null) {
      return null;
    }
    try {
      return this.storage.getPublicUrl(key);
    } catch {
      return null;
    }
  }
}
