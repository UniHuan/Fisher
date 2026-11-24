import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { Report } from '@prisma/client';
import {
  ABUSE_REASON,
  ADMIN_ROLE,
  ERROR_CODES,
  MODERATION_STATUS,
} from '@szfisher/shared';
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
import { cleanupAdminSpotTestData, seedSpot } from './admin-spots.helpers';
import { createTestApp } from './create-test-app';
import {
  cleanupAuthTestData,
  clientHeaders,
  loginAs,
  loginAsSuperAdmin,
  type AuthSession,
} from './support/auth-helpers';
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
const HOUR_MS = 60 * 60 * 1000;
const PUBLIC_UGC_PREFIX = '/api/v1/uploads/public/ugc';

const TEST_OPENIDS = [
  'openid-admin-queue',
  'openid-admin-approve',
  'openid-admin-terminal',
  'openid-admin-reject',
  'openid-admin-remove',
  'openid-admin-adopt',
  'openid-admin-abuse-owner',
  'openid-admin-abuse-one',
  'openid-admin-abuse-two',
  'openid-admin-abuse-three',
  'openid-admin-restrict',
  'openid-admin-ban',
  'openid-admin-ban-create',
  'openid-admin-race-delete',
  'openid-admin-audit',
  'openid-admin-audit-target',
  'openid-admin-race-reject',
  'openid-admin-race-remove',
  'openid-admin-condition',
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

interface AdminReportAuthor {
  user_id: string;
  nickname: string | null;
  status: string;
  restricted_until: string | null;
  created_at: string;
  rejected_count: number;
}

interface AdminReportItem {
  report_id: string;
  spot_id: string;
  spot_name: string;
  content_type: string;
  content: string;
  images: string[];
  condition_open_status: string | null;
  condition_fee_status: string | null;
  condition_crowd_level: string | null;
  condition_facilities: string[];
  observed_at: string | null;
  moderation_status: string;
  reject_reason: string | null;
  abuse_count: number;
  is_adopted: boolean;
  age_hours: number;
  sla_overdue: boolean;
  author: AdminReportAuthor;
  machine_result: Record<string, unknown> | null;
  adopted_at: string | null;
  adopted_by: string | null;
  auditor_id: string | null;
  audit_time: string | null;
}

interface AdminReportSummary {
  spot_check: number;
  pending: number;
  rejected: number;
  removed: number;
  abuse_pending: number;
  media_check_unfinished: number;
  sla_overdue: number;
}

interface AdminAbuseItem {
  abuse_id: string;
  report_id: string;
  reason: string;
  status: string;
  age_hours: number;
  sla_overdue: boolean;
  report: {
    content_type: string;
    content: string;
    moderation_status: string;
    images: string[];
    spot_id: string;
    spot_name: string;
  };
}

interface AdminReportHistoryAudit {
  log_id: string;
  action: string;
  status_before: string | null;
  status_after: string | null;
  reason: string | null;
  admin_id: string;
  created_at: string;
}

interface AdminReportHistoryAbuse {
  abuse_id: string;
  reason: string;
  status: string;
  created_at: string;
  handled_at: string | null;
}

interface AdminReportHistory {
  report_id: string;
  audit: AdminReportHistoryAudit[];
  abuses: AdminReportHistoryAbuse[];
}

interface SeedReportOptions {
  userId: string;
  spotId: string;
  status?: string;
  createdAt?: Date;
  contentType?: string;
  content?: string;
  images?: string[];
  rejectReason?: string | null;
  auditTime?: Date | null;
  fishKey?: string | null;
}

async function pngBuffer(): Promise<Buffer> {
  return sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 12, g: 180, b: 40 },
    },
  })
    .png()
    .toBuffer();
}

function adminRequest(session: AuthSession): Record<string, string> {
  return {
    ...clientHeaders(),
    Cookie: session.cookie,
    'X-CSRF-Token': session.csrf,
  };
}

function bodyData<T>(response: request.Response): T {
  return response.body.data as T;
}

/** Recursively gathers every key in an audit JSON payload. */
function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, keys);
    }
    return keys;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

