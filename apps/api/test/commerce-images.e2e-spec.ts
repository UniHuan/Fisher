import type { INestApplication } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  ADMIN_ROLE,
  ERROR_CODES,
  PRODUCT_CATEGORY,
  PRODUCT_STATUS,
} from '@szfisher/shared';
import sharp from 'sharp';
import request from 'supertest';
import { ulid } from 'ulid';
import { ProductImageService } from '../src/modules/commerce/product-image.service';
import { createTestApp } from './create-test-app';
import {
  cleanupAuthTestData,
  clientHeaders,
  getAuthTestPrisma,
  loginAs,
  type AuthSession,
} from './support/auth-helpers';

jest.setTimeout(60000);

const KEY_PATTERN = /^products\/[A-Za-z0-9]{26}\/[A-Za-z0-9]{26}\.webp$/;
const MAX_PRODUCT_IMAGE_BYTES = 250 * 1024;

function pngBuffer(width = 900, height = 600): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 110, b: 80 },
    },
  })
    .png()
    .toBuffer();
}

describe('product images (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaClient;
  let operator: AuthSession;
  let draftProductId = '';
  const trackedProductIds: string[] = [];

  async function seedProduct(
    input: Partial<Prisma.ProductUncheckedCreateInput> = {},
  ): Promise<string> {
    const productId = input.product_id ?? ulid();
    await prisma.product.create({
      data: {
        product_id: productId,
        title: 'UniHuan 商品图测试',
        category: PRODUCT_CATEGORY.ROD,
        status: PRODUCT_STATUS.DRAFT,
        image_keys: [],
        ...input,
      },
    });
    trackedProductIds.push(productId);
    return productId;
  }

  function upload(
    productId: string,
    session: AuthSession,
    file: Buffer,
    filename = 'product.png',
    contentType = 'image/png',
  ): request.Test {
    return request(server)
      .post(`/api/v1/admin/products/${productId}/images`)
      .set(clientHeaders())
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .attach('file', file, { filename, contentType });
  }

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    prisma = getAuthTestPrisma();
    operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    draftProductId = await seedProduct();
  });

  afterAll(async () => {
    await prisma.product.deleteMany({
      where: { product_id: { in: trackedProductIds } },
    });
    trackedProductIds.length = 0;
    await cleanupAuthTestData();
    await app.close();
  });

  it('uploads a PNG to a draft product and serves only a signed preview', async () => {
    const response = await upload(draftProductId, operator, await pngBuffer()).expect(201);
    const image = response.body.data;

    expect(image.key).toMatch(KEY_PATTERN);
    expect(image.key.startsWith(`products/${draftProductId}/`)).toBe(true);
    expect(image.width).toBe(900);
    expect(image.height).toBe(600);
    expect(image.size_bytes).toBeGreaterThan(0);
    expect(image.size_bytes).toBeLessThanOrEqual(MAX_PRODUCT_IMAGE_BYTES);
    expect(image.preview_url).toContain('/api/v1/uploads/preview?');
    expect(image.expires_at).toEqual(expect.any(String));

    const preview = await request(server).get(image.preview_url).expect(200);
    expect(preview.headers['content-type']).toContain('image/webp');
    expect(preview.headers['cross-origin-resource-policy']).toBe('cross-origin');

    const hidden = await request(server)
      .get(`/api/v1/uploads/public/${image.key}`)
      .expect(404);
    expect(hidden.body.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('publishes image keys and serves them only for active products', async () => {
    const productId = await seedProduct();
    const uploadResponse = await upload(productId, operator, await pngBuffer(640, 480)).expect(
      201,
    );
    const key = uploadResponse.body.data.key as string;

    // Task 5 owns image_keys; this test stores the uploaded key the way an admin save would.
    await prisma.product.update({
      where: { product_id: productId },
      data: {
        image_keys: [key, `products/${productId}/${ulid()}.webp`],
        cover_image_key: key,
        status: PRODUCT_STATUS.ACTIVE,
      },
    });

    await expect(app.get(ProductImageService).publishForProduct(productId)).resolves.toBeUndefined();

    const image = await request(server).get(`/api/v1/uploads/public/${key}`).expect(200);
    expect(image.headers['content-type']).toContain('image/webp');
    expect(image.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(image.body.length).toBeGreaterThan(0);

    const unknown = await request(server)
      .get(`/api/v1/uploads/public/products/${productId}/${ulid()}.webp`)
      .expect(404);
    expect(unknown.body.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('keeps a draft product image out of the public route after activation checks', async () => {
    const productId = await seedProduct();
    const uploadResponse = await upload(productId, operator, await pngBuffer(320, 240)).expect(
      201,
    );
    const key = uploadResponse.body.data.key as string;
    await prisma.product.update({
      where: { product_id: productId },
      data: { image_keys: [key] },
    });

    await app.get(ProductImageService).publishForProduct(productId);

    const draftImage = await request(server).get(`/api/v1/uploads/public/${key}`).expect(404);
    expect(draftImage.body.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('rejects non-image bytes and files over 10 MB', async () => {
    const fake = await upload(
      draftProductId,
      operator,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      'fake.png',
    ).expect(400);
    expect(fake.body.code).toBe(ERROR_CODES.VALIDATION);

    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;
    const tooLarge = await upload(draftProductId, operator, oversized, 'huge.jpg', 'image/jpeg').expect(
      413,
    );
    expect(tooLarge.body.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
  });

  it('returns 404 for a missing product and 409 for an archived product', async () => {
    const missing = await upload(ulid(), operator, await pngBuffer(100, 100)).expect(404);
    expect(missing.body.code).toBe(ERROR_CODES.NOT_FOUND);

    const archived = await seedProduct({ status: PRODUCT_STATUS.ARCHIVED });
    const rejected = await upload(archived, operator, await pngBuffer(100, 100)).expect(409);
    expect(rejected.body.code).toBe(ERROR_CODES.STATE_CONFLICT);
  });

  it('forbids reviewer uploads', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const response = await upload(draftProductId, reviewer, await pngBuffer(100, 100)).expect(403);
    expect(response.body.code).toBe(ERROR_CODES.FORBIDDEN);
  });

  it('writes a product.image_upload audit row with dimensions only', async () => {
    const productId = await seedProduct();
    const response = await upload(productId, operator, await pngBuffer(320, 200)).expect(201);
    const image = response.body.data;

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'product.image_upload', entity_id: productId },
      orderBy: { created_at: 'desc' },
    });

    expect(audit).not.toBeNull();
    expect(audit?.entity_type).toBe('product');
    expect(audit?.admin_id).toBe(operator.admin.adminId);
    expect(audit?.before_json).toBeNull();
    expect(audit?.after_json).toEqual({
      key: image.key,
      width: image.width,
      height: image.height,
      size_bytes: image.size_bytes,
    });
    expect(Object.keys(audit?.after_json as Record<string, unknown>).sort()).toEqual([
      'height',
      'key',
      'size_bytes',
      'width',
    ]);
  });
});
