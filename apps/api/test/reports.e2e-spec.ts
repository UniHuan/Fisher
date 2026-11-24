import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_CODES } from '@szfisher/shared';
import request from 'supertest';
import { ulid } from 'ulid';
import { WECHAT_AUTH_PROVIDER } from '../src/modules/app-auth/wechat-auth.provider';
import { CONTENT_SECURITY_PROVIDER } from '../src/modules/content-security/content-security.types';
import { RateLimitService } from '../src/modules/rate-limit/rate-limit.service';
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

jest.setTimeout(60000);

const TERMS_VERSION = '2026-11-20';
const HEADERS = appClientHeaders();
const TEST_OPENIDS = [
  'openid-report',
  'openid-review',
  'openid-invalid',
  'openid-mine',
  'openid-banned-spot',
  'openid-flag',
  'openid-cursor',
  'openid-filter',
  'openid-optional',
  'openid-like',
  'openid-limit-normal',
  'openid-limit-new',
  'openid-shape',
  'openid-error',
  'openid-page-order',
  'openid-condition',
  'openid-condition-empty',
  'openid-condition-time',
  'openid-condition-images',
  'openid-condition-other',
  'openid-condition-text',
] as const;

describe('Reports (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let contentSecurity: FakeContentSecurityProvider;

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
      spot_name: `情报测试-${ulid().slice(-6)}`,
      status: 'published',
      open_status: 'open',
      ...overrides,
    });
  }

  async function createReport(
    session: AppSession,
    spotId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const response = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(session.access_token))
      .send({
        spot_id: spotId,
        content_type: 'comment',
        content: `测试内容 ${ulid().slice(-6)}`,
        terms_version: TERMS_VERSION,
        ...overrides,
      })
      .expect(201);
    return response.body.data as Record<string, unknown>;
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
    contentSecurity = app.get(CONTENT_SECURITY_PROVIDER);
    // Clear rows a previously interrupted run may have left behind.
    await cleanupAppAuthTestData([...TEST_OPENIDS]);
    // The seed keeps features.ugc=false; normal report cases need it on.
    await setUgcFeature(true);
  });

  beforeEach(async () => {
    await resetAppLoginRateLimiter(app);
    await app.get(RateLimitService).reset('report:');
  });

  afterEach(async () => {
    await setUgcFeature(true);
  });

  afterAll(async () => {
    await app.get(RateLimitService).reset('report:');
    await resetAppLoginRateLimiter(app);
    await cleanupAppAuthTestData([...TEST_OPENIDS]);
    await cleanupAdminSpotTestData();
    await setUgcFeature(false);
    await app.close();
  });

  it('publishes a text-only comment and hides it from anonymous-only filters', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-report');
    const response = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'comment',
        content: '今天鱼口不错',
        terms_version: TERMS_VERSION,
      })
      .expect(201);

    expect(response.body.data).toMatchObject({
      moderation_status: 'published',
      message: '已发布',
    });
    expect(response.body.data.report_id).toEqual(expect.any(String));
    expect(JSON.stringify(response.body)).not.toContain('openid-report');

    const list = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .set(HEADERS)
      .expect(200);
    expect(list.body.data.total).toBe(1);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0]).toMatchObject({
      content: '今天鱼口不错',
      content_type: 'comment',
      images: [],
      fish_key: null,
      catch_weight_kg: null,
      liked_by_me: false,
      is_mine: false,
      is_adopted: false,
      author: { nickname: expect.stringMatching(/^钓友 /), avatar_url: null },
    });
    expect(list.body.data.items[0]).not.toHaveProperty('user_id');
    expect(JSON.stringify(list.body)).not.toContain('openid-report');
    expect(JSON.stringify(list.body)).not.toContain(user.user_id);

    const personalized = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .set(appAuthHeaders(user.access_token))
      .expect(200);
    expect(personalized.body.data.items[0]).toMatchObject({
      liked_by_me: false,
      is_mine: true,
    });

    const dbUser = await prisma.appUser.findUniqueOrThrow({
      where: { user_id: user.user_id },
    });
    expect(dbUser.terms_version).toBe(TERMS_VERSION);
    expect(dbUser.terms_accepted_at).not.toBeNull();
    const dbReport = await prisma.report.findUniqueOrThrow({
      where: { report_id: response.body.data.report_id },
    });
    expect(dbReport.machine_result).toMatchObject({ suggest: 'pass' });
  });

  it('routes review and risky text without public exposure', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-review');

    const review = await createReport(user, spot.spot_id, {
      content: 'REVIEW 这条要人工',
    });
    expect(review.moderation_status).toBe('machine_pending');
    const pendingRow = await prisma.report.findUniqueOrThrow({
      where: { report_id: review.report_id as string },
    });
    expect(pendingRow.machine_result).toMatchObject({ suggest: 'review' });
    // machine_result stores only the conclusion, never content or openid.
    expect(JSON.stringify(pendingRow.machine_result)).not.toContain('REVIEW');
    expect(JSON.stringify(pendingRow.machine_result)).not.toContain('openid-review');

    const risky = await createReport(user, spot.spot_id, {
      content: 'RISKY 这条拒绝',
    });
    expect(risky.moderation_status).toBe('machine_rejected');
    const rejectedRow = await prisma.report.findUniqueOrThrow({
      where: { report_id: risky.report_id as string },
    });
    expect(rejectedRow.machine_result).toMatchObject({ suggest: 'risky' });

    const list = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .set(HEADERS)
      .expect(200);
    expect(list.body.data.items).toHaveLength(0);
    expect(list.body.data.total).toBe(0);
  });

  it('keeps a report pending and records the moderation error code when the provider fails', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-error');
    const created = await createReport(user, spot.spot_id, {
      content: 'THROW 审核服务异常',
    });
    expect(created.moderation_status).toBe('machine_pending');
    expect(created.message).toBe('内容审核中');

    const row = await prisma.report.findUniqueOrThrow({
      where: { report_id: created.report_id as string },
    });
    expect(row.machine_result).toMatchObject({
      suggest: 'review',
      error_code: 'provider-error',
    });
    // Only the conclusion and safe error code are stored, never the content.
    expect(JSON.stringify(row.machine_result)).not.toContain('THROW');

    const list = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .set(HEADERS)
      .expect(200);
    expect(list.body.data.items).toHaveLength(0);
  });

  it('rejects missing terms, restricted users and invalid catch fields', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-invalid');

    const wrongTerms = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'comment',
        content: 'x',
        terms_version: 'wrong',
      })
      .expect(400);
    expect(wrongTerms.body.code).toBe(ERROR_CODES.VALIDATION);

    const catchWithoutFish = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'catch',
        content: '鱼',
        terms_version: TERMS_VERSION,
      })
      .expect(400);
    expect(catchWithoutFish.body.code).toBe(ERROR_CODES.VALIDATION);

    await prisma.appUser.update({
      where: { user_id: user.user_id },
      data: { restricted_until: new Date(Date.now() + 86_400_000) },
    });
    // Restriction outranks the terms check, so even a body without terms is 403.
    const restricted = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({ spot_id: spot.spot_id, content_type: 'comment', content: 'x' })
      .expect(403);
    expect(restricted.body.code).toBe(ERROR_CODES.USER_RESTRICTED);
  });

  it('keeps pending and rejected content out of public lists while authors see it in mine', async () => {
    const openSpot = await seedOpenSpot();
    const bannedSpot = await seedSpot({
      spot_name: `禁钓情报测试-${ulid().slice(-6)}`,
      status: 'published',
      open_status: 'banned',
    });
    const user = await loginAppUser(server, 'openid-mine');

    const pending = await createReport(user, openSpot.spot_id, {
      content: 'REVIEW 等待人工',
    });
    const rejected = await createReport(user, openSpot.spot_id, {
      content: 'RISKY 机器拒绝',
    });
    const published = await createReport(user, openSpot.spot_id, {
      content: '正常内容',
    });

    const now = new Date();
    const humanRejected = await prisma.report.create({
      data: {
        report_id: ulid(),
        spot_id: openSpot.spot_id,
        user_id: user.user_id,
        content_type: 'comment',
        content: '人工驳回内容',
        moderation_status: 'human_rejected',
        reject_reason: '广告引流',
        audit_time: now,
      },
    });
    const removed = await prisma.report.create({
      data: {
        report_id: ulid(),
        spot_id: openSpot.spot_id,
        user_id: user.user_id,
        content_type: 'comment',
        content: '运营下架内容',
        moderation_status: 'removed',
        reject_reason: '违规',
        audit_time: now,
      },
    });
    const authorDeleted = await prisma.report.create({
      data: {
        report_id: ulid(),
        spot_id: openSpot.spot_id,
        user_id: user.user_id,
        content_type: 'comment',
        content: '作者删除',
        moderation_status: 'removed',
        reject_reason: 'author_deleted',
        deleted_at: now,
      },
    });
    const bannedSpotReport = await prisma.report.create({
      data: {
        report_id: ulid(),
        spot_id: bannedSpot.spot_id,
        user_id: user.user_id,
        content_type: 'comment',
        content: '禁钓点的历史内容',
        moderation_status: 'published',
      },
    });

    const publicList = await request(server)
      .get(`/api/v1/spots/${openSpot.spot_id}/reports`)
      .set(HEADERS)
      .expect(200);
    const publicIds = (publicList.body.data.items as Array<{ report_id: string }>).map(
      (item) => item.report_id,
    );
    expect(publicIds).toEqual([published.report_id]);
    expect(publicIds).not.toContain(pending.report_id);
    expect(publicIds).not.toContain(rejected.report_id);
    expect(publicIds).not.toContain(humanRejected.report_id);
    expect(publicIds).not.toContain(removed.report_id);
    expect(publicIds).not.toContain(bannedSpotReport.report_id);

    const mine = await request(server)
      .get('/api/v1/reports/mine')
      .set(appAuthHeaders(user.access_token))
      .expect(200);
    const mineIds = (mine.body.data.items as Array<{ report_id: string }>).map(
      (item) => item.report_id,
    );
    expect(mine.body.data.total).toBe(6);
    expect(mineIds).toEqual(
      expect.arrayContaining([
        pending.report_id,
        rejected.report_id,
        published.report_id,
        humanRejected.report_id,
        removed.report_id,
        bannedSpotReport.report_id,
      ]),
    );
    expect(mineIds).not.toContain(authorDeleted.report_id);

    const first = mine.body.data.items.find(
      (item: { report_id: string }) => item.report_id === pending.report_id,
    );
    expect(first).toMatchObject({
      content_type: 'comment',
      content: 'REVIEW 等待人工',
      moderation_status: 'machine_pending',
      reject_reason: null,
      images: [],
      spot: {
        spot_id: openSpot.spot_id,
        spot_name: openSpot.spot_name,
        open_status: 'open',
        can_open: true,
      },
    });
    expect(typeof first.created_at).toBe('string');

    const bannedItem = mine.body.data.items.find(
      (item: { report_id: string }) => item.report_id === bannedSpotReport.report_id,
    );
    expect(bannedItem).toMatchObject({
      moderation_status: 'published',
      spot: { can_open: false, open_status: 'banned' },
    });

    const humanItem = mine.body.data.items.find(
      (item: { report_id: string }) => item.report_id === humanRejected.report_id,
    );
    expect(humanItem).toMatchObject({
      moderation_status: 'human_rejected',
      reject_reason: '广告引流',
    });
    expect(typeof humanItem.audit_time).toBe('string');

    const expectations: Array<[string, number]> = [
      ['all', 6],
      ['pending', 1],
      ['published', 2],
      ['rejected', 2],
      ['removed', 1],
    ];
    for (const [status, total] of expectations) {
      const filtered = await request(server)
        .get('/api/v1/reports/mine')
        .query({ status })
        .set(appAuthHeaders(user.access_token))
        .expect(200);
      expect(filtered.body.data.total).toBe(total);
    }

    const invalidStatus = await request(server)
      .get('/api/v1/reports/mine')
      .query({ status: 'unknown' })
      .set(appAuthHeaders(user.access_token))
      .expect(400);
    expect(invalidStatus.body.code).toBe(ERROR_CODES.VALIDATION);
  });

  it('rejects create on a banned spot and returns an empty public list', async () => {
    const bannedSpot = await seedSpot({
      spot_name: `禁钓发布测试-${ulid().slice(-6)}`,
      status: 'published',
      open_status: 'banned',
    });
    const draftSpot = await seedSpot({
      spot_name: `草稿钓点-${ulid().slice(-6)}`,
      status: 'draft',
      open_status: 'open',
    });
    const user = await loginAppUser(server, 'openid-banned-spot');

    const banned = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: bannedSpot.spot_id,
        content_type: 'comment',
        content: '禁钓点不能发',
        terms_version: TERMS_VERSION,
      })
      .expect(403);
    expect(banned.body.code).toBe(ERROR_CODES.SPOT_NOT_OPEN_FOR_UGC);

    const bannedList = await request(server)
      .get(`/api/v1/spots/${bannedSpot.spot_id}/reports`)
      .set(HEADERS)
      .expect(200);
    expect(bannedList.body.data).toEqual({ items: [], next_cursor: null, total: 0 });

    const draft = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: draftSpot.spot_id,
        content_type: 'comment',
        content: '草稿点不能发',
        terms_version: TERMS_VERSION,
      })
      .expect(404);
    expect(draft.body.code).toBe(ERROR_CODES.NOT_FOUND);

    const draftList = await request(server)
      .get(`/api/v1/spots/${draftSpot.spot_id}/reports`)
      .set(HEADERS)
      .expect(200);
    expect(draftList.body.data).toEqual({ items: [], next_cursor: null, total: 0 });
  });

  it('hides reports behind the ugc feature flag', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-flag');
    await setUgcFeature(false);
    try {
      const create = await request(server)
        .post('/api/v1/reports')
        .set(appAuthHeaders(user.access_token))
        .send({
          spot_id: spot.spot_id,
          content_type: 'comment',
          content: '开关关闭',
          terms_version: TERMS_VERSION,
        })
        .expect(403);
      expect(create.body.code).toBe(ERROR_CODES.FEATURE_DISABLED);

      const list = await request(server)
        .get(`/api/v1/spots/${spot.spot_id}/reports`)
        .set(HEADERS)
        .expect(200);
      expect(list.body.data).toEqual({ items: [], next_cursor: null, total: 0 });
    } finally {
      await setUgcFeature(true);
    }
  });

  it('pages the public list with the base64 cursor and keeps the total stable', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-cursor');
    const reportIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const created = await createReport(user, spot.spot_id, {
        content: `游标内容 ${index}`,
      });
      reportIds.push(created.report_id as string);
    }
    // The service writes created_at explicitly from a JS Date, so every row is
    // millisecond-exact and the cursor can use exact timestamp equality.
    const exactness = await prisma.$queryRaw<Array<{ report_id: string; ms_exact: boolean }>>`
      SELECT report_id,
             date_trunc('milliseconds', created_at) = created_at AS ms_exact
      FROM report
      WHERE report_id IN (${Prisma.join(reportIds)})
    `;
    expect(exactness).toHaveLength(3);
    expect(exactness.every((row) => row.ms_exact)).toBe(true);

    const firstPage = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .query({ limit: 2 })
      .set(HEADERS)
      .expect(200);
    expect(firstPage.body.data.items).toHaveLength(2);
    expect(firstPage.body.data.total).toBe(3);
    const cursor = firstPage.body.data.next_cursor as string;
    expect(cursor).toEqual(expect.any(String));
    const lastItem = firstPage.body.data.items[1] as {
      report_id: string;
      created_at: string;
    };
    expect(Buffer.from(cursor, 'base64').toString('utf8')).toBe(
      `${lastItem.created_at}|${lastItem.report_id}`,
    );

    const secondPage = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .query({ limit: 2, cursor })
      .set(HEADERS)
      .expect(200);
    expect(secondPage.body.data.items).toHaveLength(1);
    expect(secondPage.body.data.total).toBe(3);
    expect(secondPage.body.data.next_cursor).toBeNull();

    const seen = [
      ...(firstPage.body.data.items as Array<{ report_id: string }>),
      ...(secondPage.body.data.items as Array<{ report_id: string }>),
    ]
      .map((item) => item.report_id)
      .sort();
    expect(seen).toEqual([...reportIds].sort());

    const invalidCursor = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .query({ cursor: 'not-a-cursor' })
      .set(HEADERS)
      .expect(400);
    expect(invalidCursor.body.code).toBe(ERROR_CODES.VALIDATION);

    const oversizedLimit = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .query({ limit: 21 })
      .set(HEADERS)
      .expect(400);
    expect(oversizedLimit.body.code).toBe(ERROR_CODES.VALIDATION);
  });

  it('pages same-millisecond rows in descending report_id order', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-page-order');
    const ids: [string, string, string] = [ulid(), ulid(), ulid()];
    ids.sort();
    const [low, mid, high] = ids;
    const shared = new Date('2026-11-20T00:00:00.123Z');
    // Insert in ascending ULID order, which is the reverse of the DESC page order.
    await prisma.report.createMany({
      data: [low, mid, high].map((reportId) => ({
        report_id: reportId,
        spot_id: spot.spot_id,
        user_id: user.user_id,
        content_type: 'comment',
        content: '同一毫秒',
        moderation_status: 'published',
        created_at: shared,
      })),
    });

    const firstPage = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .query({ limit: 2 })
      .set(HEADERS)
      .expect(200);
    expect(firstPage.body.data.total).toBe(3);
    expect(
      (firstPage.body.data.items as Array<{ report_id: string }>).map(
        (item) => item.report_id,
      ),
    ).toEqual([high, mid]);
    const cursor = firstPage.body.data.next_cursor as string;
    expect(cursor).toEqual(expect.any(String));

    const secondPage = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .query({ limit: 2, cursor })
      .set(HEADERS)
      .expect(200);
    expect(
      (secondPage.body.data.items as Array<{ report_id: string }>).map(
        (item) => item.report_id,
      ),
    ).toEqual([low]);
    expect(secondPage.body.data.next_cursor).toBeNull();
  });

  it('filters the public list by content type', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-filter');
    await createReport(user, spot.spot_id, { content: '一条评论' });
    await createReport(user, spot.spot_id, {
      content_type: 'catch',
      content: '一条鱼获',
      fish_key: 'luofei',
      catch_weight_kg: 2.5,
    });
    await createReport(user, spot.spot_id, {
      content_type: 'intel',
      content: '一条情报',
    });

    const all = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .set(HEADERS)
      .expect(200);
    expect(all.body.data.total).toBe(3);

    const catches = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .query({ content_type: 'catch' })
      .set(HEADERS)
      .expect(200);
    expect(catches.body.data.total).toBe(1);
    expect(catches.body.data.items[0]).toMatchObject({
      content_type: 'catch',
      fish_key: 'luofei',
      catch_weight_kg: '2.50',
    });

    const intel = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .query({ content_type: 'intel' })
      .set(HEADERS)
      .expect(200);
    expect(intel.body.data.total).toBe(1);
    expect(intel.body.data.items[0]).toMatchObject({ content_type: 'intel' });

    const invalid = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .query({ content_type: 'video' })
      .set(HEADERS)
      .expect(400);
    expect(invalid.body.code).toBe(ERROR_CODES.VALIDATION);
  });

  it('derives liked_by_me and is_mine from the optional bearer token', async () => {
    const spot = await seedOpenSpot();
    const owner = await loginAppUser(server, 'openid-optional');
    const viewer = await loginAppUser(server, 'openid-like');
    const report = await createReport(owner, spot.spot_id, {
      content: '可选鉴权内容',
    });
    await prisma.reportLike.create({
      data: { report_id: report.report_id as string, user_id: viewer.user_id },
    });

    const anonymous = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .set(HEADERS)
      .expect(200);
    expect(anonymous.body.data.items[0]).toMatchObject({
      liked_by_me: false,
      is_mine: false,
    });

    const ownerView = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .set(appAuthHeaders(owner.access_token))
      .expect(200);
    expect(ownerView.body.data.items[0]).toMatchObject({
      liked_by_me: false,
      is_mine: true,
    });

    const viewerView = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .set(appAuthHeaders(viewer.access_token))
      .expect(200);
    expect(viewerView.body.data.items[0]).toMatchObject({
      liked_by_me: true,
      is_mine: false,
    });

    // Invalid bearer tokens degrade to anonymous instead of failing the read.
    const degraded = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .set(appAuthHeaders('not-a-real-token'))
      .expect(200);
    expect(degraded.body.data.items[0]).toMatchObject({
      liked_by_me: false,
      is_mine: false,
    });
  });

  it('enforces the daily posting limit for established users', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-limit-normal');
    await prisma.appUser.update({
      where: { user_id: user.user_id },
      data: { created_at: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    });

    for (let index = 0; index < 10; index += 1) {
      await createReport(user, spot.spot_id, { content: `每日限额 ${index}` });
    }
    const blocked = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'comment',
        content: '第十一条',
        terms_version: TERMS_VERSION,
      })
      .expect(429);
    expect(blocked.body.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(
      await prisma.report.count({ where: { user_id: user.user_id } }),
    ).toBe(10);
  });

  it('enforces the stricter limit for users created within 24 hours', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-limit-new');
    for (let index = 0; index < 3; index += 1) {
      await createReport(user, spot.spot_id, { content: `新用户限额 ${index}` });
    }
    const blocked = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'comment',
        content: '新用户第四条',
        terms_version: TERMS_VERSION,
      })
      .expect(429);
    expect(blocked.body.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(
      await prisma.report.count({ where: { user_id: user.user_id } }),
    ).toBe(3);
  });

  it('counts Unicode code points and enforces per-type catch fields', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-shape');

    await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'comment',
        content: '   ',
        terms_version: TERMS_VERSION,
      })
      .expect(400);

    await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'comment',
        content: '🐟'.repeat(501),
        terms_version: TERMS_VERSION,
      })
      .expect(400);

    const maxEmoji = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'comment',
        content: '🐟'.repeat(500),
        terms_version: TERMS_VERSION,
      })
      .expect(201);
    expect(maxEmoji.body.data.moderation_status).toBe('published');

    // Terms are already accepted, so omitting them is allowed.
    await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({ spot_id: spot.spot_id, content_type: 'comment', content: '省略条款' })
      .expect(201);

    const invalidFish = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'catch',
        content: '不存在的鱼',
        fish_key: 'not-a-fish',
      })
      .expect(400);
    expect(invalidFish.body.code).toBe(ERROR_CODES.VALIDATION);

    await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'comment',
        content: '评论不能带鱼种',
        fish_key: 'luofei',
      })
      .expect(400);

    await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'intel',
        content: '情报不能带鱼获',
        catch_weight_kg: 2.5,
      })
      .expect(400);

    await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'catch',
        content: '重量越界',
        fish_key: 'luofei',
        catch_weight_kg: 1000,
      })
      .expect(400);

    const anonymous = await request(server)
      .post('/api/v1/reports')
      .set(HEADERS)
      .send({
        spot_id: spot.spot_id,
        content_type: 'comment',
        content: '未登录不能发',
      })
      .expect(401);
    expect(anonymous.body.code).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it('creates a structured condition report without content', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-condition');
    contentSecurity.textCalls = 0;

    const report = await createReport(user, spot.spot_id, {
      content_type: 'condition',
      content: '',
      condition: {
        open_status: 'open',
        fee_status: 'free',
        crowd_level: 'low',
        facilities: ['toilet', 'parking'],
      },
    });

    expect(report.moderation_status).toBe('published');
    expect(contentSecurity.textCalls).toBe(0);
    const row = await prisma.report.findUniqueOrThrow({
      where: { report_id: report.report_id as string },
    });
    expect(row.content).toBe('');
    expect(row.condition_open_status).toBe('open');
    expect(row.condition_fee_status).toBe('free');
    expect(row.condition_crowd_level).toBe('low');
    expect(row.condition_facilities).toEqual(['toilet', 'parking']);
    expect(row.observed_at).not.toBeNull();
    expect(row.machine_result).toEqual({ skipped: 'structured_only' });
  });

  it('runs text moderation when a condition report has content', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-condition-text');
    contentSecurity.textCalls = 0;

    const report = await createReport(user, spot.spot_id, {
      content_type: 'condition',
      content: '现场补充：东岸风大',
      condition: { crowd_level: 'medium' },
    });

    expect(report.moderation_status).toBe('published');
    expect(contentSecurity.textCalls).toBe(1);
    const row = await prisma.report.findUniqueOrThrow({
      where: { report_id: report.report_id as string },
    });
    expect(row.machine_result).toMatchObject({ suggest: 'pass' });
  });

  it('rejects a condition report without structured fields', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-condition-empty');

    await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'condition',
        content: '',
        terms_version: TERMS_VERSION,
      })
      .expect(400);
  });

  it('rejects a future or stale observed_at', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-condition-time');

    await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'condition',
        content: '',
        terms_version: TERMS_VERSION,
        condition: {
          crowd_level: 'low',
          observed_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        },
      })
      .expect(400);

    await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'condition',
        content: '',
        terms_version: TERMS_VERSION,
        condition: {
          crowd_level: 'low',
          observed_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        },
      })
      .expect(400);
  });

  it('limits condition reports to three images', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-condition-images');

    const response = await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'condition',
        content: '',
        terms_version: TERMS_VERSION,
        condition: { crowd_level: 'low' },
        image_keys: [
          'ugc/01HX0000000000000000000000/01HX0000000000000000000001.webp',
          'ugc/01HX0000000000000000000000/01HX0000000000000000000002.webp',
          'ugc/01HX0000000000000000000000/01HX0000000000000000000003.webp',
          'ugc/01HX0000000000000000000000/01HX0000000000000000000004.webp',
        ],
      })
      .expect(400);
    expect(response.body.message).toContain('3 images');
  });

  it('rejects condition fields on other content types', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-condition-other');

    await request(server)
      .post('/api/v1/reports')
      .set(appAuthHeaders(user.access_token))
      .send({
        spot_id: spot.spot_id,
        content_type: 'comment',
        content: '普通评论',
        terms_version: TERMS_VERSION,
        condition: { crowd_level: 'low' },
      })
      .expect(400);
  });

  it('excludes condition reports from the public UGC feed', async () => {
    const spot = await seedOpenSpot();
    const user = await loginAppUser(server, 'openid-condition');

    await createReport(user, spot.spot_id, { content: '普通评论' });
    await createReport(user, spot.spot_id, {
      content_type: 'condition',
      content: '',
      condition: { crowd_level: 'low' },
    });

    const feed = await request(server)
      .get(`/api/v1/spots/${spot.spot_id}/reports`)
      .set(HEADERS)
      .expect(200);
    expect(feed.body.data.total).toBe(1);
    expect(
      feed.body.data.items.every(
        (item: { content_type: string }) => item.content_type !== 'condition',
      ),
    ).toBe(true);
  });
});
