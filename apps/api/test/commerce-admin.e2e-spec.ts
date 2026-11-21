import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import {
  ADMIN_ROLE,
  COMMERCE_CHANNEL,
  ERROR_CODES,
  PRODUCT_CATEGORY,
  PRODUCT_STATUS,
  PURCHASE_ACTION_TYPE,
} from '@szfisher/shared';
import request from 'supertest';
import { ulid } from 'ulid';
import { createTestApp } from './create-test-app';
import {
  cleanupAuthTestData,
  clientHeaders,
  getAuthTestPrisma,
  loginAs,
  type AuthSession,
} from './support/auth-helpers';

jest.setTimeout(60000);

const SHOP_FLAG_KEY = 'features.shop';
const DESCRIPTION_TEXT = '内部商品描述不得写入审计日志';
const UPDATED_DESCRIPTION_TEXT = '更新后的敏感描述也不得写入审计日志';

const MINI_PROGRAM_PAYLOAD = {
  app_id: 'wx0123456789abcdef',
  path: '/pages/product/detail?id=1',
  fallback_url: 'https://weidian.com/item.html?itemID=1',
};

const MINI_PROGRAM_HEADERS = {
  'X-Client-Type': 'miniprogram',
  'X-Client-Version': '1.0.0',
} as const;

interface Envelope<T> {
  code: number;
  message: string;
  data: T;
  request_id: string;
}

interface AdminChannel {
  channel_id: string;
  channel: string;
  external_product_id: string | null;
  purchase_action: string;
  action_payload: Record<string, unknown>;
  price_display: string | null;
  status: string;
}

interface AdminProductDetail {
  product_id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  category: string;
  sort_weight: number;
  status: string;
  image_keys: string[];
  image_urls: string[];
  cover_image_url: string | null;
  channels: AdminChannel[];
  created_at: string;
  updated_at: string;
}

interface AdminProductListItem {
  product_id: string;
  title: string;
  category: string;
  status: string;
  channel_count: number;
  placement_count: number;
  cover_image_url: string | null;
}

