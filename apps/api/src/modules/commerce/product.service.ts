import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma, ProductChannel } from '@prisma/client';
import {
  COMMERCE_CHANNEL,
  ERROR_CODES,
  PRODUCT_QUERY_SURFACE,
  PRODUCT_STATUS,
  normalizeKeyword,
} from '@szfisher/shared';
import { ulid } from 'ulid';
import { AppError } from '../../common/errors/app-error';
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
import { AuditLogService } from '../audit/audit-log.service';
import { ClientConfigService } from '../config/config.service';
import { PREVIEW_URL_TTL_SECONDS, StorageService } from '../storage/storage.service';
import { PreviewSignerService } from '../uploads/preview-signer.service';
import type {
  AdminProductChannelDto,
  AdminProductDetailDto,
  AdminProductListItemDto,
  AdminProductListQueryDto,
  AdminProductPageDto,
} from './dto/admin-product.dto';
import {
  PRODUCT_IMAGE_KEY_PATTERN,
  type CreateProductDto,
  type ProductChannelInputDto,
} from './dto/create-product.dto';
import type { PublicProductQueryDto } from './dto/public-product-query.dto';
import type { ProductCardDto, ProductCardListDto } from './dto/product-card.dto';
import type { PurchaseActionDto, PurchaseActionInputDto } from './dto/purchase-action.dto';
import type { UpdateProductDto } from './dto/update-product.dto';
import { PlacementService } from './placement.service';
import { ProductImageService } from './product-image.service';
import {
  ProductRepository,
  type AdminProductRow,
  type AdminProductWriteData,
  type ProductChannelWrite,
  type ProductWithChannels,
} from './product.repository';
import { PurchaseActionService } from './purchase-action.service';

