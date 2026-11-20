import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { ABUSE_REASON, ERROR_CODES } from '@szfisher/shared';
import sharp from 'sharp';
import request from 'supertest';
import { ulid } from 'ulid';
import { purgeUgcOrphans } from '../src/jobs/purge-ugc-orphans.job';
import { WECHAT_AUTH_PROVIDER } from '../src/modules/app-auth/wechat-auth.provider';
import { CONTENT_SECURITY_PROVIDER } from '../src/modules/content-security/content-security.types';
import { RateLimitService } from '../src/modules/rate-limit/rate-limit.service';
import { ReportModerationService } from '../src/modules/reports/report-moderation.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './create-test-app';
import { cleanupAdminSpotTestData, seedSpot } from './admin-spots.helpers';
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
const TEST_OPENIDS = [
  'openid-action-owner',
  'openid-action-liker',
  'openid-action-unlike',
  'openid-action-like-cap',
  'openid-action-abuser',
  'openid-action-abuse-owner',
  'openid-action-abuse-cap',
  'openid-action-abuse-reasons',
  'openid-action-delete-owner',
  'openid-action-delete-other',
  'openid-action-delete-images',
  'openid-action-delete-pending',
  'openid-action-delete-retry',
  'openid-action-purge-upload',
  'openid-action-hidden',
] as const;

interface CreatedReport {
  report_id: string;
  moderation_status: string;
  message: string;
}

interface UploadBody {
  key: string;
  width: number;
  height: number;
  size_bytes: number;
}

