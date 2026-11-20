import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { ERROR_CODES } from '@szfisher/shared';
import sharp from 'sharp';
import request from 'supertest';
import { ulid } from 'ulid';
import { WECHAT_AUTH_PROVIDER } from '../src/modules/app-auth/wechat-auth.provider';
import { CONTENT_SECURITY_PROVIDER } from '../src/modules/content-security/content-security.types';
import { RateLimitService } from '../src/modules/rate-limit/rate-limit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanupAdminSpotTestData, seedSpot } from './admin-spots.helpers';
import { createTestApp } from './create-test-app';
import {
  appAuthHeaders,
  appClientHeaders,
  cleanupAppAuthTestData,
  loginAppUser,
  resetAppLoginRateLimiter,
  type AppSession,
} from './support/app-auth-helpers';
import { FakeContentSecurityProvider } from './support/fake-content-security.provider';
import { FakeWechatAuthProvider } from './support/fake-wechat-auth.provider';

jest.setTimeout(60000);

const TERMS_VERSION = '2026-11-20';
const HEADERS = appClientHeaders();
const TEST_OPENIDS = [
  'openid-upload-owner',
  'openid-upload-other',
  'openid-upload-magic',
  'openid-upload-large',
  'openid-upload-cap',
  'openid-upload-flag',
  'openid-upload-six',
] as const;

function pngBuffer(width = 64, height = 48): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 20, g: 120, b: 180 },
    },
  })
    .png()
    .toBuffer();
}

function jpegBuffer(): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 24, channels: 3, background: { r: 180, g: 80, b: 20 } },
  })
    .jpeg()
    .toBuffer();
}

function webpBuffer(): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 24, channels: 3, background: { r: 20, g: 180, b: 80 } },
  })
    .webp()
    .toBuffer();
}

interface UploadBody {
  key: string;
  width: number;
  height: number;
  size_bytes: number;
}