const CHANNEL_STATUS_ACTIVE = 'active';
const SPOT_DETAIL_DEFAULT_LIMIT = 6;
const ADMIN_PAGE_DEFAULT_SIZE = 20;
const V1_CHANNELS_PER_PRODUCT = 1;
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
    private readonly purchaseActions: PurchaseActionService,
    private readonly productImages: ProductImageService,
    private readonly previewSigner: PreviewSignerService,
    private readonly auditLogs: AuditLogService,
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

  async listAdmin(query: AdminProductListQueryDto): Promise<AdminProductPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? ADMIN_PAGE_DEFAULT_SIZE;
    const keyword = query.keyword === undefined ? undefined : normalizeKeyword(query.keyword);
    const { rows, total } = await this.products.findAdminPage({
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(keyword === undefined || keyword.length === 0 ? {} : { keyword }),
      page,
      pageSize,
    });
    return {
      items: rows.map((row) => this.toAdminListItem(row)),
      page,
      page_size: pageSize,
      total,
      has_more: page * pageSize < total,
    };
  }

  async getAdmin(productId: string): Promise<AdminProductDetailDto> {
    return this.toAdminDetail(await this.findAdminRow(productId));
  }

  async create(
    input: CreateProductDto,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminProductDetailDto> {
    const channels = this.channelWrites(input.channels);
    // The id exists before validation so create cannot attach another product's images.
    const productId = ulid();
    const imageKeys = input.image_keys ?? [];
    const coverImageKey = input.cover_image_key ?? null;
    this.assertImageKeysOwned(productId, imageKeys, coverImageKey);
    this.assertCoverInImageKeys(coverImageKey, imageKeys);

    const data: AdminProductWriteData = {
      product_id: productId,
      title: input.title,
      subtitle: input.subtitle ?? null,
      description: input.description ?? null,
      category: input.category,
      image_keys: imageKeys,
      cover_image_key: coverImageKey,
      // R2: create always lands as a draft; publishing happens through update.
      status: PRODUCT_STATUS.DRAFT,
      sort_weight: input.sort_weight ?? 0,
    };
    const row = await this.products.createAdminProduct(data, channels);
    await this.recordAudit(admin, request, 'product.create', row.product_id, null, this.auditSummary(row));
    return this.toAdminDetail(row);
  }

  async update(
    productId: string,
    input: UpdateProductDto,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminProductDetailDto> {
    const existing = await this.findAdminRow(productId);
    if (input.image_keys !== undefined) {
      this.assertImageKeysOwned(productId, input.image_keys);
    }
    if (input.cover_image_key !== undefined) {
      this.assertImageKeysOwned(productId, [], input.cover_image_key);
    }
    const imageKeys = input.image_keys ?? existing.image_keys;
    let coverImageKey: string | null;
    if (input.cover_image_key !== undefined) {
      coverImageKey = input.cover_image_key;
      this.assertCoverInImageKeys(coverImageKey, imageKeys);
    } else if (
      existing.cover_image_key !== null &&
      imageKeys.includes(existing.cover_image_key)
    ) {
      coverImageKey = existing.cover_image_key;
    } else {
      // The submitted image set dropped the previous cover, so the invariant clears it.
      coverImageKey = null;
    }
    const channels =
      input.channels === undefined ? undefined : this.channelWrites(input.channels);
    const nextStatus = input.status ?? existing.status;
    const becomingActive =
      nextStatus === PRODUCT_STATUS.ACTIVE && existing.status !== PRODUCT_STATUS.ACTIVE;
    const activeImagesChanged =
      nextStatus === PRODUCT_STATUS.ACTIVE &&
      existing.status === PRODUCT_STATUS.ACTIVE &&
      input.image_keys !== undefined;
    const willPublish = becomingActive || activeImagesChanged;
    if (willPublish) {
      // Design 9.2: validate the final state before anything is written.
      this.assertPublishable(imageKeys, channels ?? existing.channels);
    }

    if (activeImagesChanged) {
      // The product is already active, so publish the submitted set before the
      // persisted keys change. A failure leaves the previous image set in place.
      await this.productImages.publishKeys(productId, imageKeys);
    }

    // R13: for draft activation, fields and image_keys land before any image is published.
    await this.products.updateAdminFields(productId, {
      title: input.title ?? existing.title,
      subtitle: input.subtitle !== undefined ? input.subtitle : existing.subtitle,
      description:
        input.description !== undefined ? input.description : existing.description,
      category: input.category ?? existing.category,
      sort_weight: input.sort_weight ?? existing.sort_weight,
      image_keys: imageKeys,
      cover_image_key: coverImageKey,
    });
    if (channels !== undefined) {
      await this.products.replaceAdminChannels(productId, channels);
    }

    if (becomingActive) {
      // Never mark active before images reach the published bucket.
      await this.productImages.publishForProduct(productId);
    }
    if (nextStatus !== existing.status) {
      await this.products.updateAdminFields(productId, { status: nextStatus });
    }

    const row = await this.findAdminRow(productId);
    await this.recordAudit(
      admin,
      request,
      'product.update',
      productId,
      this.auditSummary(existing),
      this.auditSummary(row),
    );
    return this.toAdminDetail(row);
  }

  async archive(
    productId: string,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminProductDetailDto> {
    const existing = await this.findAdminRow(productId);
    if (existing.status === PRODUCT_STATUS.ARCHIVED) {
      return this.toAdminDetail(existing);
    }

    await this.products.updateAdminFields(productId, { status: PRODUCT_STATUS.ARCHIVED });
    const row = await this.findAdminRow(productId);
    await this.recordAudit(
      admin,
      request,
      'product.archive',
      productId,
      this.auditSummary(existing),
      this.auditSummary(row),
    );
    return this.toAdminDetail(row);
  }

  private async findAdminRow(productId: string): Promise<AdminProductRow> {
    const row = await this.products.findAdminById(productId);
    if (row === null) {
      throw new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'Product not found');
    }
    return row;
  }

  private channelWrites(inputs: ProductChannelInputDto[]): ProductChannelWrite[] {
    if (inputs.length > V1_CHANNELS_PER_PRODUCT) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'V1 supports exactly one commerce channel per product',
      );
    }
    return inputs.map((input) => {
      // The action type is the channel's purchase_action; any type in the payload is ignored.
      const action = this.purchaseActions.validate(input.channel, {
        ...input.action_payload,
        type: input.purchase_action,
      } as PurchaseActionInputDto);
      return {
        channel: input.channel,
        external_product_id: input.external_product_id ?? null,
        purchase_action: action.type,
        action_payload: action as unknown as Prisma.InputJsonValue,
        price_display: input.price_display ?? null,
        status: input.status ?? CHANNEL_STATUS_ACTIVE,
      };
    });
  }

  /** Every submitted key must be a server-shaped key owned by this product. */
  private assertImageKeysOwned(
    productId: string,
    imageKeys: string[],
    coverImageKey: string | null = null,
  ): void {
    const ownerPrefix = `products/${productId}/`;
    const keys = coverImageKey === null ? imageKeys : [...imageKeys, coverImageKey];
    const invalid = keys.some(
      (key) => !key.startsWith(ownerPrefix) || !PRODUCT_IMAGE_KEY_PATTERN.test(key),
    );
    if (invalid) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'Image keys must belong to this product',
      );
    }
  }

  private assertCoverInImageKeys(coverImageKey: string | null, imageKeys: string[]): void {
    if (coverImageKey !== null && !imageKeys.includes(coverImageKey)) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'cover_image_key must be one of image_keys',
      );
    }
  }

  /** Design 9.2: publishing requires at least one image and one active channel. */
  private assertPublishable(
    imageKeys: string[],
    channels: Array<{ status: string }>,
  ): void {
    if (imageKeys.length === 0) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'Publishing requires at least one image',
      );
    }
    if (!channels.some((channel) => channel.status === CHANNEL_STATUS_ACTIVE)) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        HttpStatus.BAD_REQUEST,
        'Publishing requires at least one active channel',
      );
    }
  }

  private async recordAudit(
    admin: AdminContext,
    request: RequestWithContext,
    action: string,
    productId: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    const userAgent = request.headers['user-agent'];
    await this.auditLogs.record({
      adminId: admin.adminId,
      action,
      entityType: 'product',
      entityId: productId,
      before,
      after,
      ip: request.ip ?? null,
      requestId: request.requestId ?? null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    });
  }

  /** Audit rows keep only compact identity fields; description text never leaves this map. */
  private auditSummary(row: {
    title: string;
    status: string;
    category: string;
    channels: Array<{ channel: string }>;
  }): { title: string; status: string; category: string; channels: string[] } {
    return {
      title: row.title,
      status: row.status,
      category: row.category,
      channels: row.channels.map((channel) => channel.channel),
    };
  }

  private toAdminListItem(row: AdminProductRow): AdminProductListItemDto {
    const published = row.status === PRODUCT_STATUS.ACTIVE;
    return {
      product_id: row.product_id,
      title: row.title,
      subtitle: row.subtitle,
      category: row.category,
      status: row.status,
      sort_weight: row.sort_weight,
      cover_image_url:
        row.cover_image_key === null
          ? null
          : this.adminImageUrl(row.cover_image_key, published),
      channel_count: row.channels.length,
      placement_count: row._count.placements,
      updated_at: row.updated_at.toISOString(),
    };
  }

  private toAdminDetail(row: AdminProductRow): AdminProductDetailDto {
    const published = row.status === PRODUCT_STATUS.ACTIVE;
    // Keep image_urls index-aligned with image_keys; a malformed key yields null.
    const imageUrls = row.image_keys.map((key) => this.adminImageUrl(key, published));
    return {
      product_id: row.product_id,
      title: row.title,
      subtitle: row.subtitle,
      description: row.description,
      category: row.category,
      sort_weight: row.sort_weight,
      status: row.status,
      image_keys: row.image_keys,
      image_urls: imageUrls,
      cover_image_key: row.cover_image_key,
      cover_image_url:
        row.cover_image_key === null
          ? null
          : this.adminImageUrl(row.cover_image_key, published),
      channels: [...row.channels]
        .sort((left, right) => channelRank(left.channel) - channelRank(right.channel))
        .map((channel) => this.toAdminChannel(channel)),
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  private toAdminChannel(channel: ProductChannel): AdminProductChannelDto {
    return {
      channel_id: channel.channel_id,
      channel: channel.channel,
      external_product_id: channel.external_product_id,
      purchase_action: channel.purchase_action,
      action_payload: (channel.action_payload ?? {}) as Record<string, unknown>,
      price_display: channel.price_display,
      status: channel.status,
    };
  }

  /**
   * Only active products read the published bucket. Draft and archived products
   * use signed working previews, because an archived draft never published images.
   */
  private adminImageUrl(key: string, published: boolean): string | null {
    try {
      if (!PRODUCT_IMAGE_KEY_PATTERN.test(key)) {
        return null;
      }
      return published
        ? this.storage.getPublicUrl(key)
        : this.previewSigner.sign(key, 'working', PREVIEW_URL_TTL_SECONDS).url;
    } catch {
      return null;
    }
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
