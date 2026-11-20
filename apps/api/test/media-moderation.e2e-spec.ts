import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { ERROR_CODES, MODERATION_STATUS } from '@szfisher/shared';
import sharp from 'sharp';
import request from 'supertest';
import { ulid } from 'ulid';
import { expirePendingMediaChecks } from '../src/jobs/media-check-timeout.job';
import { purgeUgcOrphans } from '../src/jobs/purge-ugc-orphans.job';
import { WECHAT_AUTH_PROVIDER } from '../src/modules/app-auth/wechat-auth.provider';
import { CONTENT_SECURITY_PROVIDER } from '../src/modules/content-security/content-security.types';
import { RateLimitService } from '../src/modules/rate-limit/rate-limit.service';
import { StorageService } from '../src/modules/storage/storage.service';
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

jest.setTimeout(120000);

const TERMS_VERSION = '2026-11-20';
const HEADERS = appClientHeaders();
const TOKEN = process.env.WECHAT_MSG_TOKEN as string;
const AES_KEY = process.env.WECHAT_MSG_AES_KEY as string;
const APPID = process.env.WECHAT_MINI_APPID as string;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const PUBLIC_PREFIX = '/api/v1/uploads/public/ugc';

const TEST_OPENIDS = [
  'openid-media',
  'openid-media-risky',
  'openid-media-review',
  'openid-media-timeout',
  'openid-media-duplicate',
  'openid-media-human',
  'openid-media-removed',
  'openid-media-tamper',
  'openid-media-purge',
  'openid-media-purge2',
] as const;

/** Fails the test fixture loudly instead of hiding a missing row behind `undefined`. */
function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('media-moderation test expected a fixture value');
  }
  return value;
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

function wechatSignature(timestamp: string, nonce: string): string {
  return sha1([TOKEN, timestamp, nonce].sort().join(''));
}

function wechatMsgSignature(timestamp: string, nonce: string, encrypt: string): string {
  return sha1([TOKEN, timestamp, nonce, encrypt].sort().join(''));
}

/** Mirrors WeChat's 32-byte PKCS#7 padding for the safe-mode envelope. */
function encryptEvent(payload: unknown, appid: string): string {
  const key = Buffer.from(`${AES_KEY}=`, 'base64');
  const message = Buffer.from(JSON.stringify(payload), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(message.length, 0);
  const body = Buffer.concat([randomBytes(16), length, message, Buffer.from(appid, 'utf8')]);
  const padLength = 32 - (body.length % 32);
  const padded = Buffer.concat([body, Buffer.alloc(padLength, padLength)]);
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}

function mediaEvent(traceId: string, suggest: string, appid = APPID): Record<string, unknown> {
  return {
    ToUserName: 'gh_e2e_test',
    FromUserName: 'openid-do-not-log',
    CreateTime: Math.floor(Date.now() / 1000),
    MsgType: 'event',
    Event: 'wxa_media_check',
    appid,
    trace_id: traceId,
    version: 2,
    result: { suggest, label: 100 },
  };
}

interface CallbackOverrides {
  appid?: string;
  encrypt?: string;
  timestamp?: string;
  signature?: string;
  msgSignature?: string;
}

function sendMediaCallback(
  server: ReturnType<INestApplication['getHttpServer']>,
  traceId: string,
  suggest: string,
  overrides: CallbackOverrides = {},
): request.Test {
  const nonce = 'e2etestnonce';
  const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000));
  const appid = overrides.appid ?? APPID;
  const encrypt = overrides.encrypt ?? encryptEvent(mediaEvent(traceId, suggest, appid), appid);
  return request(server)
    .post('/api/v1/wechat/media-check/callback')
    .query({
      signature: overrides.signature ?? wechatSignature(timestamp, nonce),
      timestamp,
      nonce,
      msg_signature: overrides.msgSignature ?? wechatMsgSignature(timestamp, nonce, encrypt),
      encrypt_type: 'aes',
    })
    .send({ Encrypt: encrypt });
}

function pngBuffer(width = 48, height = 32): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 30, g: 110, b: 170 },
    },
  })
    .png()
    .toBuffer();
}

function publicImageUrl(reportId: string, key: string): string {
  return `${PUBLIC_PREFIX}/${reportId}/${key.split('/').pop() ?? ''}`;
}