describe('UGC image uploads (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let storageRoot: string;
  let openSpotId: string;

  async function setUgcFeature(enabled: boolean): Promise<void> {
    await prisma.config.upsert({
      where: { config_key: 'features.ugc' },
      create: {
        config_key: 'features.ugc',
        config_value: enabled ? 'true' : 'false',
        description: 'V1.1 钓友情报开关',
      },
      update: { config_value: enabled ? 'true' : 'false' },
    });
  }

  async function uploadImage(
    session: AppSession,
    buffer: Buffer,
    filename = 'photo.png',
    contentType = 'image/png',
  ): Promise<UploadBody> {
    const response = await request(server)
      .post('/api/v1/uploads/ugc')
      .set(appAuthHeaders(session.access_token))
      .attach('file', buffer, { filename, contentType })
      .expect(201);
    return response.body.data as UploadBody;
  }

  beforeAll(async () => {
    app = await createTestApp({
      wechatAuthProvider: {
        provide: WECHAT_AUTH_PROVIDER,
        useClass: FakeWechatAuthProvider,
      },
      contentSecurityProvider: {
        provide: CONTENT_SECURITY_PROVIDER,
        useClass: FakeContentSecurityProvider,
      },
    });
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    storageRoot = process.env.STORAGE_LOCAL_ROOT as string;
    await cleanupAppAuthTestData([...TEST_OPENIDS]);
    const spot = await seedSpot({
      spot_name: `上传测试钓点-${ulid().slice(-6)}`,
      status: 'published',
      open_status: 'open',
    });
    openSpotId = spot.spot_id;
    await setUgcFeature(true);
  });

  beforeEach(async () => {
    await resetAppLoginRateLimiter(app);
    await app.get(RateLimitService).reset('upload:');
    await app.get(RateLimitService).reset('report:');
  });

  afterEach(async () => {
    await setUgcFeature(true);
  });

  afterAll(async () => {
    await app.get(RateLimitService).reset('upload:');
    await app.get(RateLimitService).reset('report:');
    await resetAppLoginRateLimiter(app);
    await cleanupAppAuthTestData([...TEST_OPENIDS]);
    await cleanupAdminSpotTestData();
    await setUgcFeature(false);
    await app.close();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it('uploads a compressed image, then rejects a key owned by another user', async () => {
    const owner = await loginAppUser(server, 'openid-upload-owner');
    const uploaded = await uploadImage(owner, await pngBuffer());

    expect(uploaded.key).toMatch(/^ugc\/[A-Za-z0-9]{26}\/[A-Za-z0-9]{26}\.webp$/);
    expect(uploaded.key.startsWith(`ugc/${owner.user_id}/`)).toBe(true);
    expect(uploaded.width).toBeLessThanOrEqual(1600);
    expect(uploaded.height).toBeLessThanOrEqual(1600);
    expect(uploaded.size_bytes).toBeLessThanOrEqual(300 * 1024);

    const row = await prisma.ugcUpload.findUniqueOrThrow({
      where: { object_key: uploaded.key },
    });
    expect(row).toMatchObject({
      user_id: owner.user_id,
      status: 'pending',
      size_bytes: uploaded.size_bytes,
    });

    const other = await loginAppUser(server, 'openid-upload-other');
    const rejected = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(other.access_token))
      .send({
        spot_id: openSpotId,
        content_type: 'comment',
        content: '借用别人的图片',
        image_keys: [uploaded.key],
        terms_version: TERMS_VERSION,
      })
      .expect(400);
    expect(rejected.body.code).toBe(ERROR_CODES.VALIDATION);
    expect(
      (await prisma.ugcUpload.findUniqueOrThrow({ where: { object_key: uploaded.key } })).status,
    ).toBe('pending');

    const created = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(owner.access_token))
      .send({
        spot_id: openSpotId,
        content_type: 'comment',
        content: '自己的图片',
        image_keys: [uploaded.key],
        terms_version: TERMS_VERSION,
      })
      .expect(201);
    expect(created.body.data.moderation_status).toBe('machine_pending');
    expect(
      (await prisma.ugcUpload.findUniqueOrThrow({ where: { object_key: uploaded.key } })).status,
    ).toBe('used');
  });

  it('accepts JPEG, PNG and WebP magic bytes and rejects disguised non-images', async () => {
    const user = await loginAppUser(server, 'openid-upload-magic');

    const jpeg = await uploadImage(user, await jpegBuffer(), 'photo.jpg', 'image/jpeg');
    const png = await uploadImage(user, await pngBuffer(), 'photo.png', 'image/png');
    const webp = await uploadImage(user, await webpBuffer(), 'photo.webp', 'image/webp');
    for (const uploaded of [jpeg, png, webp]) {
      expect(uploaded.key).toMatch(/^ugc\/[A-Za-z0-9]{26}\/[A-Za-z0-9]{26}\.webp$/);
    }

    const fake = await request(server)
      .post('/api/v1/uploads/ugc')
      .set(appAuthHeaders(user.access_token))
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(fake.body.code).toBe(ERROR_CODES.VALIDATION);
  });

  it('rejects files over 10 MB before touching storage', async () => {
    const user = await loginAppUser(server, 'openid-upload-large');
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;

    const response = await request(server)
      .post('/api/v1/uploads/ugc')
      .set(appAuthHeaders(user.access_token))
      .attach('file', oversized, { filename: 'huge.jpg', contentType: 'image/jpeg' })
      .expect(413);
    expect(response.body.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(await prisma.ugcUpload.count({ where: { user_id: user.user_id } })).toBe(0);
  });

  it('caps a report at six images', async () => {
    const user = await loginAppUser(server, 'openid-upload-six');
    const images: UploadBody[] = [];
    for (let index = 0; index < 7; index += 1) {
      images.push(await uploadImage(user, await pngBuffer(16, 16)));
    }

    const tooMany = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: openSpotId,
        content_type: 'comment',
        content: '七张图片',
        image_keys: images.map((image) => image.key),
        terms_version: TERMS_VERSION,
      })
      .expect(400);
    expect(tooMany.body.code).toBe(ERROR_CODES.VALIDATION);

    const created = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: openSpotId,
        content_type: 'comment',
        content: '六张图片',
        image_keys: images.slice(0, 6).map((image) => image.key),
        terms_version: TERMS_VERSION,
      })
      .expect(201);
    expect(created.body.data.moderation_status).toBe('machine_pending');
    const report = await prisma.report.findUniqueOrThrow({
      where: { report_id: created.body.data.report_id as string },
    });
    expect(report.images).toHaveLength(6);
  });

  it('enforces the 30 uploads per day cap', async () => {
    const user = await loginAppUser(server, 'openid-upload-cap');
    const tiny = await pngBuffer(8, 8);
    for (let index = 0; index < 30; index += 1) {
      await uploadImage(user, tiny);
    }

    const blocked = await request(server)
      .post('/api/v1/uploads/ugc')
      .set(appAuthHeaders(user.access_token))
      .attach('file', tiny, { filename: 'extra.png', contentType: 'image/png' })
      .expect(429);
    expect(blocked.body.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(await prisma.ugcUpload.count({ where: { user_id: user.user_id } })).toBe(30);
  });

  it('returns FEATURE_DISABLED while the ugc flag is off', async () => {
    const user = await loginAppUser(server, 'openid-upload-flag');
    await setUgcFeature(false);
    try {
      const response = await request(server)
        .post('/api/v1/uploads/ugc')
        .set(appAuthHeaders(user.access_token))
        .attach('file', await pngBuffer(), { filename: 'closed.png', contentType: 'image/png' })
        .expect(403);
      expect(response.body.code).toBe(ERROR_CODES.FEATURE_DISABLED);
      expect(await prisma.ugcUpload.count({ where: { user_id: user.user_id } })).toBe(0);
    } finally {
      await setUgcFeature(true);
    }
  });

  it('requires the app bearer token and client headers', async () => {
    const anonymous = await request(server)
      .post('/api/v1/uploads/ugc')
      .set(HEADERS)
      .attach('file', await pngBuffer(), { filename: 'anon.png', contentType: 'image/png' })
      .expect(401);
    expect(anonymous.body.code).toBe(ERROR_CODES.UNAUTHENTICATED);

    const user = await loginAppUser(server, 'openid-upload-owner');
    const missingHeaders = await request(server)
      .post('/api/v1/uploads/ugc')
      .set('Authorization', `Bearer ${user.access_token}`)
      .attach('file', await pngBuffer(), { filename: 'headers.png', contentType: 'image/png' })
      .expect(400);
    expect(missingHeaders.body.code).toBe(ERROR_CODES.VALIDATION);
  });

  it('keeps UGC upload files inside the configured local storage root', async () => {
    const user = await loginAppUser(server, 'openid-upload-other');
    const uploaded = await uploadImage(user, await pngBuffer(16, 16));
    const path = join(storageRoot, 'working', ...uploaded.key.split('/'));
    expect(path.startsWith(join(storageRoot, 'working', 'ugc'))).toBe(true);
    expect(existsSync(path)).toBe(true);
  });
});