describe('Report actions (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
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
      spot_name: `动作测试钓点-${ulid().slice(-6)}`,
      status: 'published',
      open_status: 'open',
    });
    return spot.spot_id;
  }

  async function createReport(
    session: AppSession,
    spotId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<CreatedReport> {
    const response = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(session.access_token))
      .send({
        spot_id: spotId,
        content_type: 'comment',
        content: `动作测试内容 ${ulid().slice(-6)}`,
        terms_version: TERMS_VERSION,
        ...overrides,
      })
      .expect(201);
    return response.body.data as CreatedReport;
  }

  async function uploadImage(session: AppSession): Promise<UploadBody> {
    const response = await request(server)
      .post('/api/v1/uploads/ugc')
      .set(appAuthHeaders(session.access_token))
      .attach('file', await pngBuffer(), { filename: 'photo.png', contentType: 'image/png' })
      .expect(201);
    return response.body.data as UploadBody;
  }

  async function publishImageReport(
    session: AppSession,
    spotId: string,
    imageKeys: string[],
  ): Promise<CreatedReport> {
    const report = await createReport(session, spotId, { image_keys: imageKeys });
    expect(report.moderation_status).toBe('machine_pending');
    // Skip the WeChat callback round trip: mark every check passed and recompute.
    await prisma.reportMediaCheck.updateMany({
      where: { report_id: report.report_id, status: 'pending' },
      data: {
        status: 'pass',
        result: { suggest: 'pass' },
        checked_at: new Date(),
      },
    });
    await app.get(ReportModerationService).recompute(report.report_id);
    const row = await prisma.report.findUniqueOrThrow({
      where: { report_id: report.report_id },
      select: { moderation_status: true },
    });
    expect(row.moderation_status).toBe('published');
    return report;
  }

  function workingFile(key: string): string {
    return join(storageRoot, 'working', ...key.split('/'));
  }

  function publishedFile(reportId: string, key: string): string {
    return join(storageRoot, 'published', 'ugc', reportId, key.split('/').pop() ?? '');
  }

  async function publicItems(spotId: string): Promise<Array<Record<string, unknown>>> {
    const response = await request(server)
      .get(`/api/v1/spots/${spotId}/reports`)
      .set(HEADERS)
      .expect(200);
    return response.body.data.items as Array<Record<string, unknown>>;
  }

  async function mineItems(session: AppSession): Promise<Array<Record<string, unknown>>> {
    const response = await request(server)
      .get('/api/v1/reports/mine')
      .set(appAuthHeaders(session.access_token))
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
    storageRoot = process.env.STORAGE_LOCAL_ROOT as string;
    await cleanupAppAuthTestData([...TEST_OPENIDS]);
    await setUgcFeature(true);
  });

  beforeEach(async () => {
    await resetAppLoginRateLimiter(app);
    const rateLimit = app.get(RateLimitService);
    await rateLimit.reset('report:');
    await rateLimit.reset('like:');
    await rateLimit.reset('abuse:');
  });

  afterAll(async () => {
    const rateLimit = app.get(RateLimitService);
    await rateLimit.reset('report:');
    await rateLimit.reset('like:');
    await rateLimit.reset('abuse:');
    await resetAppLoginRateLimiter(app);
    await cleanupAppAuthTestData([...TEST_OPENIDS]);
    await cleanupAdminSpotTestData();
    await setUgcFeature(false);
    await app.close();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it('likes idempotently and never double-counts', async () => {
    const spotId = await seedOpenSpot();
    const owner = await loginAppUser(server, 'openid-action-owner');
    const liker = await loginAppUser(server, 'openid-action-liker');
    const report = await createReport(owner, spotId);

    const first = await request(server)
      .post(`/api/v1/reports/${report.report_id}/like`)
      .set(appAuthHeaders(liker.access_token))
      .expect(201);
    expect(first.body.data).toMatchObject({ liked: true, like_count: 1 });

    const second = await request(server)
      .post(`/api/v1/reports/${report.report_id}/like`)
      .set(appAuthHeaders(liker.access_token))
      .expect(201);
    expect(second.body.data).toMatchObject({ liked: true, like_count: 1 });

    expect(await prisma.reportLike.count({ where: { report_id: report.report_id } })).toBe(1);
    const row = await prisma.report.findUniqueOrThrow({
      where: { report_id: report.report_id },
      select: { like_count: true },
    });
    expect(row.like_count).toBe(1);

    const list = await request(server)
      .get(`/api/v1/spots/${spotId}/reports`)
      .set(appAuthHeaders(liker.access_token))
      .expect(200);
    expect(list.body.data.items[0]).toMatchObject({
      report_id: report.report_id,
      liked_by_me: true,
      like_count: 1,
    });
  });

  it('unlikes idempotently and keeps the count at zero', async () => {
    const spotId = await seedOpenSpot();
    const owner = await loginAppUser(server, 'openid-action-owner');
    const liker = await loginAppUser(server, 'openid-action-unlike');
    const report = await createReport(owner, spotId);
    await request(server)
      .post(`/api/v1/reports/${report.report_id}/like`)
      .set(appAuthHeaders(liker.access_token))
      .expect(201);

    const first = await request(server)
      .delete(`/api/v1/reports/${report.report_id}/like`)
      .set(appAuthHeaders(liker.access_token))
      .expect(200);
    expect(first.body.data).toMatchObject({ liked: false, like_count: 0 });

    const second = await request(server)
      .delete(`/api/v1/reports/${report.report_id}/like`)
      .set(appAuthHeaders(liker.access_token))
      .expect(200);
    expect(second.body.data).toMatchObject({ liked: false, like_count: 0 });

    expect(await prisma.reportLike.count({ where: { report_id: report.report_id } })).toBe(0);
    const row = await prisma.report.findUniqueOrThrow({
      where: { report_id: report.report_id },
      select: { like_count: true },
    });
    expect(row.like_count).toBe(0);

    const list = await request(server)
      .get(`/api/v1/spots/${spotId}/reports`)
      .set(appAuthHeaders(liker.access_token))
      .expect(200);
    expect(list.body.data.items[0]).toMatchObject({
      liked_by_me: false,
      like_count: 0,
    });
  });

  it('caps likes at 60 actions per user per minute', async () => {
    const spotId = await seedOpenSpot();
    const owner = await loginAppUser(server, 'openid-action-owner');
    const liker = await loginAppUser(server, 'openid-action-like-cap');
    const report = await createReport(owner, spotId);

    for (let index = 0; index < 60; index += 1) {
      await request(server)
        .post(`/api/v1/reports/${report.report_id}/like`)
        .set(appAuthHeaders(liker.access_token))
        .expect(201);
    }

    const blocked = await request(server)
      .post(`/api/v1/reports/${report.report_id}/like`)
      .set(appAuthHeaders(liker.access_token))
      .expect(429);
    expect(blocked.body.code).toBe(ERROR_CODES.RATE_LIMITED);

    // Rejected requests must not touch the like row or the cached count.
    expect(await prisma.reportLike.count({ where: { report_id: report.report_id } })).toBe(1);
    const row = await prisma.report.findUniqueOrThrow({
      where: { report_id: report.report_id },
      select: { like_count: true },
    });
    expect(row.like_count).toBe(1);
  });

  it('returns 404 for likes and abuse reports on content that is not publicly visible', async () => {
    const spotId = await seedOpenSpot();
    const owner = await loginAppUser(server, 'openid-action-hidden');
    const other = await loginAppUser(server, 'openid-action-liker');
    const pending = await createReport(owner, spotId, { content: 'REVIEW 待人工内容' });
    expect(pending.moderation_status).toBe('machine_pending');

    const like = await request(server)
      .post(`/api/v1/reports/${pending.report_id}/like`)
      .set(appAuthHeaders(other.access_token))
      .expect(404);
    expect(like.body.code).toBe(ERROR_CODES.REPORT_NOT_FOUND);

    const unlike = await request(server)
      .delete(`/api/v1/reports/${pending.report_id}/like`)
      .set(appAuthHeaders(other.access_token))
      .expect(404);
    expect(unlike.body.code).toBe(ERROR_CODES.REPORT_NOT_FOUND);

    const abuse = await request(server)
      .post(`/api/v1/reports/${pending.report_id}/abuse`)
      .set(appAuthHeaders(other.access_token))
      .send({ reason: ABUSE_REASON.OTHER })
      .expect(404);
    expect(abuse.body.code).toBe(ERROR_CODES.REPORT_NOT_FOUND);

    const missing = await request(server)
      .post(`/api/v1/reports/${ulid()}/like`)
      .set(appAuthHeaders(other.access_token))
      .expect(404);
    expect(missing.body.code).toBe(ERROR_CODES.REPORT_NOT_FOUND);
  });

  it('forbids authors from reporting their own content', async () => {
    const spotId = await seedOpenSpot();
    const owner = await loginAppUser(server, 'openid-action-abuse-owner');
    const report = await createReport(owner, spotId);

    const response = await request(server)
      .post(`/api/v1/reports/${report.report_id}/abuse`)
      .set(appAuthHeaders(owner.access_token))
      .send({ reason: ABUSE_REASON.ABUSE })
      .expect(403);
    expect(response.body.code).toBe(ERROR_CODES.REPORT_FORBIDDEN);
    expect(await prisma.reportAbuse.count({ where: { report_id: report.report_id } })).toBe(0);
  });

  it('accepts every abuse reason and treats duplicate reports as success', async () => {
    const spotId = await seedOpenSpot();
    const owner = await loginAppUser(server, 'openid-action-owner');
    // Five fixtures exceed the 3/day new-user posting limit.
    await prisma.appUser.update({
      where: { user_id: owner.user_id },
      data: { created_at: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    });
    const reporter = await loginAppUser(server, 'openid-action-abuse-reasons');
    const reasons = Object.values(ABUSE_REASON);

    const reportIds: string[] = [];
    for (const reason of reasons) {
      const report = await createReport(owner, spotId);
      reportIds.push(report.report_id);
      const response = await request(server)
        .post(`/api/v1/reports/${report.report_id}/abuse`)
        .set(appAuthHeaders(reporter.access_token))
        .send({ reason })
        .expect(201);
      expect(response.body.data).toMatchObject({ reported: true });
    }

    const firstReportId = reportIds[0] as string;
    const duplicate = await request(server)
      .post(`/api/v1/reports/${firstReportId}/abuse`)
      .set(appAuthHeaders(reporter.access_token))
      .send({ reason: ABUSE_REASON.PRIVACY })
      .expect(201);
    expect(duplicate.body.data).toMatchObject({ reported: true });

    expect(await prisma.reportAbuse.count({ where: { report_id: firstReportId } })).toBe(1);
    const rows = await prisma.reportAbuse.findMany({
      where: { report_id: { in: reportIds } },
      select: { report_id: true, reason: true },
    });
    expect(rows).toHaveLength(reasons.length);
    expect(new Set(rows.map((row) => row.reason))).toEqual(new Set(reasons));

    const invalid = await request(server)
      .post(`/api/v1/reports/${firstReportId}/abuse`)
      .set(appAuthHeaders(reporter.access_token))
      .send({ reason: 'spam' })
      .expect(400);
    expect(invalid.body.code).toBe(ERROR_CODES.VALIDATION);
  });

  it('caps abuse reports at 20 per user per day', async () => {
    const spotId = await seedOpenSpot();
    const owner = await loginAppUser(server, 'openid-action-owner');
    const reporter = await loginAppUser(server, 'openid-action-abuse-cap');
    const report = await createReport(owner, spotId);

    for (let index = 0; index < 20; index += 1) {
      await request(server)
        .post(`/api/v1/reports/${report.report_id}/abuse`)
        .set(appAuthHeaders(reporter.access_token))
        .send({ reason: ABUSE_REASON.OTHER })
        .expect(201);
    }

    const blocked = await request(server)
      .post(`/api/v1/reports/${report.report_id}/abuse`)
      .set(appAuthHeaders(reporter.access_token))
      .send({ reason: ABUSE_REASON.OTHER })
      .expect(429);
    expect(blocked.body.code).toBe(ERROR_CODES.RATE_LIMITED);
    // Duplicates still collapse into the unique (report_id, user_id) row.
    expect(await prisma.reportAbuse.count({ where: { report_id: report.report_id } })).toBe(1);
  });

  it('deletes only as the author and keeps a tombstone out of both lists', async () => {
    const spotId = await seedOpenSpot();
    const owner = await loginAppUser(server, 'openid-action-delete-owner');
    const other = await loginAppUser(server, 'openid-action-delete-other');
    const report = await createReport(owner, spotId, { content: '待删除' });

    const forbidden = await request(server)
      .delete(`/api/v1/reports/${report.report_id}`)
      .set(appAuthHeaders(other.access_token))
      .expect(403);
    expect(forbidden.body.code).toBe(ERROR_CODES.REPORT_FORBIDDEN);

    const deleted = await request(server)
      .delete(`/api/v1/reports/${report.report_id}`)
      .set(appAuthHeaders(owner.access_token))
      .expect(200);
    expect(deleted.body.data).toMatchObject({ deleted: true });

    const again = await request(server)
      .delete(`/api/v1/reports/${report.report_id}`)
      .set(appAuthHeaders(owner.access_token))
      .expect(404);
    expect(again.body.code).toBe(ERROR_CODES.REPORT_NOT_FOUND);

    const anonymous = await request(server)
      .delete(`/api/v1/reports/${report.report_id}`)
      .set(HEADERS)
      .expect(401);
    expect(anonymous.body.code).toBe(ERROR_CODES.UNAUTHENTICATED);

    expect(await publicItems(spotId)).toHaveLength(0);
    expect(await mineItems(owner)).toHaveLength(0);
    const removedFilter = await request(server)
      .get('/api/v1/reports/mine')
      .query({ status: 'removed' })
      .set(appAuthHeaders(owner.access_token))
      .expect(200);
    expect(removedFilter.body.data.items).toHaveLength(0);

    // Tombstone retained for admin audit: identifiers and timestamps survive,
    // user content does not.
    const row = await prisma.report.findUniqueOrThrow({
      where: { report_id: report.report_id },
    });
    expect(row).toMatchObject({
      report_id: report.report_id,
      user_id: owner.user_id,
      content: '',
      images: [],
      moderation_status: 'removed',
      reject_reason: 'author_deleted',
      fish_key: null,
      catch_weight_kg: null,
    });
    expect(row.deleted_at).not.toBeNull();
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it('removes published and work images and marks uploads deleted', async () => {
    const spotId = await seedOpenSpot();
    const owner = await loginAppUser(server, 'openid-action-delete-images');
    const images = [await uploadImage(owner), await uploadImage(owner)];
    const imageKeys = images.map((image) => image.key);
    const report = await publishImageReport(owner, spotId, imageKeys);

    for (const key of imageKeys) {
      expect(existsSync(workingFile(key))).toBe(true);
      expect(existsSync(publishedFile(report.report_id, key))).toBe(true);
    }
    expect(await publicItems(spotId)).toHaveLength(1);

    await request(server)
      .delete(`/api/v1/reports/${report.report_id}`)
      .set(appAuthHeaders(owner.access_token))
      .expect(200);

    for (const key of imageKeys) {
      expect(existsSync(workingFile(key))).toBe(false);
      expect(existsSync(publishedFile(report.report_id, key))).toBe(false);
    }
    const uploads = await prisma.ugcUpload.findMany({
      where: { object_key: { in: imageKeys } },
      select: { status: true, deleted_at: true },
    });
    expect(uploads).toHaveLength(2);
    for (const upload of uploads) {
      expect(upload.status).toBe('deleted');
      expect(upload.deleted_at).not.toBeNull();
    }

    const row = await prisma.report.findUniqueOrThrow({
      where: { report_id: report.report_id },
    });
    expect(row.images).toEqual([]);
    expect(row.content).toBe('');
    expect(row.deleted_at).not.toBeNull();

    expect(await publicItems(spotId)).toHaveLength(0);
    expect(await mineItems(owner)).toHaveLength(0);
    for (const key of imageKeys) {
      await request(server)
        .get(`/api/v1/uploads/public/ugc/${report.report_id}/${key.split('/').pop() ?? ''}`)
        .expect(404);
    }
  });

  it('cancels pending media checks when the author deletes a pending report', async () => {
    const spotId = await seedOpenSpot();
    const owner = await loginAppUser(server, 'openid-action-delete-pending');
    const image = await uploadImage(owner);
    const report = await createReport(owner, spotId, { image_keys: [image.key] });

    const before = await prisma.reportMediaCheck.findMany({
      where: { report_id: report.report_id },
      select: { trace_id: true, status: true, checked_at: true },
    });
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ status: 'pending', checked_at: null });

    await request(server)
      .delete(`/api/v1/reports/${report.report_id}`)
      .set(appAuthHeaders(owner.access_token))
      .expect(200);

    const after = await prisma.reportMediaCheck.findUniqueOrThrow({
      where: { trace_id: (before[0] as { trace_id: string }).trace_id },
    });
    expect(after.status).toBe('canceled');
    expect(after.checked_at).not.toBeNull();

    const upload = await prisma.ugcUpload.findUniqueOrThrow({
      where: { object_key: image.key },
      select: { status: true, deleted_at: true },
    });
    expect(upload.status).toBe('deleted');
    expect(upload.deleted_at).not.toBeNull();
    expect(existsSync(workingFile(image.key))).toBe(false);
    expect(await mineItems(owner)).toHaveLength(0);
  });

  it('keeps report images for the purge job when object deletion fails', async () => {
    const spotId = await seedOpenSpot();
    const owner = await loginAppUser(server, 'openid-action-delete-retry');
    const image = await uploadImage(owner);
    const report = await publishImageReport(owner, spotId, [image.key]);

    const storage = app.get(StorageService);
    const failure = jest
      .spyOn(storage, 'deleteObject')
      .mockRejectedValueOnce(new Error('bucket unavailable'));
    try {
      await request(server)
        .delete(`/api/v1/reports/${report.report_id}`)
        .set(appAuthHeaders(owner.access_token))
        .expect(200);
    } finally {
      failure.mockRestore();
    }

    // Hidden immediately, but the work object and the DB retry pointer remain.
    expect(await publicItems(spotId)).toHaveLength(0);
    expect(await mineItems(owner)).toHaveLength(0);
    const tombstone = await prisma.report.findUniqueOrThrow({
      where: { report_id: report.report_id },
    });
    expect(tombstone).toMatchObject({
      content: '',
      images: [image.key],
      moderation_status: 'removed',
      reject_reason: 'author_deleted',
    });
    expect(tombstone.deleted_at).not.toBeNull();
    expect(existsSync(workingFile(image.key))).toBe(true);

    // The scheduled purge retries both buckets and drops the pointer.
    const result = await purgeUgcOrphans(prisma, app.get(StorageService));
    expect(result).not.toBeNull();
    expect(existsSync(workingFile(image.key))).toBe(false);
    expect(existsSync(publishedFile(report.report_id, image.key))).toBe(false);
    const afterPurge = await prisma.report.findUniqueOrThrow({
      where: { report_id: report.report_id },
    });
    expect(afterPurge.images).toEqual([]);
  });

  it('purges work objects for uploads already marked deleted', async () => {
    const owner = await loginAppUser(server, 'openid-action-purge-upload');
    const image = await uploadImage(owner);
    await prisma.ugcUpload.update({
      where: { object_key: image.key },
      data: { status: 'deleted', deleted_at: new Date() },
    });
    expect(existsSync(workingFile(image.key))).toBe(true);

    const result = await purgeUgcOrphans(prisma, app.get(StorageService));
    expect(result).not.toBeNull();
    expect(existsSync(workingFile(image.key))).toBe(false);
    const upload = await prisma.ugcUpload.findUniqueOrThrow({
      where: { object_key: image.key },
    });
    expect(upload.status).toBe('deleted');
  });

  it('requires authentication for every action', async () => {
    const reportId = ulid();
    const responses = await Promise.all([
      request(server).post(`/api/v1/reports/${reportId}/like`).set(HEADERS),
      request(server).delete(`/api/v1/reports/${reportId}/like`).set(HEADERS),
      request(server)
        .post(`/api/v1/reports/${reportId}/abuse`)
        .set(HEADERS)
        .send({ reason: ABUSE_REASON.OTHER }),
      request(server).delete(`/api/v1/reports/${reportId}`).set(HEADERS),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ERROR_CODES.UNAUTHENTICATED);
    }
  });
});

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