interface UploadBody {
  key: string;
  width: number;
  height: number;
  size_bytes: number;
}

interface CreatedReport {
  report_id: string;
  moderation_status: string;
  message: string;
}

interface MediaCheckRow {
  trace_id: string;
  report_id: string;
  image_key: string;
  status: string;
}

describe('UGC image moderation (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let storage: StorageService;
  let storageRoot: string;

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

  async function seedOpenSpot(): Promise<string> {
    const spot = await seedSpot({
      spot_name: `审核测试钓点-${ulid().slice(-6)}`,
      status: 'published',
      open_status: 'open',
    });
    return spot.spot_id;
  }

  async function uploadImage(session: AppSession): Promise<UploadBody> {
    const response = await request(server)
      .post('/api/v1/uploads/ugc')
      .set(appAuthHeaders(session.access_token))
      .attach('file', await pngBuffer(), { filename: 'photo.png', contentType: 'image/png' })
      .expect(201);
    return response.body.data as UploadBody;
  }

  async function createImageReport(
    session: AppSession,
    spotId: string,
    imageKeys: string[],
    content = '带图片的情报',
  ): Promise<CreatedReport> {
    const response = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(session.access_token))
      .send({
        spot_id: spotId,
        content_type: 'comment',
        content,
        image_keys: imageKeys,
        terms_version: TERMS_VERSION,
      })
      .expect(201);
    return response.body.data as CreatedReport;
  }

  async function checksFor(reportId: string): Promise<MediaCheckRow[]> {
    return prisma.reportMediaCheck.findMany({
      where: { report_id: reportId },
      orderBy: [{ created_at: 'asc' }, { trace_id: 'asc' }],
      select: {
        trace_id: true,
        report_id: true,
        image_key: true,
        status: true,
      },
    });
  }

  async function reportStatus(reportId: string): Promise<string> {
    const row = await prisma.report.findUniqueOrThrow({ where: { report_id: reportId } });
    return row.moderation_status;
  }

  function workingFileExists(key: string): boolean {
    return existsSync(join(storageRoot, 'working', ...key.split('/')));
  }

  async function publicItems(spotId: string): Promise<Array<Record<string, unknown>>> {
    const response = await request(server)
      .get(`/api/v1/spots/${spotId}/reports`)
      .set(HEADERS)
      .expect(200);
    return response.body.data.items as Array<Record<string, unknown>>;
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
    storage = app.get(StorageService);
    storageRoot = process.env.STORAGE_LOCAL_ROOT as string;
    await cleanupAppAuthTestData([...TEST_OPENIDS]);
    await setUgcFeature(true);
  });

  beforeEach(async () => {
    await resetAppLoginRateLimiter(app);
    await app.get(RateLimitService).reset('upload:');
    await app.get(RateLimitService).reset('report:');
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

  it('keeps an image report hidden until every callback passes', async () => {
    const spotId = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-media');
    const images = [await uploadImage(user), await uploadImage(user)];
    const report = await createImageReport(
      user,
      spotId,
      images.map((image) => image.key),
    );
    expect(report.moderation_status).toBe(MODERATION_STATUS.MACHINE_PENDING);

    const checks = await checksFor(report.report_id);
    expect(checks).toHaveLength(2);
    expect(checks.map((check) => check.status)).toEqual(['pending', 'pending']);
    expect(checks.map((check) => check.image_key).sort()).toEqual(
      images.map((image) => image.key).sort(),
    );

    const mine = await request(server)
      .get('/api/v1/reports/mine')
      .set(appAuthHeaders(user.access_token))
      .expect(200);
    const mineItem = (mine.body.data.items as Array<Record<string, unknown>>).find(
      (item) => item.report_id === report.report_id,
    );
    expect(mineItem).toBeDefined();
    const mineImages = mineItem?.images as string[];
    expect(mineImages).toHaveLength(2);
    for (const image of mineImages) {
      expect(image).toContain('/api/v1/uploads/preview?');
      expect(image).toContain('area=working');
    }

    const firstCheck = required(checks[0]);
    const secondCheck = required(checks[1]);
    const firstCallback = await sendMediaCallback(server, firstCheck.trace_id, 'pass').expect(200);
    expect(firstCallback.text).toBe('success');
    expect(await publicItems(spotId)).toHaveLength(0);
    expect(await reportStatus(report.report_id)).toBe(MODERATION_STATUS.MACHINE_PENDING);

    const secondCallback = await sendMediaCallback(
      server,
      secondCheck.trace_id,
      'pass',
    ).expect(200);
    expect(secondCallback.text).toBe('success');
    expect(await reportStatus(report.report_id)).toBe(MODERATION_STATUS.PUBLISHED);

    const visible = await publicItems(spotId);
    expect(visible).toHaveLength(1);
    const visibleImages = required(visible[0]).images as string[];
    expect(visibleImages).toHaveLength(2);
    for (const image of visibleImages) {
      expect(image.startsWith(`${PUBLIC_PREFIX}/${report.report_id}/`)).toBe(true);
    }

    const publicUrl = required(visibleImages[0]);
    const firstImage = await request(server).get(publicUrl).expect(200);
    expect(firstImage.headers['content-type']).toContain('image/webp');
    expect(firstImage.headers['cache-control']).toBe('public, max-age=86400');
    expect(firstImage.headers['x-content-type-options']).toBe('nosniff');
    expect(firstImage.headers['cross-origin-resource-policy']).toBe('cross-origin');

    const publishedMine = await request(server)
      .get('/api/v1/reports/mine')
      .set(appAuthHeaders(user.access_token))
      .expect(200);
    const publishedItem = (publishedMine.body.data.items as Array<Record<string, unknown>>).find(
      (item) => item.report_id === report.report_id,
    );
    expect(publishedItem?.images).toEqual(visibleImages);

    // The public route follows the feature flag even for already published objects.
    await setUgcFeature(false);
    try {
      await request(server).get(publicUrl).expect(404);
    } finally {
      await setUgcFeature(true);
    }
    await request(server).get(publicUrl).expect(200);
  });

  it('rejects the whole report when any image is risky', async () => {
    const spotId = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-media-risky');
    const images = [await uploadImage(user), await uploadImage(user)];
    const report = await createImageReport(
      user,
      spotId,
      images.map((image) => image.key),
    );
    const checks = await checksFor(report.report_id);

    await sendMediaCallback(server, required(checks[0]).trace_id, 'pass').expect(200);
    await sendMediaCallback(server, required(checks[1]).trace_id, 'risky').expect(200);

    expect(await reportStatus(report.report_id)).toBe(MODERATION_STATUS.MACHINE_REJECTED);
    expect(await publicItems(spotId)).toHaveLength(0);
    for (const image of images) {
      // Work images are retained for 30 days of review.
      expect(workingFileExists(image.key)).toBe(true);
    }
    await request(server)
      .get(publicImageUrl(report.report_id, required(images[0]).key))
      .expect(404);
  });

  it('keeps review results and media API failures in machine_pending', async () => {
    const spotId = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-media-review');

    const reviewReport = await createImageReport(user, spotId, [(await uploadImage(user)).key]);
    const reviewChecks = await checksFor(reviewReport.report_id);
    await sendMediaCallback(server, required(reviewChecks[0]).trace_id, 'review').expect(200);
    expect(await reportStatus(reviewReport.report_id)).toBe(MODERATION_STATUS.MACHINE_PENDING);

    const provider = app.get(CONTENT_SECURITY_PROVIDER) as unknown as {
      failNextMediaCheck: boolean;
    };
    provider.failNextMediaCheck = true;
    try {
      const failedReport = await createImageReport(user, spotId, [
        (await uploadImage(user)).key,
      ]);
      expect(failedReport.moderation_status).toBe(MODERATION_STATUS.MACHINE_PENDING);
      const failedChecks = await checksFor(failedReport.report_id);
      expect(failedChecks).toHaveLength(1);
      const failedCheck = required(failedChecks[0]);
      expect(failedCheck.status).toBe('error');
      expect(failedCheck.trace_id.startsWith('media-error-')).toBe(true);
      expect(await reportStatus(failedReport.report_id)).toBe(
        MODERATION_STATUS.MACHINE_PENDING,
      );
    } finally {
      provider.failNextMediaCheck = false;
    }

    expect(await publicItems(spotId)).toHaveLength(0);
  });

  it('times out a missing callback without publishing', async () => {
    const spotId = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-media-timeout');
    const images = [await uploadImage(user), await uploadImage(user)];
    const report = await createImageReport(
      user,
      spotId,
      images.map((image) => image.key),
    );
    const checks = await checksFor(report.report_id);
    const firstCheck = required(checks[0]);
    const secondCheck = required(checks[1]);

    await sendMediaCallback(server, firstCheck.trace_id, 'pass').expect(200);
    await prisma.reportMediaCheck.update({
      where: { trace_id: secondCheck.trace_id },
      data: { created_at: new Date(Date.now() - TEN_MINUTES_MS - 60_000) },
    });

    const expired = await expirePendingMediaChecks(prisma);
    expect(expired).not.toBeNull();
    expect(expired ?? 0).toBeGreaterThanOrEqual(1);
    const timedOut = await prisma.reportMediaCheck.findUniqueOrThrow({
      where: { trace_id: secondCheck.trace_id },
    });
    expect(timedOut.status).toBe('timeout');
    expect(await reportStatus(report.report_id)).toBe(MODERATION_STATUS.MACHINE_PENDING);
    expect(await publicItems(spotId)).toHaveLength(0);
  });

  it('deduplicates callbacks and never unpublishes on a repeated risky result', async () => {
    const spotId = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-media-duplicate');
    const image = await uploadImage(user);
    const report = await createImageReport(user, spotId, [image.key]);
    const checks = await checksFor(report.report_id);
    const traceId = required(checks[0]).trace_id;

    await sendMediaCallback(server, traceId, 'pass').expect(200);
    await sendMediaCallback(server, traceId, 'pass').expect(200);
    await sendMediaCallback(server, traceId, 'risky').expect(200);

    expect(await reportStatus(report.report_id)).toBe(MODERATION_STATUS.PUBLISHED);
    const rows = await checksFor(report.report_id);
    expect(rows).toHaveLength(1);
    expect(required(rows[0]).status).toBe('pass');
    await request(server).get(publicImageUrl(report.report_id, image.key)).expect(200);
  });

  it('cancels late callbacks after a human approval', async () => {
    const spotId = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-media-human');
    const images = [await uploadImage(user), await uploadImage(user)];
    const report = await createImageReport(
      user,
      spotId,
      images.map((image) => image.key),
    );
    const checks = await checksFor(report.report_id);

    await prisma.report.update({
      where: { report_id: report.report_id },
      data: {
        moderation_status: MODERATION_STATUS.HUMAN_APPROVED,
        audit_time: new Date(),
      },
    });

    await sendMediaCallback(server, required(checks[0]).trace_id, 'pass').expect(200);
    await sendMediaCallback(server, required(checks[1]).trace_id, 'risky').expect(200);

    expect(await reportStatus(report.report_id)).toBe(MODERATION_STATUS.HUMAN_APPROVED);
    const rows = await checksFor(report.report_id);
    expect(rows.map((row) => row.status)).toEqual(['canceled', 'canceled']);
  });

  it('does not republish after a late risky callback on a removed report', async () => {
    const spotId = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-media-removed');
    const images = [await uploadImage(user), await uploadImage(user)];
    const report = await createImageReport(
      user,
      spotId,
      images.map((image) => image.key),
    );
    const checks = await checksFor(report.report_id);
    const lateTrace = required(checks[1]).trace_id;

    await sendMediaCallback(server, required(checks[0]).trace_id, 'pass').expect(200);
    await prisma.report.update({
      where: { report_id: report.report_id },
      data: { moderation_status: MODERATION_STATUS.REMOVED, audit_time: new Date() },
    });

    await sendMediaCallback(server, lateTrace, 'risky').expect(200);

    expect(await reportStatus(report.report_id)).toBe(MODERATION_STATUS.REMOVED);
    const rows = await checksFor(report.report_id);
    const lateRow = rows.find((row) => row.trace_id === lateTrace);
    expect(lateRow?.status).toBe('canceled');
    expect(await publicItems(spotId)).toHaveLength(0);
    await request(server)
      .get(publicImageUrl(report.report_id, required(images[0]).key))
      .expect(404);
  });

  it('rejects tampered safe-mode callbacks without changing the report', async () => {
    const spotId = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-media-tamper');
    const image = await uploadImage(user);
    const report = await createImageReport(user, spotId, [image.key]);
    const checks = await checksFor(report.report_id);
    const traceId = required(checks[0]).trace_id;

    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 3600);
    const badCiphertext = Buffer.alloc(32, 0x41).toString('base64');
    const attempts: CallbackOverrides[] = [
      { signature: '0'.repeat(40) },
      { msgSignature: '0'.repeat(40) },
      { encrypt: badCiphertext },
      { appid: 'wx-wrong-appid' },
      { timestamp: staleTimestamp },
    ];

    for (const overrides of attempts) {
      const response = await sendMediaCallback(server, traceId, 'pass', overrides).expect(400);
      expect(response.body.code).toBe(ERROR_CODES.VALIDATION);
      expect(await reportStatus(report.report_id)).toBe(MODERATION_STATUS.MACHINE_PENDING);
      const unchanged = await prisma.reportMediaCheck.findUniqueOrThrow({
        where: { trace_id: traceId },
      });
      expect(unchanged.status).toBe('pending');
    }

    const unknown = await sendMediaCallback(server, 'unknown-trace-id', 'pass').expect(200);
    expect(unknown.text).toBe('success');
    expect(await reportStatus(report.report_id)).toBe(MODERATION_STATUS.MACHINE_PENDING);
  });

  it('purges stale pending uploads but keeps objects referenced by a report', async () => {
    const spotId = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-media-purge');
    const staleCutoff = new Date(Date.now() - 25 * 60 * 60 * 1000);

    const orphan = await uploadImage(user);
    await prisma.ugcUpload.update({
      where: { object_key: orphan.key },
      data: { created_at: staleCutoff },
    });

    const referenced = await uploadImage(user);
    await createImageReport(user, spotId, [referenced.key]);
    await prisma.ugcUpload.update({
      where: { object_key: referenced.key },
      data: { status: 'pending', created_at: staleCutoff },
    });

    const result = await purgeUgcOrphans(prisma, storage);
    expect(result).not.toBeNull();
    expect(result?.uploads_marked_deleted).toBeGreaterThanOrEqual(1);
    expect(result?.uploads_marked_used).toBeGreaterThanOrEqual(1);

    const orphanRow = await prisma.ugcUpload.findUniqueOrThrow({
      where: { object_key: orphan.key },
    });
    expect(orphanRow.status).toBe('deleted');
    expect(workingFileExists(orphan.key)).toBe(false);

    const referencedRow = await prisma.ugcUpload.findUniqueOrThrow({
      where: { object_key: referenced.key },
    });
    expect(referencedRow.status).toBe('used');
    expect(workingFileExists(referenced.key)).toBe(true);
  });

  it('deletes rejected work images after 30 days but never a shared published key', async () => {
    const spotId = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-media-purge2');

    const rejectedImage = await uploadImage(user);
    const rejected = await createImageReport(user, spotId, [rejectedImage.key]);
    const checks = await checksFor(rejected.report_id);
    await sendMediaCallback(server, required(checks[0]).trace_id, 'risky').expect(200);
    expect(await reportStatus(rejected.report_id)).toBe(MODERATION_STATUS.MACHINE_REJECTED);
    await prisma.report.update({
      where: { report_id: rejected.report_id },
      data: { audit_time: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });

    const sharedImage = await uploadImage(user);
    const sharedKey = sharedImage.key;
    const oldAudit = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await prisma.report.create({
      data: {
        report_id: ulid(),
        spot_id: spotId,
        user_id: user.user_id,
        content_type: 'comment',
        content: '仍公开的共享图片',
        images: [sharedKey],
        moderation_status: MODERATION_STATUS.PUBLISHED,
      },
    });
    await prisma.report.create({
      data: {
        report_id: ulid(),
        spot_id: spotId,
        user_id: user.user_id,
        content_type: 'comment',
        content: '已下架的共享图片',
        images: [sharedKey],
        moderation_status: MODERATION_STATUS.REMOVED,
        audit_time: oldAudit,
        reject_reason: '违规',
      },
    });

    const result = await purgeUgcOrphans(prisma, storage);
    expect(result).not.toBeNull();

    expect(workingFileExists(rejectedImage.key)).toBe(false);
    const rejectedRow = await prisma.report.findUniqueOrThrow({
      where: { report_id: rejected.report_id },
    });
    expect(rejectedRow.images).toEqual([rejectedImage.key]);

    expect(workingFileExists(sharedKey)).toBe(true);
  });
});