describe('Admin moderation (e2e)', () => {
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

  async function seedOpenSpot(overrides: Record<string, unknown> = {}) {
    return seedSpot({
      spot_name: `后台审核钓点-${ulid().slice(-6)}`,
      status: 'published',
      open_status: 'open',
      ...overrides,
    });
  }

  async function loginUser(openid: string): Promise<AppSession> {
    return loginAppUser(server, openid);
  }

  async function seedReport(options: SeedReportOptions): Promise<Report> {
    return prisma.report.create({
      data: {
        report_id: ulid(),
        user_id: options.userId,
        spot_id: options.spotId,
        content_type: options.contentType ?? 'comment',
        content: options.content ?? `后台审核内容 ${ulid().slice(-6)}`,
        moderation_status: options.status ?? MODERATION_STATUS.PUBLISHED,
        created_at: options.createdAt ?? new Date(),
        images: options.images ?? [],
        fish_key: options.fishKey ?? null,
        reject_reason: options.rejectReason ?? null,
        audit_time: options.auditTime ?? null,
      },
    });
  }

  async function uploadImage(session: AppSession): Promise<UploadBody> {
    const response = await request(server)
      .post('/api/v1/uploads/ugc')
      .set(appAuthHeaders(session.access_token))
      .attach('file', await pngBuffer(), { filename: 'photo.png', contentType: 'image/png' })
      .expect(201);
    return bodyData<UploadBody>(response);
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
        content: `后台上架内容 ${ulid().slice(-6)}`,
        terms_version: TERMS_VERSION,
        ...overrides,
      })
      .expect(201);
    return bodyData<CreatedReport>(response);
  }

  async function publishImageReport(
    session: AppSession,
    spotId: string,
  ): Promise<{ reportId: string; key: string }> {
    const image = await uploadImage(session);
    const report = await createReport(session, spotId, { image_keys: [image.key] });
    expect(report.moderation_status).toBe(MODERATION_STATUS.MACHINE_PENDING);
    await prisma.reportMediaCheck.updateMany({
      where: { report_id: report.report_id, status: 'pending' },
      data: { status: 'pass', result: { suggest: 'pass' }, checked_at: new Date() },
    });
    await app.get(ReportModerationService).recompute(report.report_id);
    const row = await prisma.report.findUniqueOrThrow({
      where: { report_id: report.report_id },
      select: { moderation_status: true },
    });
    expect(row.moderation_status).toBe(MODERATION_STATUS.PUBLISHED);
    return { reportId: report.report_id, key: image.key };
  }

  function workingFile(key: string): string {
    return join(storageRoot, 'working', ...key.split('/'));
  }

  function publishedFile(reportId: string, key: string): string {
    return join(storageRoot, 'published', 'ugc', reportId, key.split('/').pop() ?? '');
  }

  async function listQueue(
    session: AuthSession,
    query: Record<string, string | number>,
  ): Promise<{ items: AdminReportItem[]; next_cursor: string | null; total: number }> {
    const response = await request(server)
      .get('/api/v1/admin/reports')
      .query(query)
      .set(adminRequest(session))
      .expect(200);
    return bodyData(response);
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
    await cleanupAuthTestData();
    await cleanupAdminSpotTestData();
    await setUgcFeature(false);
    await app.close();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it('returns condition fields in the admin queue and filters by type', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const owner = await loginUser('openid-admin-condition');
    const spot = await seedOpenSpot();
    const created = await createReport(owner, spot.spot_id, {
      content_type: 'condition',
      content: '',
      condition: {
        open_status: 'open',
        fee_status: 'free',
        crowd_level: 'low',
        facilities: ['toilet', 'parking'],
      },
    });

    const queue = await listQueue(reviewer, {
      queue: 'spot_check',
      spot_id: spot.spot_id,
      content_type: 'condition',
      limit: 50,
    });
    const item = queue.items.find((row) => row.report_id === created.report_id);
    expect(item).toMatchObject({
      content_type: 'condition',
      content: '',
      condition_open_status: 'open',
      condition_fee_status: 'free',
      condition_crowd_level: 'low',
      condition_facilities: ['toilet', 'parking'],
    });
    expect(item?.observed_at).toEqual(expect.any(String));
  });

  it('filters queues, computes SLA and author rejected counts, and maps image URLs', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const owner = await loginUser('openid-admin-queue');
    const spot = await seedOpenSpot();
    const pageSpot = await seedOpenSpot();
    const now = new Date();
    const publishedKey = `ugc/${owner.user_id}/${ulid()}.webp`;
    const pendingKey = `ugc/${owner.user_id}/${ulid()}.webp`;

    const publishedReport = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.PUBLISHED,
      images: [publishedKey],
      createdAt: now,
    });
    const oldPublished = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.PUBLISHED,
      createdAt: new Date(now.getTime() - 25 * HOUR_MS),
    });
    const catchReport = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.PUBLISHED,
      contentType: 'catch',
      fishKey: 'luofei',
    });
    const pendingReport = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.MACHINE_PENDING,
      images: [pendingKey],
    });
    const machineRejected = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.MACHINE_REJECTED,
      rejectReason: '机审拒绝',
    });
    const humanRejected = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.HUMAN_REJECTED,
      rejectReason: '人工驳回',
    });
    const removed = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.REMOVED,
      rejectReason: '人工下架',
    });
    for (let index = 0; index < 3; index += 1) {
      await seedReport({
        userId: owner.user_id,
        spotId: spot.spot_id,
        status: MODERATION_STATUS.HUMAN_REJECTED,
        rejectReason: '历史驳回',
      });
    }
    for (let index = 0; index < 3; index += 1) {
      await seedReport({
        userId: owner.user_id,
        spotId: pageSpot.spot_id,
        status: MODERATION_STATUS.PUBLISHED,
        createdAt: new Date(now.getTime() + index),
      });
    }

    const spotCheck = await listQueue(reviewer, {
      queue: 'spot_check',
      spot_id: spot.spot_id,
      limit: 50,
    });
    const spotCheckIds = spotCheck.items.map((item) => item.report_id);
    expect(spotCheckIds).toEqual(
      expect.arrayContaining([
        publishedReport.report_id,
        oldPublished.report_id,
        catchReport.report_id,
      ]),
    );
    expect(spotCheck.items).toHaveLength(3);
    expect(new Set(spotCheck.items.map((item) => item.moderation_status))).toEqual(
      new Set([MODERATION_STATUS.PUBLISHED]),
    );

    const publishedItem = spotCheck.items.find(
      (item) => item.report_id === publishedReport.report_id,
    );
    expect(publishedItem?.images).toEqual([
      `${PUBLIC_UGC_PREFIX}/${publishedReport.report_id}/${publishedKey.split('/').pop()}`,
    ]);
    expect(publishedItem?.sla_overdue).toBe(false);
    expect(publishedItem?.age_hours).toBeLessThan(1);
    expect(publishedItem?.author.user_id).toBe(owner.user_id);
    // machine_rejected + human_rejected + the three historical rejections.
    expect(publishedItem?.author.rejected_count).toBe(5);

    const oldItem = spotCheck.items.find((item) => item.report_id === oldPublished.report_id);
    expect(oldItem?.sla_overdue).toBe(true);
    expect(oldItem?.age_hours).toBeGreaterThanOrEqual(25);
    expect(oldItem?.age_hours).toBeLessThan(26);

    // Spot name and SLA filters are applied by the server before pagination, so
    // items and total stay consistent on later cursor pages.
    const byName = await listQueue(reviewer, {
      queue: 'spot_check',
      spot_name: spot.spot_name,
      limit: 50,
    });
    expect(byName.total).toBe(3);
    expect(byName.items).toHaveLength(3);
    expect(byName.items.every((item) => item.spot_id === spot.spot_id)).toBe(true);

    const byOtherName = await listQueue(reviewer, {
      queue: 'spot_check',
      spot_name: pageSpot.spot_name,
      limit: 50,
    });
    expect(byOtherName.total).toBe(3);
    expect(byOtherName.items.every((item) => item.spot_id === pageSpot.spot_id)).toBe(true);

    const overdueOnly = await listQueue(reviewer, {
      queue: 'spot_check',
      spot_id: spot.spot_id,
      sla_overdue: 'true',
      limit: 50,
    });
    expect(overdueOnly.total).toBe(1);
    expect(overdueOnly.items.map((item) => item.report_id)).toEqual([oldPublished.report_id]);

    const freshOnly = await listQueue(reviewer, {
      queue: 'spot_check',
      spot_id: spot.spot_id,
      sla_overdue: 'false',
      limit: 50,
    });
    expect(freshOnly.total).toBe(2);
    expect(freshOnly.items.map((item) => item.report_id)).toEqual(
      expect.arrayContaining([publishedReport.report_id, catchReport.report_id]),
    );

    const pending = await listQueue(reviewer, {
      queue: 'pending',
      spot_id: spot.spot_id,
      limit: 50,
    });
    expect(pending.items).toHaveLength(1);
    expect(pending.items[0]?.report_id).toBe(pendingReport.report_id);
    expect(pending.items[0]?.images[0]).toContain('/api/v1/uploads/preview?');
    expect(pending.items[0]?.images[0]).toContain('area=working');

    const rejected = await listQueue(reviewer, {
      queue: 'rejected',
      spot_id: spot.spot_id,
      limit: 50,
    });
    expect(rejected.items).toHaveLength(5);
    expect(new Set(rejected.items.map((item) => item.moderation_status))).toEqual(
      new Set([MODERATION_STATUS.MACHINE_REJECTED, MODERATION_STATUS.HUMAN_REJECTED]),
    );
    expect(new Set(rejected.items.map((item) => item.report_id))).toEqual(
      new Set([
        machineRejected.report_id,
        humanRejected.report_id,
        ...rejected.items
          .filter((item) => item.reject_reason === '历史驳回')
          .map((item) => item.report_id),
      ]),
    );

    const removedQueue = await listQueue(reviewer, {
      queue: 'removed',
      spot_id: spot.spot_id,
      limit: 50,
    });
    expect(removedQueue.items.map((item) => item.report_id)).toEqual([removed.report_id]);

    const catchOnly = await listQueue(reviewer, {
      queue: 'spot_check',
      spot_id: spot.spot_id,
      content_type: 'catch',
      limit: 50,
    });
    expect(catchOnly.items.map((item) => item.report_id)).toEqual([catchReport.report_id]);

    const firstPage = await listQueue(reviewer, {
      queue: 'spot_check',
      spot_id: pageSpot.spot_id,
      limit: 2,
    });
    expect(firstPage.total).toBe(3);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.next_cursor).not.toBeNull();
    const secondPage = await listQueue(reviewer, {
      queue: 'spot_check',
      spot_id: pageSpot.spot_id,
      limit: 2,
      cursor: firstPage.next_cursor as string,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.next_cursor).toBeNull();
    const pagedIds = [...firstPage.items, ...secondPage.items].map((item) => item.report_id);
    expect(new Set(pagedIds).size).toBe(3);

    const summaryResponse = await request(server)
      .get('/api/v1/admin/reports/summary')
      .set(adminRequest(reviewer))
      .expect(200);
    const summary = bodyData<AdminReportSummary>(summaryResponse);
    expect(summary.spot_check).toBe(
      await prisma.report.count({
        where: { deleted_at: null, moderation_status: MODERATION_STATUS.PUBLISHED },
      }),
    );
    expect(summary.pending).toBe(
      await prisma.report.count({
        where: { deleted_at: null, moderation_status: MODERATION_STATUS.MACHINE_PENDING },
      }),
    );
    expect(summary.rejected).toBe(
      await prisma.report.count({
        where: {
          deleted_at: null,
          moderation_status: {
            in: [MODERATION_STATUS.MACHINE_REJECTED, MODERATION_STATUS.HUMAN_REJECTED],
          },
        },
      }),
    );
    expect(summary.removed).toBe(
      await prisma.report.count({
        where: { deleted_at: null, moderation_status: MODERATION_STATUS.REMOVED },
      }),
    );
    expect(summary.sla_overdue).toBeGreaterThanOrEqual(1);
    expect(summary.abuse_pending).toBe(0);
    expect(summary.media_check_unfinished).toBe(0);
  });

  it('lets a reviewer approve a machine-pending report while image checks are pending', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const owner = await loginUser('openid-admin-approve');
    const spot = await seedOpenSpot();
    const image = await uploadImage(owner);
    const report = await createReport(owner, spot.spot_id, { image_keys: [image.key] });
    expect(report.moderation_status).toBe(MODERATION_STATUS.MACHINE_PENDING);

    const response = await request(server)
      .post(`/api/v1/admin/reports/${report.report_id}/approve`)
      .set(adminRequest(reviewer))
      .expect(200);
    expect(bodyData(response)).toMatchObject({
      report_id: report.report_id,
      moderation_status: MODERATION_STATUS.HUMAN_APPROVED,
    });

    const row = await prisma.report.findUniqueOrThrow({
      where: { report_id: report.report_id },
    });
    expect(row.moderation_status).toBe(MODERATION_STATUS.HUMAN_APPROVED);
    expect(row.auditor_id).toBe(reviewer.admin.adminId);
    expect(row.audit_time).not.toBeNull();
    expect(
      await prisma.reportMediaCheck.count({
        where: { report_id: report.report_id, status: 'canceled' },
      }),
    ).toBeGreaterThan(0);
    expect(existsSync(workingFile(image.key))).toBe(true);
    expect(existsSync(publishedFile(report.report_id, image.key))).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: {
        admin_id: reviewer.admin.adminId,
        action: 'report.approve',
        entity_id: report.report_id,
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.before_json).toMatchObject({
      moderation_status: MODERATION_STATUS.MACHINE_PENDING,
    });
    expect(audit?.after_json).toMatchObject({
      moderation_status: MODERATION_STATUS.HUMAN_APPROVED,
    });
  });

  it('returns 409 for approve on terminal content and 404 for an unknown report', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const owner = await loginUser('openid-admin-terminal');
    const spot = await seedOpenSpot();
    const statuses = [
      MODERATION_STATUS.MACHINE_REJECTED,
      MODERATION_STATUS.HUMAN_REJECTED,
      MODERATION_STATUS.REMOVED,
    ];
    for (const status of statuses) {
      const report = await seedReport({
        userId: owner.user_id,
        spotId: spot.spot_id,
        status,
      });
      const response = await request(server)
        .post(`/api/v1/admin/reports/${report.report_id}/approve`)
        .set(adminRequest(reviewer))
        .expect(409);
      expect(response.body.code).toBe(ERROR_CODES.STATE_CONFLICT);
    }

    const missing = await request(server)
      .post(`/api/v1/admin/reports/${ulid()}/approve`)
      .set(adminRequest(reviewer))
      .expect(404);
    expect(missing.body.code).toBe(ERROR_CODES.REPORT_NOT_FOUND);
  });

  it('requires a reason to reject and removes published images', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const owner = await loginUser('openid-admin-reject');
    const spot = await seedOpenSpot();
    const { reportId, key } = await publishImageReport(owner, spot.spot_id);

    const missingReason = await request(server)
      .post(`/api/v1/admin/reports/${reportId}/reject`)
      .set(adminRequest(reviewer))
      .send({})
      .expect(400);
    expect(missingReason.body.code).toBe(ERROR_CODES.VALIDATION);

    const response = await request(server)
      .post(`/api/v1/admin/reports/${reportId}/reject`)
      .set(adminRequest(reviewer))
      .send({ reason: '广告引流' })
      .expect(200);
    expect(bodyData(response)).toMatchObject({
      report_id: reportId,
      moderation_status: MODERATION_STATUS.HUMAN_REJECTED,
    });

    const row = await prisma.report.findUniqueOrThrow({ where: { report_id: reportId } });
    expect(row.moderation_status).toBe(MODERATION_STATUS.HUMAN_REJECTED);
    expect(row.reject_reason).toBe('广告引流');
    expect(existsSync(publishedFile(reportId, key))).toBe(false);
    expect(existsSync(workingFile(key))).toBe(true);

    await request(server)
      .post(`/api/v1/admin/reports/${reportId}/approve`)
      .set(adminRequest(reviewer))
      .expect(409);

    const machineRejected = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.MACHINE_REJECTED,
    });
    await request(server)
      .post(`/api/v1/admin/reports/${machineRejected.report_id}/reject`)
      .set(adminRequest(reviewer))
      .send({ reason: '重复驳回' })
      .expect(409);

    const audit = await prisma.auditLog.findFirst({
      where: { admin_id: reviewer.admin.adminId, action: 'report.reject', entity_id: reportId },
    });
    expect(audit?.before_json).toMatchObject({ moderation_status: MODERATION_STATUS.PUBLISHED });
    expect(audit?.after_json).toMatchObject({
      moderation_status: MODERATION_STATUS.HUMAN_REJECTED,
      reason: '广告引流',
    });
  });

  it('requires a reason to remove, deletes published images and keeps a purge retry pointer', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const owner = await loginUser('openid-admin-remove');
    const spot = await seedOpenSpot();
    const { reportId, key } = await publishImageReport(owner, spot.spot_id);

    const missingReason = await request(server)
      .post(`/api/v1/admin/reports/${reportId}/remove`)
      .set(adminRequest(reviewer))
      .send({ reason: '   ' })
      .expect(400);
    expect(missingReason.body.code).toBe(ERROR_CODES.VALIDATION);

    const response = await request(server)
      .post(`/api/v1/admin/reports/${reportId}/remove`)
      .set(adminRequest(reviewer))
      .send({ reason: '违规下架' })
      .expect(200);
    expect(bodyData(response)).toMatchObject({
      report_id: reportId,
      moderation_status: MODERATION_STATUS.REMOVED,
    });
    const row = await prisma.report.findUniqueOrThrow({ where: { report_id: reportId } });
    expect(row.reject_reason).toBe('违规下架');
    expect(existsSync(publishedFile(reportId, key))).toBe(false);

    const pending = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.MACHINE_PENDING,
    });
    await request(server)
      .post(`/api/v1/admin/reports/${pending.report_id}/remove`)
      .set(adminRequest(reviewer))
      .send({ reason: '待审不可下架' })
      .expect(409);

    const retry = await publishImageReport(owner, spot.spot_id);
    const deleteSpy = jest
      .spyOn(storage, 'deletePublished')
      .mockRejectedValueOnce(new Error('bucket down'));
    try {
      await request(server)
        .post(`/api/v1/admin/reports/${retry.reportId}/remove`)
        .set(adminRequest(reviewer))
        .send({ reason: '删除失败重试' })
        .expect(200);
    } finally {
      deleteSpy.mockRestore();
    }
    const retryRow = await prisma.report.findUniqueOrThrow({
      where: { report_id: retry.reportId },
    });
    expect(retryRow.images).toEqual([retry.key]);
    expect(existsSync(publishedFile(retry.reportId, retry.key))).toBe(true);

    // The failed object is retried by the purge job once the appeal window passes.
    await prisma.report.update({
      where: { report_id: retry.reportId },
      data: { audit_time: new Date(Date.now() - 31 * 24 * HOUR_MS) },
    });
    const purged = await purgeUgcOrphans(prisma, storage);
    expect(purged).not.toBeNull();
    expect(existsSync(publishedFile(retry.reportId, retry.key))).toBe(false);
    const afterPurge = await prisma.report.findUniqueOrThrow({
      where: { report_id: retry.reportId },
    });
    expect(afterPurge.images).toEqual([]);

    const audit = await prisma.auditLog.findFirst({
      where: { admin_id: reviewer.admin.adminId, action: 'report.remove', entity_id: reportId },
    });
    expect(audit?.after_json).toMatchObject({
      moderation_status: MODERATION_STATUS.REMOVED,
      reason: '违规下架',
    });
  });

  it('adopts only publicly visible intel and exposes is_adopted', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const owner = await loginUser('openid-admin-adopt');
    const spot = await seedOpenSpot();
    const intel = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.PUBLISHED,
      contentType: 'intel',
      content: '今天鱼口很好，停车位充足。',
    });
    const comment = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.PUBLISHED,
      contentType: 'comment',
    });
    const pendingIntel = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.MACHINE_PENDING,
      contentType: 'intel',
    });

    await request(server)
      .post(`/api/v1/admin/reports/${comment.report_id}/adopt`)
      .set(adminRequest(reviewer))
      .expect(409);
    await request(server)
      .post(`/api/v1/admin/reports/${pendingIntel.report_id}/adopt`)
      .set(adminRequest(reviewer))
      .expect(409);

    const response = await request(server)
      .post(`/api/v1/admin/reports/${intel.report_id}/adopt`)
      .set(adminRequest(reviewer))
      .expect(200);
    const adopted = bodyData<{ adopted_at: string; adopted_by: string }>(response);
    expect(adopted.adopted_by).toBe(reviewer.admin.adminId);
    expect(Number.isNaN(new Date(adopted.adopted_at).getTime())).toBe(false);

    const row = await prisma.report.findUniqueOrThrow({ where: { report_id: intel.report_id } });
    expect(row.adopted_at).not.toBeNull();
    expect(row.adopted_by).toBe(reviewer.admin.adminId);

    const publicList = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .set(HEADERS)
      .expect(200);
    const items = publicList.body.data.items as Array<{ report_id: string; is_adopted: boolean }>;
    expect(items.find((item) => item.report_id === intel.report_id)?.is_adopted).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { admin_id: reviewer.admin.adminId, action: 'report.adopt', entity_id: intel.report_id },
    });
    expect(audit?.after_json).toMatchObject({ adopted_by: reviewer.admin.adminId });
  });

  it('lists abuse reports and handles dismiss and remove with reasons', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const owner = await loginUser('openid-admin-abuse-owner');
    const reporterOne = await loginUser('openid-admin-abuse-one');
    const reporterTwo = await loginUser('openid-admin-abuse-two');
    const reporterThree = await loginUser('openid-admin-abuse-three');
    const spot = await seedOpenSpot();
    const { reportId, key } = await publishImageReport(owner, spot.spot_id);

    const oldAbuse = await prisma.reportAbuse.create({
      data: {
        abuse_id: ulid(),
        report_id: reportId,
        user_id: reporterOne.user_id,
        reason: ABUSE_REASON.AD,
        created_at: new Date(Date.now() - 25 * HOUR_MS),
      },
    });
    const secondAbuse = await prisma.reportAbuse.create({
      data: {
        abuse_id: ulid(),
        report_id: reportId,
        user_id: reporterTwo.user_id,
        reason: ABUSE_REASON.ABUSE,
      },
    });
    const thirdAbuse = await prisma.reportAbuse.create({
      data: {
        abuse_id: ulid(),
        report_id: reportId,
        user_id: reporterThree.user_id,
        reason: ABUSE_REASON.PRIVACY,
      },
    });

    const listResponse = await request(server)
      .get('/api/v1/admin/abuse-reports')
      .query({ status: 'pending', limit: 50 })
      .set(adminRequest(reviewer))
      .expect(200);
    const list = bodyData<{ items: AdminAbuseItem[] }>(listResponse);
    const oldItem = list.items.find((item) => item.abuse_id === oldAbuse.abuse_id);
    expect(oldItem?.sla_overdue).toBe(true);
    expect(oldItem?.age_hours).toBeGreaterThanOrEqual(25);
    expect(oldItem?.report.moderation_status).toBe(MODERATION_STATUS.PUBLISHED);
    expect(oldItem?.report.spot_id).toBe(spot.spot_id);

    const byNameResponse = await request(server)
      .get('/api/v1/admin/abuse-reports')
      .query({ status: 'pending', spot_name: spot.spot_name, limit: 50 })
      .set(adminRequest(reviewer))
      .expect(200);
    const byName = bodyData<{ items: AdminAbuseItem[]; total: number }>(byNameResponse);
    expect(byName.total).toBe(3);
    expect(byName.items.every((item) => item.report.spot_id === spot.spot_id)).toBe(true);

    const overdueResponse = await request(server)
      .get('/api/v1/admin/abuse-reports')
      .query({ status: 'pending', spot_name: spot.spot_name, sla_overdue: 'true', limit: 50 })
      .set(adminRequest(reviewer))
      .expect(200);
    const overdue = bodyData<{ items: AdminAbuseItem[]; total: number }>(overdueResponse);
    expect(overdue.total).toBe(1);
    expect(overdue.items.map((item) => item.abuse_id)).toEqual([oldAbuse.abuse_id]);

    const otherSpotResponse = await request(server)
      .get('/api/v1/admin/abuse-reports')
      .query({ status: 'pending', spot_name: `${spot.spot_name}-missing`, limit: 50 })
      .set(adminRequest(reviewer))
      .expect(200);
    const otherSpot = bodyData<{ items: AdminAbuseItem[]; total: number }>(otherSpotResponse);
    expect(otherSpot.total).toBe(0);
    expect(otherSpot.items).toHaveLength(0);

    // The abuse queue detail action fetches the queue-shaped item and reuses
    // the report drawer, including its published image URLs.
    const detailResponse = await request(server)
      .get(`/api/v1/admin/reports/${reportId}`)
      .set(adminRequest(reviewer))
      .expect(200);
    const detailItem = bodyData<AdminReportItem>(detailResponse);
    expect(detailItem.report_id).toBe(reportId);
    expect(detailItem.images).toEqual([
      `${PUBLIC_UGC_PREFIX}/${reportId}/${key.split('/').pop() ?? ''}`,
    ]);
    expect(detailItem.author.user_id).toBe(owner.user_id);
    await request(server)
      .get(`/api/v1/admin/reports/${ulid()}`)
      .set(adminRequest(reviewer))
      .expect(404);

    await request(server)
      .post(`/api/v1/admin/abuse-reports/${oldAbuse.abuse_id}/handle`)
      .set(adminRequest(reviewer))
      .send({ action: 'dismiss', reason: '误报' })
      .expect(200);
    const dismissed = await prisma.reportAbuse.findUniqueOrThrow({
      where: { abuse_id: oldAbuse.abuse_id },
    });
    expect(dismissed.status).toBe('dismissed');
    expect(dismissed.handled_by).toBe(reviewer.admin.adminId);
    const stillPublished = await prisma.report.findUniqueOrThrow({
      where: { report_id: reportId },
    });
    expect(stillPublished.moderation_status).toBe(MODERATION_STATUS.PUBLISHED);

    const removeResponse = await request(server)
      .post(`/api/v1/admin/abuse-reports/${secondAbuse.abuse_id}/handle`)
      .set(adminRequest(reviewer))
      .send({ action: 'remove', reason: '确认违规' })
      .expect(200);
    expect(bodyData(removeResponse)).toMatchObject({
      abuse_id: secondAbuse.abuse_id,
      status: 'removed',
      moderation_status: MODERATION_STATUS.REMOVED,
    });
    const removedReport = await prisma.report.findUniqueOrThrow({
      where: { report_id: reportId },
    });
    expect(removedReport.moderation_status).toBe(MODERATION_STATUS.REMOVED);
    expect(removedReport.reject_reason).toBe('确认违规');
    expect(existsSync(publishedFile(reportId, key))).toBe(false);
    expect(
      await prisma.reportAbuse.count({
        where: { report_id: reportId, status: 'pending' },
      }),
    ).toBe(0);
    const thirdRow = await prisma.reportAbuse.findUniqueOrThrow({
      where: { abuse_id: thirdAbuse.abuse_id },
    });
    expect(thirdRow.status).toBe('removed');

    await request(server)
      .post(`/api/v1/admin/abuse-reports/${secondAbuse.abuse_id}/handle`)
      .set(adminRequest(reviewer))
      .send({ action: 'dismiss' })
      .expect(409);
    await request(server)
      .post(`/api/v1/admin/abuse-reports/${ulid()}/handle`)
      .set(adminRequest(reviewer))
      .send({ action: 'dismiss' })
      .expect(404);
    await request(server)
      .post(`/api/v1/admin/abuse-reports/${thirdAbuse.abuse_id}/handle`)
      .set(adminRequest(reviewer))
      .send({ action: 'delete' })
      .expect(400);

    const auditCount = await prisma.auditLog.count({
      where: { admin_id: reviewer.admin.adminId, action: 'abuse.handle' },
    });
    expect(auditCount).toBeGreaterThanOrEqual(2);
  });

  it('returns report scoped audit and abuse history to reviewers', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const owner = await loginUser('openid-admin-audit');
    const reporter = await loginUser('openid-admin-audit-target');
    const spot = await seedOpenSpot();
    const report = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.PUBLISHED,
    });
    const abuse = await prisma.reportAbuse.create({
      data: {
        abuse_id: ulid(),
        report_id: report.report_id,
        user_id: reporter.user_id,
        reason: ABUSE_REASON.AD,
      },
    });

    await request(server)
      .post(`/api/v1/admin/reports/${report.report_id}/approve`)
      .set(adminRequest(reviewer))
      .expect(200);
    await request(server)
      .post(`/api/v1/admin/reports/${report.report_id}/remove`)
      .set(adminRequest(reviewer))
      .send({ reason: '复核下架' })
      .expect(200);

    const response = await request(server)
      .get(`/api/v1/admin/reports/${report.report_id}/history`)
      .set(adminRequest(reviewer))
      .expect(200);
    const history = bodyData<AdminReportHistory>(response);
    expect(history.report_id).toBe(report.report_id);
    expect(history.audit.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['report.approve', 'report.remove']),
    );
    const approveEntry = history.audit.find((entry) => entry.action === 'report.approve');
    expect(approveEntry).toMatchObject({
      status_before: MODERATION_STATUS.PUBLISHED,
      status_after: MODERATION_STATUS.HUMAN_APPROVED,
      reason: null,
      admin_id: reviewer.admin.adminId,
    });
    const removeEntry = history.audit.find((entry) => entry.action === 'report.remove');
    expect(removeEntry).toMatchObject({
      status_before: MODERATION_STATUS.HUMAN_APPROVED,
      status_after: MODERATION_STATUS.REMOVED,
      reason: '复核下架',
      admin_id: reviewer.admin.adminId,
    });

    expect(history.abuses).toHaveLength(1);
    expect(history.abuses[0]).toMatchObject({
      abuse_id: abuse.abuse_id,
      reason: ABUSE_REASON.AD,
      status: 'pending',
      handled_at: null,
    });
    // Reporter identity must never reach the admin drawer.
    expect(Object.keys(history.abuses[0] ?? {})).not.toContain('user_id');
    const serialized = JSON.stringify(history);
    expect(serialized).not.toContain(reporter.user_id);
    expect(serialized).not.toContain(owner.user_id);
    expect(serialized).not.toContain('openid');

    await request(server)
      .get(`/api/v1/admin/reports/${ulid()}/history`)
      .set(adminRequest(reviewer))
      .expect(404);
  });

  it('restricts publishing for 1 to 30 days without blocking login', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const user = await loginUser('openid-admin-restrict');
    const spot = await seedOpenSpot();

    await request(server)
      .post(`/api/v1/admin/users/${user.user_id}/restrict`)
      .set(adminRequest(reviewer))
      .send({ days: 3, reason: '重复违规' })
      .expect(403);

    await request(server)
      .post(`/api/v1/admin/users/${user.user_id}/restrict`)
      .set(adminRequest(operator))
      .send({ days: 0, reason: '零天' })
      .expect(400);
    await request(server)
      .post(`/api/v1/admin/users/${user.user_id}/restrict`)
      .set(adminRequest(operator))
      .send({ days: 31, reason: '超长' })
      .expect(400);

    const before = Date.now();
    const restrictResponse = await request(server)
      .post(`/api/v1/admin/users/${user.user_id}/restrict`)
      .set(adminRequest(operator))
      .send({ days: 3, reason: '重复违规' })
      .expect(200);
    const restrictedUntil = new Date(
      bodyData<{ restricted_until: string }>(restrictResponse).restricted_until,
    );
    const expected = before + 3 * 24 * HOUR_MS;
    expect(Math.abs(restrictedUntil.getTime() - expected)).toBeLessThan(60 * 1000);

    const meResponse = await request(server)
      .get('/api/v1/auth/me')
      .set(appAuthHeaders(user.access_token))
      .expect(200);
    expect(meResponse.body.data).toMatchObject({
      can_publish: false,
      restricted_until: restrictedUntil.toISOString(),
    });

    const blocked = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'comment',
        content: '限制期间不应发布',
        terms_version: TERMS_VERSION,
      })
      .expect(403);
    expect(blocked.body.code).toBe(ERROR_CODES.USER_RESTRICTED);

    // Restriction never blocks login or refresh.
    const relogin = await loginUser('openid-admin-restrict');
    expect(relogin.user_id).toBe(user.user_id);

    await request(server)
      .post(`/api/v1/admin/users/${ulid()}/restrict`)
      .set(adminRequest(operator))
      .send({ days: 3, reason: '不存在' })
      .expect(404);

    const unrestrictResponse = await request(server)
      .delete(`/api/v1/admin/users/${user.user_id}/restrict`)
      .set(adminRequest(operator))
      .expect(200);
    expect(bodyData(unrestrictResponse)).toMatchObject({ restricted_until: null });
    const row = await prisma.appUser.findUniqueOrThrow({ where: { user_id: user.user_id } });
    expect(row.restricted_until).toBeNull();

    await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(relogin.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'comment',
        content: '限制解除后可以发布',
        terms_version: TERMS_VERSION,
      })
      .expect(201);

    expect(
      await prisma.auditLog.count({
        where: { admin_id: operator.admin.adminId, action: 'user.restrict' },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { admin_id: operator.admin.adminId, action: 'user.unrestrict' },
      }),
    ).toBe(1);
  });

  it('bans a user: revokes sessions, hides visible content and deletes images', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const owner = await loginUser('openid-admin-ban');
    const spot = await seedOpenSpot();
    const initial = await prisma.appUser.findUniqueOrThrow({
      where: { user_id: owner.user_id },
    });
    const publishedComment = await createReport(owner, spot.spot_id);
    expect(publishedComment.moderation_status).toBe(MODERATION_STATUS.PUBLISHED);
    const imageReport = await publishImageReport(owner, spot.spot_id);
    const pending = await createReport(owner, spot.spot_id, { content: 'REVIEW 待审内容' });
    expect(pending.moderation_status).toBe(MODERATION_STATUS.MACHINE_PENDING);

    await request(server)
      .post(`/api/v1/admin/users/${owner.user_id}/ban`)
      .set(adminRequest(reviewer))
      .send({ reason: '严重违规' })
      .expect(403);

    const banResponse = await request(server)
      .post(`/api/v1/admin/users/${owner.user_id}/ban`)
      .set(adminRequest(operator))
      .send({ reason: '严重违规' })
      .expect(200);
    expect(bodyData(banResponse)).toMatchObject({
      user_id: owner.user_id,
      status: 'banned',
    });

    const banned = await prisma.appUser.findUniqueOrThrow({
      where: { user_id: owner.user_id },
    });
    expect(banned.status).toBe('banned');
    expect(banned.restricted_until).toBeNull();
    expect(banned.token_version).toBe(initial.token_version + 1);
    expect(
      await prisma.userSession.count({
        where: { user_id: owner.user_id, revoked_at: null },
      }),
    ).toBe(0);

    expect(
      await prisma.report.count({
        where: {
          user_id: owner.user_id,
          moderation_status: {
            in: [MODERATION_STATUS.PUBLISHED, MODERATION_STATUS.HUMAN_APPROVED],
          },
        },
      }),
    ).toBe(0);
    const bannedReports = await prisma.report.findMany({
      where: { user_id: owner.user_id, moderation_status: MODERATION_STATUS.REMOVED },
      select: { report_id: true, reject_reason: true },
    });
    expect(new Set(bannedReports.map((row) => row.report_id))).toEqual(
      new Set([publishedComment.report_id, imageReport.reportId, pending.report_id]),
    );
    expect(bannedReports.every((row) => row.reject_reason === 'user_banned')).toBe(true);
    // Machine-pending reports are taken down too: their media checks could
    // still pass after the ban and publish the content.
    const pendingRow = await prisma.report.findUniqueOrThrow({
      where: { report_id: pending.report_id },
    });
    expect(pendingRow.moderation_status).toBe(MODERATION_STATUS.REMOVED);
    expect(pendingRow.reject_reason).toBe('user_banned');
    expect(existsSync(publishedFile(imageReport.reportId, imageReport.key))).toBe(false);

    await request(server)
      .get('/api/v1/auth/me')
      .set(appAuthHeaders(owner.access_token))
      .expect(401);
    await request(server)
      .post('/api/v1/auth/refresh')
      .set(appClientHeaders())
      .send({ refresh_token: owner.refresh_token })
      .expect(403);
    await request(server)
      .post('/api/v1/auth/wechat/login')
      .set(appClientHeaders())
      .send({ code: 'openid-admin-ban' })
      .expect(403);

    await request(server)
      .post(`/api/v1/admin/users/${owner.user_id}/unban`)
      .set(adminRequest(reviewer))
      .expect(403);
    const unbanResponse = await request(server)
      .post(`/api/v1/admin/users/${owner.user_id}/unban`)
      .set(adminRequest(operator))
      .expect(200);
    expect(bodyData(unbanResponse)).toMatchObject({ status: 'active' });

    const unbanned = await prisma.appUser.findUniqueOrThrow({
      where: { user_id: owner.user_id },
    });
    expect(unbanned.status).toBe('active');
    expect(unbanned.token_version).toBe(initial.token_version + 2);
    // Unban does not restore removed content.
    const stillRemoved = await prisma.report.findMany({
      where: { user_id: owner.user_id, moderation_status: MODERATION_STATUS.REMOVED },
      select: { report_id: true },
    });
    expect(stillRemoved).toHaveLength(3);
    expect(existsSync(publishedFile(imageReport.reportId, imageReport.key))).toBe(false);

    const banAudit = await prisma.auditLog.findFirst({
      where: {
        admin_id: operator.admin.adminId,
        action: 'user.ban',
        entity_id: owner.user_id,
      },
    });
    expect(banAudit?.before_json).toMatchObject({ status: 'active' });
    expect(banAudit?.after_json).toMatchObject({ status: 'banned', reason: '严重违规' });
    expect(
      await prisma.auditLog.count({
        where: {
          admin_id: operator.admin.adminId,
          action: 'user.unban',
          entity_id: owner.user_id,
        },
      }),
    ).toBe(1);
  });

  it('does not publish a create that overlaps a ban', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const owner = await loginUser('openid-admin-ban-create');
    const spot = await seedOpenSpot();
    const provider = app.get(CONTENT_SECURITY_PROVIDER) as FakeContentSecurityProvider;

    let markCheckStarted: () => void = () => undefined;
    let releaseCheck: () => void = () => undefined;
    const checkStarted = new Promise<void>((resolve) => {
      markCheckStarted = resolve;
    });
    const checkGate = new Promise<void>((resolve) => {
      releaseCheck = resolve;
    });
    const originalCheck = provider.checkText.bind(provider);
    const checkSpy = jest.spyOn(provider, 'checkText').mockImplementation(async (input) => {
      markCheckStarted();
      await checkGate;
      return originalCheck(input);
    });

    try {
      // The report row exists (machine_pending) and the create request is paused
      // in the text check when the ban transaction commits.
      const createPromise = request(server)
        .post('/api/v1/reports')
        .set(appAuthHeaders(owner.access_token))
        .send({
          spot_id: spot.spot_id,
          content_type: 'comment',
          content: `并发封禁 ${ulid().slice(-6)}`,
          terms_version: TERMS_VERSION,
        })
        .then((response) => response);
      await checkStarted;

      await request(server)
        .post(`/api/v1/admin/users/${owner.user_id}/ban`)
        .set(adminRequest(operator))
        .send({ reason: '并发封禁' })
        .expect(200);

      releaseCheck();
      const response = await createPromise;
      expect(response.status).toBe(201);
      expect(bodyData<CreatedReport>(response).moderation_status).toBe(
        MODERATION_STATUS.REMOVED,
      );

      const row = await prisma.report.findFirstOrThrow({
        where: { user_id: owner.user_id },
        orderBy: { created_at: 'desc' },
      });
      expect(row.moderation_status).toBe(MODERATION_STATUS.REMOVED);
      expect(row.reject_reason).toBe('user_banned');

      const publicList = await request(server)
        .get(`/api/v1/spots/${spot.spot_id}/reports`)
        .set(HEADERS)
        .expect(200);
      expect(publicList.body.data.items).toHaveLength(0);
    } finally {
      releaseCheck();
      checkSpy.mockRestore();
    }
  });

  it('serializes author delete and admin approve without orphan images', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const owner = await loginUser('openid-admin-race-delete');
    const spot = await seedOpenSpot();
    const image = await uploadImage(owner);
    const report = await createReport(owner, spot.spot_id, { image_keys: [image.key] });
    expect(report.moderation_status).toBe(MODERATION_STATUS.MACHINE_PENDING);

    let markCopied: () => void = () => undefined;
    let releaseCopy: () => void = () => undefined;
    const copyDone = new Promise<void>((resolve) => {
      markCopied = resolve;
    });
    const copyGate = new Promise<void>((resolve) => {
      releaseCopy = resolve;
    });
    const originalCopy = storage.copyToPublished.bind(storage);
    const copySpy = jest
      .spyOn(storage, 'copyToPublished')
      .mockImplementation(async (source, dest) => {
        await originalCopy(source, dest);
        markCopied();
        await copyGate;
      });

    try {
      const approvePromise = request(server)
        .post(`/api/v1/admin/reports/${report.report_id}/approve`)
        .set(adminRequest(reviewer))
        .then((response) => response);
      await copyDone;

      // The author deletes while the admin approval has copied the image but
      // has not yet committed the status change.
      await request(server)
        .delete(`/api/v1/reports/${report.report_id}`)
        .set(appAuthHeaders(owner.access_token))
        .expect(200);

      releaseCopy();
      const approveResponse = await approvePromise;
      expect(approveResponse.status).toBe(404);
    } finally {
      releaseCopy();
      copySpy.mockRestore();
    }

    const row = await prisma.report.findUniqueOrThrow({
      where: { report_id: report.report_id },
    });
    expect(row.moderation_status).toBe(MODERATION_STATUS.REMOVED);
    expect(row.reject_reason).toBe('author_deleted');
    expect(row.deleted_at).not.toBeNull();
    expect(existsSync(publishedFile(report.report_id, image.key))).toBe(false);
    expect(existsSync(workingFile(image.key))).toBe(false);
  });

  it('writes audit logs for every action without content, image or token fields', async () => {
    const superAdmin = await loginAsSuperAdmin(app);
    const owner = await loginUser('openid-admin-audit');
    const target = await loginUser('openid-admin-audit-target');
    const spot = await seedOpenSpot();
    const secretContent = `机密内容-${ulid()}`;

    const toApprove = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.MACHINE_PENDING,
      content: secretContent,
    });
    const toReject = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.PUBLISHED,
      content: secretContent,
    });
    const toRemove = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.HUMAN_APPROVED,
      content: secretContent,
    });
    const toAdopt = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.PUBLISHED,
      contentType: 'intel',
      content: secretContent,
    });
    const abused = await seedReport({
      userId: owner.user_id,
      spotId: spot.spot_id,
      status: MODERATION_STATUS.PUBLISHED,
      content: secretContent,
    });
    await prisma.reportAbuse.create({
      data: {
        abuse_id: ulid(),
        report_id: abused.report_id,
        user_id: target.user_id,
        reason: ABUSE_REASON.OTHER,
      },
    });

    await request(server)
      .post(`/api/v1/admin/reports/${toApprove.report_id}/approve`)
      .set(adminRequest(superAdmin))
      .expect(200);
    await request(server)
      .post(`/api/v1/admin/reports/${toReject.report_id}/reject`)
      .set(adminRequest(superAdmin))
      .send({ reason: '审核驳回' })
      .expect(200);
    await request(server)
      .post(`/api/v1/admin/reports/${toRemove.report_id}/remove`)
      .set(adminRequest(superAdmin))
      .send({ reason: '审核下架' })
      .expect(200);
    await request(server)
      .post(`/api/v1/admin/reports/${toAdopt.report_id}/adopt`)
      .set(adminRequest(superAdmin))
      .expect(200);
    const abuseRow = await prisma.reportAbuse.findFirstOrThrow({
      where: { report_id: abused.report_id },
    });
    await request(server)
      .post(`/api/v1/admin/abuse-reports/${abuseRow.abuse_id}/handle`)
      .set(adminRequest(superAdmin))
      .send({ action: 'dismiss', reason: '审核误报' })
      .expect(200);
    await request(server)
      .post(`/api/v1/admin/users/${target.user_id}/restrict`)
      .set(adminRequest(superAdmin))
      .send({ days: 2, reason: '审核限制' })
      .expect(200);
    await request(server)
      .delete(`/api/v1/admin/users/${target.user_id}/restrict`)
      .set(adminRequest(superAdmin))
      .expect(200);
    await request(server)
      .post(`/api/v1/admin/users/${target.user_id}/ban`)
      .set(adminRequest(superAdmin))
      .send({ reason: '审核封禁' })
      .expect(200);
    await request(server)
      .post(`/api/v1/admin/users/${target.user_id}/unban`)
      .set(adminRequest(superAdmin))
      .expect(200);

    const moderationActions = [
      'report.approve',
      'report.reject',
      'report.remove',
      'report.adopt',
      'abuse.handle',
      'user.restrict',
      'user.unrestrict',
      'user.ban',
      'user.unban',
    ];
    const logs = await prisma.auditLog.findMany({
      where: { admin_id: superAdmin.admin.adminId, action: { in: moderationActions } },
    });
    // Every action wrote exactly one audit row with a non-empty before/after.
    expect(new Set(logs.map((log) => log.action))).toEqual(new Set(moderationActions));
    expect(logs).toHaveLength(moderationActions.length);

    const forbiddenKey = /(content|image|openid|token|secret|cookie|authorization|refresh)/i;
    for (const log of logs) {
      expect(log.before_json).not.toBeNull();
      expect(log.after_json).not.toBeNull();
      expect(collectKeys(log.before_json).filter((key) => forbiddenKey.test(key))).toEqual([]);
      expect(collectKeys(log.after_json).filter((key) => forbiddenKey.test(key))).toEqual([]);
      const serialized = JSON.stringify([log.before_json, log.after_json]);
      expect(serialized).not.toContain(secretContent);
      expect(serialized).not.toContain('openid-admin-audit');
    }
  });

  it('leaves no published image when approve and reject race on a pending image report', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const owner = await loginUser('openid-admin-race-reject');
    const spot = await seedOpenSpot();
    const image = await uploadImage(owner);
    const report = await createReport(owner, spot.spot_id, { image_keys: [image.key] });
    expect(report.moderation_status).toBe(MODERATION_STATUS.MACHINE_PENDING);

    let markCopyStarted: () => void = () => undefined;
    let releaseCopy: () => void = () => undefined;
    const copyStarted = new Promise<void>((resolve) => {
      markCopyStarted = resolve;
    });
    const copyGate = new Promise<void>((resolve) => {
      releaseCopy = resolve;
    });
    const originalCopy = storage.copyToPublished.bind(storage);
    const copySpy = jest.spyOn(storage, 'copyToPublished').mockImplementation(async (source, dest) => {
      markCopyStarted();
      await copyGate;
      await originalCopy(source, dest);
    });

    try {
      // `.then(...)` dispatches the supertest thenable immediately; awaiting the
      // raw Test later would never send the request that waits on the copy gate.
      const approvePromise = request(server)
        .post(`/api/v1/admin/reports/${report.report_id}/approve`)
        .set(adminRequest(reviewer))
        .then((response) => response);
      await copyStarted;

      await request(server)
        .post(`/api/v1/admin/reports/${report.report_id}/reject`)
        .set(adminRequest(reviewer))
        .send({ reason: '并发驳回' })
        .expect(200);

      releaseCopy();
      const approveResponse = await approvePromise;
      expect(approveResponse.status).toBe(409);
    } finally {
      releaseCopy();
      copySpy.mockRestore();
    }

    const row = await prisma.report.findUniqueOrThrow({
      where: { report_id: report.report_id },
    });
    expect(row.moderation_status).toBe(MODERATION_STATUS.HUMAN_REJECTED);
    expect(existsSync(publishedFile(report.report_id, image.key))).toBe(false);
  });

  it('leaves no published image when approve and remove race on a published report', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const owner = await loginUser('openid-admin-race-remove');
    const spot = await seedOpenSpot();
    const { reportId, key } = await publishImageReport(owner, spot.spot_id);

    const [approveResponse, removeResponse] = await Promise.all([
      request(server)
        .post(`/api/v1/admin/reports/${reportId}/approve`)
        .set(adminRequest(reviewer)),
      request(server)
        .post(`/api/v1/admin/reports/${reportId}/remove`)
        .set(adminRequest(reviewer))
        .send({ reason: '并发下架' }),
    ]);
    expect([200, 409]).toContain(approveResponse.status);
    expect(removeResponse.status).toBe(200);

    const row = await prisma.report.findUniqueOrThrow({ where: { report_id: reportId } });
    expect(row.moderation_status).toBe(MODERATION_STATUS.REMOVED);
    expect(existsSync(publishedFile(reportId, key))).toBe(false);
  });

  it('rejects anonymous and CSRF-less admin writes', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const reportId = ulid();
    await request(server)
      .post(`/api/v1/admin/reports/${reportId}/approve`)
      .set(clientHeaders())
      .expect(401);
    await request(server)
      .post(`/api/v1/admin/reports/${reportId}/approve`)
      .set(clientHeaders())
      .set('Cookie', reviewer.cookie)
      .expect(403);
  });
});