interface AdminProductPage {
  items: AdminProductListItem[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

interface PublicProductCard {
  product_id: string;
}

let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;
let prisma: PrismaClient;
let operator: AuthSession;
let superAdmin: AuthSession;
let reviewer: AuthSession;
let originalShopRow: { config_key: string; config_value: string } | null = null;
let titleSequence = 0;
const trackedProductIds: string[] = [];

function adminRead(session: AuthSession, path: string): request.Test {
  return request(server).get(path).set(clientHeaders()).set('Cookie', session.cookie);
}

function adminWrite(
  session: AuthSession,
  method: 'post' | 'put',
  path: string,
  body: unknown,
): request.Test {
  const test = request(server)[method](path);
  return test
    .set(clientHeaders())
    .set('Cookie', session.cookie)
    .set('X-CSRF-Token', session.csrf)
    .send(body as object);
}

function fakeImageKey(): string {
  return `products/${ulid()}/${ulid()}.webp`;
}

function draftPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  titleSequence += 1;
  return {
    title: `UniHuan 后台商品 ${titleSequence}`,
    subtitle: '深圳湾岸钓适用',
    description: DESCRIPTION_TEXT,
    category: PRODUCT_CATEGORY.ROD,
    sort_weight: 10,
    image_keys: [fakeImageKey()],
    channels: [
      {
        channel: COMMERCE_CHANNEL.WEIDIAN,
        purchase_action: PURCHASE_ACTION_TYPE.MINI_PROGRAM,
        action_payload: MINI_PROGRAM_PAYLOAD,
        price_display: '¥299 起',
      },
    ],
    ...overrides,
  };
}

async function createProduct(
  overrides: Record<string, unknown> = {},
  session: AuthSession = operator,
): Promise<AdminProductDetail> {
  const response = await adminWrite(
    session,
    'post',
    '/api/v1/admin/products',
    draftPayload(overrides),
  ).expect(201);
  const product = (response.body as Envelope<AdminProductDetail>).data;
  trackedProductIds.push(product.product_id);
  return product;
}

async function archiveProduct(
  productId: string,
  session: AuthSession = operator,
): Promise<AdminProductDetail> {
  const response = await adminWrite(
    session,
    'post',
    `/api/v1/admin/products/${productId}/archive`,
    {},
  ).expect(200);
  return (response.body as Envelope<AdminProductDetail>).data;
}

async function publicProductIds(category: string): Promise<string[]> {
  const response = await request(server)
    .get(`/api/v1/products?surface=brand_page&category=${category}`)
    .set(MINI_PROGRAM_HEADERS)
    .expect(200);
  return (response.body as Envelope<{ items: PublicProductCard[] }>).data.items.map(
    (item) => item.product_id,
  );
}

describe('admin products (e2e)', () => {
  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    prisma = getAuthTestPrisma();

    operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    superAdmin = await loginAs(app, ADMIN_ROLE.SUPER_ADMIN);
    reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);

    originalShopRow = await prisma.config.findUnique({
      where: { config_key: SHOP_FLAG_KEY },
      select: { config_key: true, config_value: true },
    });
    await prisma.config.upsert({
      where: { config_key: SHOP_FLAG_KEY },
      create: { config_key: SHOP_FLAG_KEY, config_value: 'true' },
      update: { config_value: 'true' },
    });
  });

  afterAll(async () => {
    // Only rows created by this suite are removed.
    if (trackedProductIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { entity_type: 'product', entity_id: { in: trackedProductIds } },
      });
      await prisma.product.deleteMany({ where: { product_id: { in: trackedProductIds } } });
    }
    trackedProductIds.length = 0;

    await prisma.config.deleteMany({ where: { config_key: SHOP_FLAG_KEY } });
    if (originalShopRow !== null) {
      await prisma.config.create({ data: originalShopRow });
    }

    await cleanupAuthTestData();
    await app.close();
  });

  it('forbids reviewers and allows operators and super admins', async () => {
    const draft = await createProduct();

    const reviewerList = await adminRead(reviewer, '/api/v1/admin/products').expect(403);
    expect((reviewerList.body as Envelope<null>).code).toBe(ERROR_CODES.FORBIDDEN);

    const reviewerCreate = await adminWrite(
      reviewer,
      'post',
      '/api/v1/admin/products',
      draftPayload(),
    ).expect(403);
    expect((reviewerCreate.body as Envelope<null>).code).toBe(ERROR_CODES.FORBIDDEN);

    const reviewerUpdate = await adminWrite(
      reviewer,
      'put',
      `/api/v1/admin/products/${draft.product_id}`,
      { title: '禁止更新的标题' },
    ).expect(403);
    expect((reviewerUpdate.body as Envelope<null>).code).toBe(ERROR_CODES.FORBIDDEN);

    const operatorList = await adminRead(operator, '/api/v1/admin/products').expect(200);
    expect((operatorList.body as Envelope<AdminProductPage>).code).toBe(
      ERROR_CODES.SUCCESS,
    );

    const superList = await adminRead(superAdmin, '/api/v1/admin/products').expect(200);
    expect((superList.body as Envelope<AdminProductPage>).code).toBe(ERROR_CODES.SUCCESS);

    const superUpdate = await adminWrite(
      superAdmin,
      'put',
      `/api/v1/admin/products/${draft.product_id}`,
      { title: '超管更新的标题' },
    ).expect(200);
    expect((superUpdate.body as Envelope<AdminProductDetail>).data.title).toBe(
      '超管更新的标题',
    );
  });

  it('creates a draft product with one weidian mini program channel', async () => {
    const product = await createProduct();

    expect(product.status).toBe(PRODUCT_STATUS.DRAFT);
    expect(product.category).toBe(PRODUCT_CATEGORY.ROD);
    expect(product.channels).toHaveLength(1);
    expect(product.channels[0]).toMatchObject({
      channel: COMMERCE_CHANNEL.WEIDIAN,
      purchase_action: PURCHASE_ACTION_TYPE.MINI_PROGRAM,
      price_display: '¥299 起',
      status: 'active',
    });
    expect(product.channels[0]?.action_payload).toMatchObject({
      app_id: MINI_PROGRAM_PAYLOAD.app_id,
      path: MINI_PROGRAM_PAYLOAD.path,
    });

    const detail = await adminRead(
      operator,
      `/api/v1/admin/products/${product.product_id}`,
    ).expect(200);
    const body = (detail.body as Envelope<AdminProductDetail>).data;
    expect(body).toMatchObject({
      product_id: product.product_id,
      title: product.title,
      status: PRODUCT_STATUS.DRAFT,
      description: DESCRIPTION_TEXT,
    });
    expect(body.channels).toHaveLength(1);
  });

  it('replaces the channel set on update', async () => {
    const product = await createProduct();

    const response = await adminWrite(
      operator,
      'put',
      `/api/v1/admin/products/${product.product_id}`,
      {
        channels: [
          {
            channel: COMMERCE_CHANNEL.WEIDIAN,
            purchase_action: PURCHASE_ACTION_TYPE.COPY_LINK,
            action_payload: { url: 'https://weidian.com/item.html?itemID=2' },
            price_display: '¥199',
            status: 'disabled',
          },
        ],
      },
    ).expect(200);

    const updated = (response.body as Envelope<AdminProductDetail>).data;
    expect(updated.channels).toHaveLength(1);
    expect(updated.channels[0]).toMatchObject({
      channel: COMMERCE_CHANNEL.WEIDIAN,
      purchase_action: PURCHASE_ACTION_TYPE.COPY_LINK,
      price_display: '¥199',
      status: 'disabled',
    });
    expect(updated.channels[0]?.action_payload).toMatchObject({
      url: 'https://weidian.com/item.html?itemID=2',
    });
  });

  it('activates a draft and exposes it on the public endpoint', async () => {
    const product = await createProduct({ category: PRODUCT_CATEGORY.HAT });

    const response = await adminWrite(
      operator,
      'put',
      `/api/v1/admin/products/${product.product_id}`,
      { status: PRODUCT_STATUS.ACTIVE },
    ).expect(200);
    expect((response.body as Envelope<AdminProductDetail>).data.status).toBe(
      PRODUCT_STATUS.ACTIVE,
    );

    const ids = await publicProductIds(PRODUCT_CATEGORY.HAT);
    expect(ids).toContain(product.product_id);
  });

  it('rejects activation without images', async () => {
    const product = await createProduct({ image_keys: [] });

    const response = await adminWrite(
      operator,
      'put',
      `/api/v1/admin/products/${product.product_id}`,
      { status: PRODUCT_STATUS.ACTIVE },
    ).expect(400);
    expect((response.body as Envelope<null>).code).toBe(ERROR_CODES.VALIDATION);

    const detail = await adminRead(
      operator,
      `/api/v1/admin/products/${product.product_id}`,
    ).expect(200);
    expect((detail.body as Envelope<AdminProductDetail>).data.status).toBe(
      PRODUCT_STATUS.DRAFT,
    );
  });

  it('rejects activation with no active channel', async () => {
    const disabledChannel = {
      channel: COMMERCE_CHANNEL.WEIDIAN,
      purchase_action: PURCHASE_ACTION_TYPE.COPY_LINK,
      action_payload: { url: 'https://weidian.com/item.html?itemID=1' },
      status: 'disabled',
    };

    const createdDisabled = await createProduct({ channels: [disabledChannel] });
    const fromDraft = await adminWrite(
      operator,
      'put',
      `/api/v1/admin/products/${createdDisabled.product_id}`,
      { status: PRODUCT_STATUS.ACTIVE },
    ).expect(400);
    expect((fromDraft.body as Envelope<null>).code).toBe(ERROR_CODES.VALIDATION);

    const disabledOnUpdate = await createProduct();
    const update = await adminWrite(
      operator,
      'put',
      `/api/v1/admin/products/${disabledOnUpdate.product_id}`,
      { status: PRODUCT_STATUS.ACTIVE, channels: [disabledChannel] },
    ).expect(400);
    expect((update.body as Envelope<null>).code).toBe(ERROR_CODES.VALIDATION);

    // The rejected update must not persist the disabled channel or the status.
    const detail = await adminRead(
      operator,
      `/api/v1/admin/products/${disabledOnUpdate.product_id}`,
    ).expect(200);
    const saved = (detail.body as Envelope<AdminProductDetail>).data;
    expect(saved.status).toBe(PRODUCT_STATUS.DRAFT);
    expect(saved.channels[0]?.status).toBe('active');
  });

  it('archives a product and hides it from the public endpoint', async () => {
    const product = await createProduct({ category: PRODUCT_CATEGORY.BAIT });
    await adminWrite(operator, 'put', `/api/v1/admin/products/${product.product_id}`, {
      status: PRODUCT_STATUS.ACTIVE,
    }).expect(200);
    await expect(publicProductIds(PRODUCT_CATEGORY.BAIT)).resolves.toContain(
      product.product_id,
    );

    const archived = await archiveProduct(product.product_id);
    expect(archived.status).toBe(PRODUCT_STATUS.ARCHIVED);

    const ids = await publicProductIds(PRODUCT_CATEGORY.BAIT);
    expect(ids).not.toContain(product.product_id);
  });

  it('returns signed preview urls for drafts and public urls once active', async () => {
    const coverKey = `products/${ulid()}/${ulid()}.webp`;
    const secondKey = `products/${ulid()}/${ulid()}.webp`;
    const product = await createProduct({
      image_keys: [coverKey, secondKey],
      cover_image_key: coverKey,
    });

    expect(product.image_keys).toEqual([coverKey, secondKey]);
    expect(product.image_urls).toHaveLength(2);
    expect(
      product.image_urls.every((url) => url.startsWith('/api/v1/uploads/preview?')),
    ).toBe(true);
    expect(decodeURIComponent(product.cover_image_url ?? '')).toContain(coverKey);

    const response = await adminWrite(
      operator,
      'put',
      `/api/v1/admin/products/${product.product_id}`,
      { status: PRODUCT_STATUS.ACTIVE },
    ).expect(200);
    const active = (response.body as Envelope<AdminProductDetail>).data;
    expect(active.image_urls).toEqual([
      `/api/v1/uploads/public/${coverKey}`,
      `/api/v1/uploads/public/${secondKey}`,
    ]);
    expect(active.cover_image_url).toBe(`/api/v1/uploads/public/${coverKey}`);
  });

  it('lists products with pagination, status, category and keyword filters', async () => {
    const keyword = `列表关键词${ulid().slice(-6)}`;
    const product = await createProduct({
      title: `UniHuan ${keyword}`,
      category: PRODUCT_CATEGORY.SUN_PROTECTION,
    });
    await adminWrite(operator, 'put', `/api/v1/admin/products/${product.product_id}`, {
      status: PRODUCT_STATUS.ACTIVE,
    }).expect(200);

    const page = await adminRead(
      operator,
      '/api/v1/admin/products?page=1&page_size=5',
    ).expect(200);
    const pageBody = (page.body as Envelope<AdminProductPage>).data;
    expect(pageBody.page).toBe(1);
    expect(pageBody.page_size).toBe(5);
    expect(pageBody.items.length).toBeLessThanOrEqual(5);
    expect(pageBody.has_more).toBe(pageBody.total > pageBody.page_size);

    const filtered = await adminRead(
      operator,
      `/api/v1/admin/products?status=active&category=${PRODUCT_CATEGORY.SUN_PROTECTION}&page_size=50`,
    ).expect(200);
    const filteredBody = (filtered.body as Envelope<AdminProductPage>).data;
    expect(filteredBody.items.length).toBeGreaterThan(0);
    expect(
      filteredBody.items.every(
        (item) =>
          item.status === PRODUCT_STATUS.ACTIVE &&
          item.category === PRODUCT_CATEGORY.SUN_PROTECTION,
      ),
    ).toBe(true);
    expect(filteredBody.items.map((item) => item.product_id)).toContain(
      product.product_id,
    );
    const listed = filteredBody.items.find((item) => item.product_id === product.product_id);
    expect(listed?.channel_count).toBe(1);
    expect(listed?.placement_count).toBe(0);

    const keywordSearch = await adminRead(
      operator,
      `/api/v1/admin/products?keyword=${encodeURIComponent(keyword)}&page_size=50`,
    ).expect(200);
    const keywordBody = (keywordSearch.body as Envelope<AdminProductPage>).data;
    expect(keywordBody.items.map((item) => item.product_id)).toEqual([product.product_id]);
  });

  it('rejects invalid channels, actions, payloads and empty channel sets', async () => {
    const invalidChannel = await adminWrite(
      operator,
      'post',
      '/api/v1/admin/products',
      draftPayload({
        channels: [
          {
            channel: 'taobao',
            purchase_action: PURCHASE_ACTION_TYPE.COPY_LINK,
            action_payload: { url: 'https://example.com/item' },
          },
        ],
      }),
    ).expect(400);
    expect((invalidChannel.body as Envelope<null>).code).toBe(ERROR_CODES.VALIDATION);

    const jdChannel = await adminWrite(
      operator,
      'post',
      '/api/v1/admin/products',
      draftPayload({
        channels: [
          {
            channel: COMMERCE_CHANNEL.JD,
            purchase_action: PURCHASE_ACTION_TYPE.COPY_LINK,
            action_payload: { url: 'https://example.com/item' },
          },
        ],
      }),
    ).expect(400);
    expect((jdChannel.body as Envelope<null>).code).toBe(ERROR_CODES.VALIDATION);

    const twoChannels = await adminWrite(
      operator,
      'post',
      '/api/v1/admin/products',
      draftPayload({
        channels: [
          {
            channel: COMMERCE_CHANNEL.WEIDIAN,
            purchase_action: PURCHASE_ACTION_TYPE.COPY_LINK,
            action_payload: { url: 'https://example.com/item' },
          },
          {
            channel: COMMERCE_CHANNEL.WEIDIAN,
            purchase_action: PURCHASE_ACTION_TYPE.COPY_LINK,
            action_payload: { url: 'https://example.com/other' },
          },
        ],
      }),
    ).expect(400);
    expect((twoChannels.body as Envelope<null>).code).toBe(ERROR_CODES.VALIDATION);

    const invalidAction = await adminWrite(
      operator,
      'post',
      '/api/v1/admin/products',
      draftPayload({
        channels: [
          {
            channel: COMMERCE_CHANNEL.WEIDIAN,
            purchase_action: 'bogus',
            action_payload: { url: 'https://example.com/item' },
          },
        ],
      }),
    ).expect(400);
    expect((invalidAction.body as Envelope<null>).code).toBe(ERROR_CODES.VALIDATION);

    const invalidPayload = await adminWrite(
      operator,
      'post',
      '/api/v1/admin/products',
      draftPayload({
        channels: [
          {
            channel: COMMERCE_CHANNEL.WEIDIAN,
            purchase_action: PURCHASE_ACTION_TYPE.MINI_PROGRAM,
            action_payload: { app_id: 'not-an-app-id', path: '/pages/index' },
          },
        ],
      }),
    ).expect(400);
    expect((invalidPayload.body as Envelope<null>).code).toBe(ERROR_CODES.VALIDATION);

    const emptyChannels = await adminWrite(
      operator,
      'post',
      '/api/v1/admin/products',
      draftPayload({ channels: [] }),
    ).expect(400);
    expect((emptyChannels.body as Envelope<null>).code).toBe(ERROR_CODES.VALIDATION);

    const createStatus = await adminWrite(
      operator,
      'post',
      '/api/v1/admin/products',
      draftPayload({ status: PRODUCT_STATUS.ACTIVE }),
    ).expect(400);
    expect((createStatus.body as Envelope<null>).code).toBe(ERROR_CODES.VALIDATION);

    const badCover = await adminWrite(
      operator,
      'post',
      '/api/v1/admin/products',
      draftPayload({
        image_keys: [`products/${ulid()}/${ulid()}.webp`],
        cover_image_key: `products/${ulid()}/${ulid()}.webp`,
      }),
    ).expect(400);
    expect((badCover.body as Envelope<null>).code).toBe(ERROR_CODES.VALIDATION);

    const tooManyImages = await adminWrite(
      operator,
      'post',
      '/api/v1/admin/products',
      draftPayload({
        image_keys: Array.from({ length: 10 }, () => `products/${ulid()}/${ulid()}.webp`),
      }),
    ).expect(400);
    expect((tooManyImages.body as Envelope<null>).code).toBe(ERROR_CODES.VALIDATION);
  });

  it('rejects invalid update payloads and missing products', async () => {
    const product = await createProduct();

    const badCover = await adminWrite(
      operator,
      'put',
      `/api/v1/admin/products/${product.product_id}`,
      {
        image_keys: [`products/${ulid()}/${ulid()}.webp`],
        cover_image_key: `products/${ulid()}/${ulid()}.webp`,
      },
    ).expect(400);
    expect((badCover.body as Envelope<null>).code).toBe(ERROR_CODES.VALIDATION);

    const badJdChannel = await adminWrite(
      operator,
      'put',
      `/api/v1/admin/products/${product.product_id}`,
      {
        channels: [
          {
            channel: COMMERCE_CHANNEL.JD,
            purchase_action: PURCHASE_ACTION_TYPE.COPY_LINK,
            action_payload: { url: 'https://example.com/item' },
          },
        ],
      },
    ).expect(400);
    expect((badJdChannel.body as Envelope<null>).code).toBe(ERROR_CODES.VALIDATION);

    const missingUpdate = await adminWrite(
      operator,
      'put',
      `/api/v1/admin/products/${ulid()}`,
      { title: '不存在的商品' },
    ).expect(404);
    expect((missingUpdate.body as Envelope<null>).code).toBe(ERROR_CODES.NOT_FOUND);

    const missingArchive = await adminWrite(
      operator,
      'post',
      `/api/v1/admin/products/${ulid()}/archive`,
      {},
    ).expect(404);
    expect((missingArchive.body as Envelope<null>).code).toBe(ERROR_CODES.NOT_FOUND);

    const missingDetail = await adminRead(
      operator,
      `/api/v1/admin/products/${ulid()}`,
    ).expect(404);
    expect((missingDetail.body as Envelope<null>).code).toBe(ERROR_CODES.NOT_FOUND);

    await adminRead(operator, '/api/v1/admin/products?page_size=51').expect(400);
    await adminRead(operator, '/api/v1/admin/products?page=0').expect(400);
    await adminRead(operator, '/api/v1/admin/products?status=unknown').expect(400);
  });

  it('writes compact audit rows without description text', async () => {
    const product = await createProduct();
    const updatedTitle = `${product.title} 更新`;

    await adminWrite(operator, 'put', `/api/v1/admin/products/${product.product_id}`, {
      title: updatedTitle,
      description: UPDATED_DESCRIPTION_TEXT,
    }).expect(200);
    await archiveProduct(product.product_id);

    const rows = await prisma.auditLog.findMany({
      where: {
        entity_type: 'product',
        entity_id: product.product_id,
        action: { in: ['product.create', 'product.update', 'product.archive'] },
      },
      orderBy: { created_at: 'asc' },
    });

    expect(rows.map((row) => row.action).sort()).toEqual([
      'product.archive',
      'product.create',
      'product.update',
    ]);

    for (const row of rows) {
      expect(row.admin_id).toBe(operator.admin.adminId);
      const serialized = JSON.stringify({
        before: row.before_json,
        after: row.after_json,
      });
      expect(serialized).not.toContain(DESCRIPTION_TEXT);
      expect(serialized).not.toContain(UPDATED_DESCRIPTION_TEXT);

      expect(Object.keys(row.after_json as Record<string, unknown>).sort()).toEqual([
        'category',
        'channels',
        'status',
        'title',
      ]);
      expect((row.after_json as Record<string, unknown>).channels).toEqual([
        COMMERCE_CHANNEL.WEIDIAN,
      ]);
      expect((row.after_json as Record<string, unknown>).title).toBe(
        row.action === 'product.create' ? product.title : updatedTitle,
      );
    }

    expect((rows.find((row) => row.action === 'product.create')?.after_json as {
      status: string;
    }).status).toBe(PRODUCT_STATUS.DRAFT);
    expect((rows.find((row) => row.action === 'product.update')?.after_json as {
      title: string;
    }).title).toBe(updatedTitle);
    expect((rows.find((row) => row.action === 'product.archive')?.after_json as {
      status: string;
    }).status).toBe(PRODUCT_STATUS.ARCHIVED);
  });
});
