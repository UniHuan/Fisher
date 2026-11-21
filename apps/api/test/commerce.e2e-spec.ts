import type { INestApplication } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  COMMERCE_CHANNEL,
  ERROR_CODES,
  PLACEMENT_SCOPE,
  PLACEMENT_SURFACE,
  PRODUCT_CATEGORY,
  PRODUCT_STATUS,
  PURCHASE_ACTION_TYPE,
} from '@szfisher/shared';
import request from 'supertest';
import { ulid } from 'ulid';
import { createTestApp } from './create-test-app';
import { cleanupAuthTestData, getAuthTestPrisma } from './support/auth-helpers';

jest.setTimeout(60000);

const HEADERS = {
  'X-Client-Type': 'miniprogram',
  'X-Client-Version': '1.0.0',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const SHOP_FLAG_KEY = 'features.shop';

const SPOT_TARGET = ulid();
const OTHER_SPOT = ulid();
const FISH_SPOT = ulid();
const PRIORITY_SPOT = ulid();
const WINDOW_SPOT = ulid();
const LINE_SPOT = ulid();
const LIMIT_SPOT = ulid();

interface ProductChannelCard {
  channel: string;
  label: string;
  price_display: string | null;
  purchase_action: Record<string, unknown>;
}

interface ProductCard {
  product_id: string;
  title: string;
  subtitle: string | null;
  category: string;
  image_url: string | null;
  channels: ProductChannelCard[];
}

interface Envelope<T> {
  code: number;
  message: string;
  data: T;
  request_id: string;
}

interface SeedChannel {
  channel?: string;
  status?: string;
  price_display?: string | null;
  purchase_action?: string;
  action_payload?: Prisma.InputJsonValue;
}

interface SeedProductInput {
  product_id?: string;
  title?: string;
  subtitle?: string | null;
  category?: string;
  status?: string;
  sort_weight?: number;
  image_keys?: string[];
  cover_image_key?: string | null;
  deleted_at?: Date | null;
  channels?: SeedChannel[];
}

interface SeedPlacementInput {
  product_id: string;
  scope?: string;
  target_id?: string | null;
  fish_keys?: string[];
  sort_order?: number;
  status?: string;
  starts_at?: Date | null;
  ends_at?: Date | null;
  surface?: string;
}

const trackedProductIds: string[] = [];
let app: INestApplication;
let prisma: PrismaClient;
let originalShopRow: { config_key: string; config_value: string } | null = null;

const DEFAULT_ACTION: Prisma.InputJsonValue = {
  type: PURCHASE_ACTION_TYPE.COPY_LINK,
  url: 'https://weidian.com/item.html?itemID=1',
};

async function seedProduct(input: SeedProductInput = {}): Promise<string> {
  const productId = input.product_id ?? ulid();
  await prisma.product.create({
    data: {
      product_id: productId,
      title: input.title ?? 'UniHuan 测试商品',
      subtitle: input.subtitle ?? null,
      category: input.category ?? PRODUCT_CATEGORY.OTHER,
      status: input.status ?? PRODUCT_STATUS.ACTIVE,
      sort_weight: input.sort_weight ?? 0,
      image_keys: input.image_keys ?? [],
      cover_image_key: input.cover_image_key ?? null,
      deleted_at: input.deleted_at ?? null,
    },
  });
  const channels = input.channels ?? [{}];
  if (channels.length > 0) {
    await prisma.productChannel.createMany({
      data: channels.map((channel) => ({
        channel_id: ulid(),
        product_id: productId,
        channel: channel.channel ?? COMMERCE_CHANNEL.WEIDIAN,
        external_product_id: null,
        purchase_action: channel.purchase_action ?? PURCHASE_ACTION_TYPE.COPY_LINK,
        action_payload: channel.action_payload ?? DEFAULT_ACTION,
        price_display: channel.price_display ?? null,
        status: channel.status ?? 'active',
      })),
    });
  }
  trackedProductIds.push(productId);
  return productId;
}

async function seedPlacement(input: SeedPlacementInput): Promise<string> {
  const placementId = ulid();
  await prisma.productPlacement.create({
    data: {
      placement_id: placementId,
      product_id: input.product_id,
      surface: input.surface ?? PLACEMENT_SURFACE.SPOT_DETAIL,
      scope: input.scope ?? PLACEMENT_SCOPE.SPOT,
      target_id: input.target_id ?? null,
      fish_keys: input.fish_keys ?? [],
      sort_order: input.sort_order ?? 0,
      starts_at: input.starts_at ?? null,
      ends_at: input.ends_at ?? null,
      status: input.status ?? 'active',
    },
  });
  return placementId;
}

async function setShopFeature(enabled: boolean): Promise<void> {
  await prisma.config.upsert({
    where: { config_key: SHOP_FLAG_KEY },
    create: { config_key: SHOP_FLAG_KEY, config_value: enabled ? 'true' : 'false' },
    update: { config_value: enabled ? 'true' : 'false' },
  });
}

function listProducts(query: string): request.Test {
  return request(app.getHttpServer())
    .get(`/api/v1/products?${query}`)
    .set(HEADERS);
}

function itemsOf(body: Envelope<{ items: ProductCard[] }>): ProductCard[] {
  return body.data.items;
}

function idsOf(body: Envelope<{ items: ProductCard[] }>): string[] {
  return itemsOf(body).map((item) => item.product_id);
}

describe('public products (e2e)', () => {
  let rodA = '';
  let rodB = '';
  let rodC = '';
  let reel = '';
  let baitSingle = '';
  let baitOrdered = '';
  let baitJd = '';
  let spotProduct = '';
  let spotProductCover = '';
  let otherSpotProduct = '';
  let otherSpotCover = '';
  let fishLuofei = '';
  let fishJiyu = '';
  let priorityFish = '';
  let priorityBoth = '';
  let windowOpen = '';
  let limiting: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getAuthTestPrisma();

    originalShopRow = await prisma.config.findUnique({
      where: { config_key: SHOP_FLAG_KEY },
      select: { config_key: true, config_value: true },
    });
    await prisma.config.deleteMany({ where: { config_key: SHOP_FLAG_KEY } });
    await setShopFeature(true);

    // Product tables are test-only state; clear leftovers from interrupted runs.
    await prisma.productPlacement.deleteMany({});
    await prisma.productChannel.deleteMany({});
    await prisma.product.deleteMany({});

    rodA = await seedProduct({
      title: 'UniHuan 轻量路亚竿',
      subtitle: '深圳湾岸钓适用',
      category: PRODUCT_CATEGORY.ROD,
      sort_weight: 10,
      cover_image_key: `products/${ulid()}/${ulid()}.webp`,
    });
    rodB = await seedProduct({
      title: 'UniHuan 远投路亚竿',
      category: PRODUCT_CATEGORY.ROD,
      sort_weight: 30,
    });
    rodC = await seedProduct({
      title: 'UniHuan 溪流路亚竿',
      subtitle: null,
      category: PRODUCT_CATEGORY.ROD,
      sort_weight: 20,
    });
    reel = await seedProduct({
      title: 'UniHuan 纺车轮',
      category: PRODUCT_CATEGORY.REEL,
      sort_weight: 50,
    });

    // Draft, archived, soft-deleted and zero-active-channel products.
    const lineDraft = await seedProduct({
      title: '草稿商品',
      category: PRODUCT_CATEGORY.LINE,
      status: PRODUCT_STATUS.DRAFT,
      sort_weight: 90,
    });
    const lineArchived = await seedProduct({
      title: '归档商品',
      category: PRODUCT_CATEGORY.LINE,
      status: PRODUCT_STATUS.ARCHIVED,
      sort_weight: 91,
    });
    const lineDeleted = await seedProduct({
      title: '已删除商品',
      category: PRODUCT_CATEGORY.LINE,
      status: PRODUCT_STATUS.ACTIVE,
      sort_weight: 92,
      deleted_at: new Date(),
    });
    const lineNoChannel = await seedProduct({
      title: '无可用渠道商品',
      category: PRODUCT_CATEGORY.LINE,
      sort_weight: 93,
      channels: [{ status: 'disabled' }],
    });
    for (const product of [lineDraft, lineArchived, lineDeleted, lineNoChannel]) {
      await seedPlacement({ product_id: product, target_id: LINE_SPOT });
    }

    // Channel filtering and ordering.
    baitSingle = await seedProduct({
      title: '单一微店商品',
      category: PRODUCT_CATEGORY.BAIT,
      channels: [
        { channel: COMMERCE_CHANNEL.WEIDIAN },
        { channel: COMMERCE_CHANNEL.JD, status: 'disabled' },
      ],
    });
    baitOrdered = await seedProduct({
      title: '双渠道商品',
      category: PRODUCT_CATEGORY.BAIT,
      channels: [
        { channel: COMMERCE_CHANNEL.JD, price_display: '¥199' },
        { channel: COMMERCE_CHANNEL.WEIDIAN, price_display: '¥299 起' },
      ],
    });
    baitJd = await seedProduct({
      title: '京东商品',
      category: PRODUCT_CATEGORY.BAIT,
      channels: [{ channel: COMMERCE_CHANNEL.JD, price_display: '¥399' }],
    });

    // Brand page cap: 101 active products with an active channel.
    const hatIds = Array.from({ length: 101 }, () => ulid());
    await prisma.product.createMany({
      data: hatIds.map((productId, index) => ({
        product_id: productId,
        title: `UniHuan 防晒帽 ${index + 1}`,
        category: PRODUCT_CATEGORY.HAT,
        status: PRODUCT_STATUS.ACTIVE,
        sort_weight: 0,
      })),
    });
    await prisma.productChannel.createMany({
      data: hatIds.map((productId) => ({
        channel_id: ulid(),
        product_id: productId,
        channel: COMMERCE_CHANNEL.WEIDIAN,
        purchase_action: PURCHASE_ACTION_TYPE.COPY_LINK,
        action_payload: DEFAULT_ACTION,
        status: 'active',
      })),
    });
    trackedProductIds.push(...hatIds);

    // scope=spot matching.
    spotProductCover = `products/${ulid()}/${ulid()}.webp`;
    spotProduct = await seedProduct({
      title: '钓点定向商品',
      subtitle: '深圳湾岸钓适用',
      category: PRODUCT_CATEGORY.ACCESSORY,
      cover_image_key: spotProductCover,
      image_keys: [spotProductCover],
      channels: [
        {
          channel: COMMERCE_CHANNEL.WEIDIAN,
          price_display: '¥299 起',
        },
      ],
    });
    await seedPlacement({ product_id: spotProduct, target_id: SPOT_TARGET, sort_order: 0 });

    otherSpotCover = `products/${ulid()}/${ulid()}.webp`;
    const otherCoverFallback = `products/${ulid()}/${ulid()}.webp`;
    otherSpotProduct = await seedProduct({
      title: '其他钓点商品',
      category: PRODUCT_CATEGORY.ACCESSORY,
      image_keys: [otherSpotCover, otherCoverFallback],
    });
    await seedPlacement({ product_id: otherSpotProduct, target_id: OTHER_SPOT });

    // scope=fish matching.
    fishLuofei = await seedProduct({
      title: '罗非鱼种商品',
      category: PRODUCT_CATEGORY.OTHER,
    });
    await seedPlacement({
      product_id: fishLuofei,
      scope: PLACEMENT_SCOPE.FISH,
      target_id: null,
      fish_keys: ['luofei'],
    });
    fishJiyu = await seedProduct({
      title: '鲫鱼鱼种商品',
      category: PRODUCT_CATEGORY.OTHER,
    });
    await seedPlacement({
      product_id: fishJiyu,
      scope: PLACEMENT_SCOPE.FISH,
      target_id: null,
      fish_keys: ['jiyu'],
    });

    // Both placements on one product: spot priority and dedupe.
    priorityFish = await seedProduct({
      title: '鱼种优先商品',
      category: PRODUCT_CATEGORY.OTHER,
    });
    await seedPlacement({
      product_id: priorityFish,
      scope: PLACEMENT_SCOPE.FISH,
      target_id: null,
      fish_keys: ['luyu'],
      sort_order: 0,
    });
    priorityBoth = await seedProduct({
      title: '钓点优先商品',
      category: PRODUCT_CATEGORY.OTHER,
    });
    await seedPlacement({
      product_id: priorityBoth,
      target_id: PRIORITY_SPOT,
      sort_order: 5,
    });
    await seedPlacement({
      product_id: priorityBoth,
      scope: PLACEMENT_SCOPE.FISH,
      target_id: null,
      fish_keys: ['luyu'],
      sort_order: 0,
    });

    // Placement status and time window.
    const windowDisabled = await seedProduct({
      title: '停用展示位置商品',
      category: PRODUCT_CATEGORY.OTHER,
    });
    await seedPlacement({
      product_id: windowDisabled,
      target_id: WINDOW_SPOT,
      status: 'disabled',
      sort_order: 0,
    });
    const windowExpired = await seedProduct({
      title: '过期展示位置商品',
      category: PRODUCT_CATEGORY.OTHER,
    });
    await seedPlacement({
      product_id: windowExpired,
      target_id: WINDOW_SPOT,
      ends_at: new Date(Date.now() - DAY_MS),
      sort_order: 1,
    });
    const windowFuture = await seedProduct({
      title: '未开始展示位置商品',
      category: PRODUCT_CATEGORY.OTHER,
    });
    await seedPlacement({
      product_id: windowFuture,
      target_id: WINDOW_SPOT,
      starts_at: new Date(Date.now() + DAY_MS),
      sort_order: 2,
    });
    windowOpen = await seedProduct({
      title: '窗口内展示位置商品',
      category: PRODUCT_CATEGORY.OTHER,
    });
    await seedPlacement({
      product_id: windowOpen,
      target_id: WINDOW_SPOT,
      starts_at: new Date(Date.now() - DAY_MS),
      ends_at: new Date(Date.now() + DAY_MS),
      sort_order: 3,
    });

    // Limit defaults and dedupe ordering.
    limiting = [];
    for (let index = 0; index < 8; index += 1) {
      const product = await seedProduct({
        title: `限量商品 ${index + 1}`,
        category: PRODUCT_CATEGORY.OTHER,
      });
      limiting.push(product);
      await seedPlacement({
        product_id: product,
        target_id: LIMIT_SPOT,
        sort_order: index,
      });
    }
  });

  afterAll(async () => {
    await prisma.productPlacement.deleteMany({
      where: { product_id: { in: trackedProductIds } },
    });
    await prisma.productChannel.deleteMany({
      where: { product_id: { in: trackedProductIds } },
    });
    await prisma.product.deleteMany({ where: { product_id: { in: trackedProductIds } } });
    trackedProductIds.length = 0;

    await prisma.config.deleteMany({ where: { config_key: SHOP_FLAG_KEY } });
    if (originalShopRow !== null) {
      await prisma.config.create({ data: originalShopRow });
    }

    await cleanupAuthTestData();
    await app.close();
  });

  it('returns an empty list with HTTP 200 when features.shop is off', async () => {
    await setShopFeature(false);
    try {
      const brand = await listProducts('surface=brand_page').expect(200);
      expect(brand.body.code).toBe(ERROR_CODES.SUCCESS);
      expect(itemsOf(brand.body)).toEqual([]);

      const spot = await listProducts(`surface=spot_detail&target_id=${SPOT_TARGET}`).expect(
        200,
      );
      expect(itemsOf(spot.body)).toEqual([]);
    } finally {
      await setShopFeature(true);
    }
  });

  it('serves the brand page ordered by sort_weight and ignores limit', async () => {
    const response = await listProducts('surface=brand_page&category=rod&limit=1').expect(200);

    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(idsOf(response.body)).toEqual([rodB, rodC, rodA]);
    expect(itemsOf(response.body).every((item) => item.category === PRODUCT_CATEGORY.ROD)).toBe(
      true,
    );
  });

  it('filters the brand page by category', async () => {
    const response = await listProducts('surface=brand_page&category=reel').expect(200);
    expect(idsOf(response.body)).toEqual([reel]);
  });

  it('caps the brand page at 100 products', async () => {
    const response = await listProducts('surface=brand_page&category=hat').expect(200);
    const items = itemsOf(response.body);
    expect(items).toHaveLength(100);
    expect(items.every((item) => item.category === PRODUCT_CATEGORY.HAT)).toBe(true);
  });

  it('returns only the target spot product for scope=spot', async () => {
    const target = await listProducts(`surface=spot_detail&target_id=${SPOT_TARGET}`).expect(200);
    expect(idsOf(target.body)).toEqual([spotProduct]);

    const other = await listProducts(`surface=spot_detail&target_id=${OTHER_SPOT}`).expect(200);
    expect(idsOf(other.body)).toEqual([otherSpotProduct]);
  });

  it('matches a fish placement by requested fish key', async () => {
    const luofei = await listProducts(
      `surface=spot_detail&target_id=${FISH_SPOT}&fish_keys=luofei`,
    ).expect(200);
    expect(idsOf(luofei.body)).toEqual([fishLuofei]);

    const jiyu = await listProducts(
      `surface=spot_detail&target_id=${FISH_SPOT}&fish_keys=jiyu`,
    ).expect(200);
    expect(idsOf(jiyu.body)).toEqual([fishJiyu]);

    const none = await listProducts(
      `surface=spot_detail&target_id=${FISH_SPOT}&fish_keys=shad`,
    ).expect(200);
    expect(itemsOf(none.body)).toEqual([]);
  });

  it('shows a product placed on both the spot and the fish once, spot first', async () => {
    const response = await listProducts(
      `surface=spot_detail&target_id=${PRIORITY_SPOT}&fish_keys=luyu`,
    ).expect(200);

    expect(idsOf(response.body)).toEqual([priorityBoth, priorityFish]);
    expect(idsOf(response.body).filter((id) => id === priorityBoth)).toHaveLength(1);

    const limited = await listProducts(
      `surface=spot_detail&target_id=${PRIORITY_SPOT}&fish_keys=luyu&limit=1`,
    ).expect(200);
    expect(idsOf(limited.body)).toEqual([priorityBoth]);
  });

  it('hides draft, archived, deleted and channel-less products', async () => {
    const spot = await listProducts(`surface=spot_detail&target_id=${LINE_SPOT}`).expect(200);
    expect(itemsOf(spot.body)).toEqual([]);

    const brand = await listProducts('surface=brand_page&category=line').expect(200);
    expect(itemsOf(brand.body)).toEqual([]);
  });

  it('hides disabled and out of window placements', async () => {
    const response = await listProducts(
      `surface=spot_detail&target_id=${WINDOW_SPOT}`,
    ).expect(200);
    expect(idsOf(response.body)).toEqual([windowOpen]);
  });

  it('returns home and report_detail with an empty list', async () => {
    const home = await listProducts('surface=home').expect(200);
    expect(itemsOf(home.body)).toEqual([]);

    const report = await listProducts('surface=report_detail').expect(200);
    expect(itemsOf(report.body)).toEqual([]);
  });

  it('maps only public card fields with active channels, labels and image urls', async () => {
    const response = await listProducts(`surface=spot_detail&target_id=${SPOT_TARGET}`).expect(200);
    const item = itemsOf(response.body)[0]!;

    expect(Object.keys(item).sort()).toEqual([
      'category',
      'channels',
      'image_url',
      'product_id',
      'subtitle',
      'title',
    ]);
    expect(item).not.toHaveProperty('status');
    expect(item).not.toHaveProperty('created_at');
    expect(item).not.toHaveProperty('deleted_at');
    expect(item.product_id).toBe(spotProduct);
    expect(item.subtitle).toBe('深圳湾岸钓适用');
    expect(item.image_url).toBe(`/api/v1/uploads/public/${spotProductCover}`);
    expect(item.channels).toHaveLength(1);
    expect(Object.keys(item.channels[0]!).sort()).toEqual([
      'channel',
      'label',
      'price_display',
      'purchase_action',
    ]);
    expect(item.channels[0]).toMatchObject({
      channel: COMMERCE_CHANNEL.WEIDIAN,
      label: '微店',
      price_display: '¥299 起',
      purchase_action: {
        type: PURCHASE_ACTION_TYPE.COPY_LINK,
        url: 'https://weidian.com/item.html?itemID=1',
      },
    });

    const fallback = await listProducts(`surface=spot_detail&target_id=${OTHER_SPOT}`).expect(200);
    expect(itemsOf(fallback.body)[0]!.image_url).toBe(
      `/api/v1/uploads/public/${otherSpotCover}`,
    );
  });

  it('keeps active channels only and orders weidian before jd', async () => {
    const response = await listProducts('surface=brand_page&category=bait').expect(200);
    const byId = new Map(itemsOf(response.body).map((item) => [item.product_id, item]));

    expect(byId.get(baitSingle)?.channels.map((channel) => channel.channel)).toEqual([
      COMMERCE_CHANNEL.WEIDIAN,
    ]);
    expect(byId.get(baitOrdered)?.channels.map((channel) => channel.label)).toEqual([
      '微店',
      '京东',
    ]);
    expect(byId.get(baitJd)?.channels.map((channel) => channel.label)).toEqual(['京东']);
  });

  it('requires target_id for spot_detail', async () => {
    const response = await listProducts('surface=spot_detail').expect(400);
    expect(response.body.code).toBe(ERROR_CODES.VALIDATION);
  });

  it('defaults the spot detail limit to six and honors twelve', async () => {
    const defaulted = await listProducts(
      `surface=spot_detail&target_id=${LIMIT_SPOT}`,
    ).expect(200);
    expect(idsOf(defaulted.body)).toEqual(limiting.slice(0, 6));

    const extended = await listProducts(
      `surface=spot_detail&target_id=${LIMIT_SPOT}&limit=12`,
    ).expect(200);
    expect(idsOf(extended.body)).toEqual(limiting);
  });

  it('rejects invalid query parameters', async () => {
    await listProducts('surface=unknown').expect(400);
    await request(app.getHttpServer()).get('/api/v1/products').set(HEADERS).expect(400);
    await listProducts('surface=brand_page&category=unknown').expect(400);
    await listProducts('surface=brand_page&limit=0').expect(400);
    await listProducts('surface=brand_page&limit=13').expect(400);
    await listProducts('surface=spot_detail&target_id=short').expect(400);
    await listProducts(
      `surface=spot_detail&target_id=${SPOT_TARGET}&fish_keys=a,b,c,d,e,f`,
    ).expect(400);
  });
});
