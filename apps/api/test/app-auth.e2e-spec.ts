import type { INestApplication } from '@nestjs/common';
import { ERROR_CODES } from '@szfisher/shared';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { ulid } from 'ulid';
import { WECHAT_AUTH_PROVIDER } from '../src/modules/app-auth/wechat-auth.provider';
import { RateLimitService } from '../src/modules/rate-limit/rate-limit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './create-test-app';
import { cleanupAdminSpotTestData, seedSpot } from './admin-spots.helpers';
import { FakeWechatAuthProvider } from './support/fake-wechat-auth.provider';
import {
  appAuthHeaders,
  appClientHeaders,
  cleanupAppAuthTestData,
  loginAppUser,
  refreshAppSession,
  resetAppLoginRateLimiter,
} from './support/app-auth-helpers';
import { cleanupAuthTestData } from './support/auth-helpers';

jest.setTimeout(30000);

const APP_JWT_SECRET = 'test-app-jwt-access-secret-0123456789abcdef';
const TEST_OPENIDS = [
  'openid-a',
  'openid-b',
  'openid-banned',
  'openid-banned-refresh',
  'openid-reuse',
  'openid-logout',
  'openid-logout-stranger',
  'openid-me',
  'openid-token',
  'openid-flood',
  'openid-ip',
  'openid-ip-v6',
];

describe('App auth (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp({
      wechatAuthProvider: {
        provide: WECHAT_AUTH_PROVIDER,
        useClass: FakeWechatAuthProvider,
      },
    });
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetAppLoginRateLimiter(app);
  });

  afterAll(async () => {
    await app.get(RateLimitService).reset('app-login:');
    await cleanupAppAuthTestData(TEST_OPENIDS);
    await cleanupAdminSpotTestData();
    await cleanupAuthTestData();
    await app.close();
  });

  it('creates a user with a generated nickname and returns app tokens', async () => {
    const session = await loginAppUser(server, 'openid-a');
    expect(session.access_token).toEqual(expect.any(String));
    expect(session.refresh_token).toEqual(expect.any(String));
    expect(session.token_type).toBe('Bearer');
    expect(session.expires_in).toBe(7200);
    expect(session.user.nickname).toMatch(/^钓友 /);
    expect(session.user.avatar_url).toBeNull();
    const user = await prisma.appUser.findFirstOrThrow({
      where: { user_identities: { some: { provider_uid: 'openid-a' } } },
    });
    expect(user.terms_accepted_at).toBeNull();
    expect(user.last_login_at).not.toBeNull();
  });

  it('stores only a masked client IP on the session', async () => {
    await request(server)
      .post('/api/v1/auth/wechat/login')
      .set(appClientHeaders())
      .set('X-Forwarded-For', '203.0.113.9')
      .send({ code: 'openid-ip' })
      .expect(200);
    const v4Identity = await prisma.userIdentity.findFirstOrThrow({
      where: { provider: 'wechat_mini', provider_uid: 'openid-ip' },
    });
    const v4Session = await prisma.userSession.findFirstOrThrow({
      where: { user_id: v4Identity.user_id },
      orderBy: { created_at: 'desc' },
    });
    expect(v4Session.ip).toBe('203.0.113.0');
    expect(v4Session.ip).not.toBe('203.0.113.9');

    await request(server)
      .post('/api/v1/auth/wechat/login')
      .set(appClientHeaders())
      .set('X-Forwarded-For', '2001:db8:abcd:12::1')
      .send({ code: 'openid-ip-v6' })
      .expect(200);
    const v6Identity = await prisma.userIdentity.findFirstOrThrow({
      where: { provider: 'wechat_mini', provider_uid: 'openid-ip-v6' },
    });
    const v6Session = await prisma.userSession.findFirstOrThrow({
      where: { user_id: v6Identity.user_id },
      orderBy: { created_at: 'desc' },
    });
    expect(v6Session.ip).toBe('2001:db8:abcd::');
    expect(v6Session.ip).not.toBe('2001:db8:abcd:12::1');
  });

  it('rotates refresh tokens and revokes every session on reuse', async () => {
    const first = await loginAppUser(server, 'openid-b');
    const rotated = await refreshAppSession(server, first.refresh_token);
    expect(rotated.refresh_token).not.toBe(first.refresh_token);
    await request(server)
      .post('/api/v1/auth/refresh')
      .set(appClientHeaders())
      .send({ refresh_token: first.refresh_token })
      .expect(401);
    await request(server)
      .post('/api/v1/auth/refresh')
      .set(appClientHeaders())
      .send({ refresh_token: rotated.refresh_token })
      .expect(401);
  });

  it('rejects banned users and never returns session_key', async () => {
    const banned = await loginAppUser(server, 'openid-banned');
    await prisma.appUser.update({
      where: { user_id: banned.user_id },
      data: { status: 'banned' },
    });
    const response = await request(server)
      .post('/api/v1/auth/wechat/login')
      .set(appClientHeaders())
      .send({ code: 'openid-banned' })
      .expect(403);
    expect(JSON.stringify(response.body)).not.toContain('session_key');
    expect(JSON.stringify(response.body)).not.toContain('openid-banned');
  });

  it('refuses refresh tokens for banned users with 403', async () => {
    const session = await loginAppUser(server, 'openid-banned-refresh');
    await prisma.appUser.update({
      where: { user_id: session.user_id },
      data: { status: 'banned' },
    });
    await request(server)
      .post('/api/v1/auth/refresh')
      .set(appClientHeaders())
      .send({ refresh_token: session.refresh_token })
      .expect(403);
  });

  it('revokes every device session when a rotated refresh token is replayed', async () => {
    const first = await loginAppUser(server, 'openid-reuse');
    const second = await loginAppUser(server, 'openid-reuse');
    const rotated = await refreshAppSession(server, first.refresh_token);

    // Replaying the rotated-away token is treated as theft and clears all devices.
    await request(server)
      .post('/api/v1/auth/refresh')
      .set(appClientHeaders())
      .send({ refresh_token: first.refresh_token })
      .expect(401);
    await request(server)
      .post('/api/v1/auth/refresh')
      .set(appClientHeaders())
      .send({ refresh_token: rotated.refresh_token })
      .expect(401);
    await request(server)
      .post('/api/v1/auth/refresh')
      .set(appClientHeaders())
      .send({ refresh_token: second.refresh_token })
      .expect(401);

    const active = await prisma.userSession.count({
      where: { user_id: first.user_id, revoked_at: null },
    });
    expect(active).toBe(0);
  });

  it('logs out only the matching session and rejects another user token', async () => {
    const owner = await loginAppUser(server, 'openid-logout');
    const secondDevice = await loginAppUser(server, 'openid-logout');
    const stranger = await loginAppUser(server, 'openid-logout-stranger');

    await request(server)
      .post('/api/v1/auth/logout')
      .set(appAuthHeaders(owner.access_token))
      .send({ refresh_token: stranger.refresh_token })
      .expect(403);

    await request(server)
      .post('/api/v1/auth/logout')
      .set(appAuthHeaders(owner.access_token))
      .send({ refresh_token: owner.refresh_token })
      .expect(200);

    const rotated = await refreshAppSession(server, secondDevice.refresh_token);
    expect(rotated.refresh_token).toEqual(expect.any(String));
    // The stranger's session was never touched by the failed logout.
    await refreshAppSession(server, stranger.refresh_token);
  });

  it('returns the current user, publish permission, restriction and notices', async () => {
    const session = await loginAppUser(server, 'openid-me');
    const spot = await seedSpot({
      spot_name: `通知测试-${ulid().slice(-6)}`,
      status: 'published',
      open_status: 'open',
    });
    const now = Date.now();
    const base = {
      spot_id: spot.spot_id,
      user_id: session.user_id,
      content_type: 'comment',
      content: '测试内容',
    };
    const newest = await prisma.report.create({
      data: {
        report_id: ulid(),
        ...base,
        moderation_status: 'human_rejected',
        reject_reason: '广告引流',
        audit_time: new Date(now - 60_000),
      },
    });
    const second = await prisma.report.create({
      data: {
        report_id: ulid(),
        ...base,
        moderation_status: 'machine_rejected',
        reject_reason: '机器拒绝',
        audit_time: new Date(now - 120_000),
      },
    });
    await prisma.report.create({
      data: {
        report_id: ulid(),
        ...base,
        moderation_status: 'removed',
        reject_reason: '违规下架',
        audit_time: new Date(now - 180_000),
      },
    });
    // Machine rejections have no audit_time; recency must fall back to created_at.
    const machineOnly = await prisma.report.create({
      data: {
        report_id: ulid(),
        ...base,
        moderation_status: 'machine_rejected',
        reject_reason: '机器拒绝无审核时间',
      },
    });
    await prisma.report.create({
      data: {
        report_id: ulid(),
        ...base,
        moderation_status: 'human_rejected',
        reject_reason: '第四条不应出现',
        audit_time: new Date(now - 240_000),
      },
    });
    await prisma.report.create({
      data: {
        report_id: ulid(),
        ...base,
        moderation_status: 'removed',
        reject_reason: 'author_deleted',
        audit_time: new Date(now - 10_000),
      },
    });
    await prisma.report.create({
      data: {
        report_id: ulid(),
        ...base,
        moderation_status: 'human_rejected',
        reject_reason: '超过三十天',
        audit_time: new Date(now - 31 * 24 * 60 * 60 * 1000),
      },
    });

    const me = await request(server)
      .get('/api/v1/auth/me')
      .set(appAuthHeaders(session.access_token))
      .expect(200);
    expect(me.body.data.user).toMatchObject({
      nickname: expect.stringMatching(/^钓友 /),
      avatar_url: null,
    });
    expect(me.body.data.can_publish).toBe(true);
    expect(me.body.data.restricted_until).toBeNull();
    const notices = me.body.data.notices as Array<Record<string, unknown>>;
    expect(notices).toHaveLength(3);
    expect(notices.map((notice) => notice.report_id)).toEqual([
      machineOnly.report_id,
      newest.report_id,
      second.report_id,
    ]);
    expect(notices[0]).toMatchObject({
      moderation_status: 'machine_rejected',
      reject_reason: '机器拒绝无审核时间',
      audit_time: machineOnly.created_at.toISOString(),
    });
    expect(typeof notices[0]?.audit_time).toBe('string');
    expect(JSON.stringify(notices)).not.toContain('author_deleted');
    expect(JSON.stringify(notices)).not.toContain('超过三十天');

    const restrictedUntil = new Date(now + 24 * 60 * 60 * 1000);
    await prisma.appUser.update({
      where: { user_id: session.user_id },
      data: { restricted_until: restrictedUntil },
    });
    const restricted = await request(server)
      .get('/api/v1/auth/me')
      .set(appAuthHeaders(session.access_token))
      .expect(200);
    expect(restricted.body.data.can_publish).toBe(false);
    expect(restricted.body.data.restricted_until).toBe(restrictedUntil.toISOString());
  });

  it('rejects expired and forged access tokens', async () => {
    const session = await loginAppUser(server, 'openid-token');
    const expired = jwt.sign({ token_version: 0 }, APP_JWT_SECRET, {
      algorithm: 'HS256',
      subject: session.user_id,
      jwtid: 'expired-jti',
      expiresIn: -10,
    });
    const expiredResponse = await request(server)
      .get('/api/v1/auth/me')
      .set(appAuthHeaders(expired))
      .expect(401);
    expect(expiredResponse.body.code).toBe(ERROR_CODES.TOKEN_EXPIRED);

    const forged = jwt.sign({ token_version: 0 }, 'wrong-app-secret-0123456789abcdefghij', {
      algorithm: 'HS256',
      subject: session.user_id,
      jwtid: 'forged-jti',
      expiresIn: 60,
    });
    const forgedResponse = await request(server)
      .get('/api/v1/auth/me')
      .set(appAuthHeaders(forged))
      .expect(401);
    expect(forgedResponse.body.code).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it('rejects access tokens after the user token version changes', async () => {
    const session = await loginAppUser(server, 'openid-token');
    await prisma.appUser.update({
      where: { user_id: session.user_id },
      data: { token_version: { increment: 1 } },
    });
    await request(server)
      .get('/api/v1/auth/me')
      .set(appAuthHeaders(session.access_token))
      .expect(401);
  });

  it('rate limits login per openid', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(server)
        .post('/api/v1/auth/wechat/login')
        .set(appClientHeaders())
        .send({ code: 'openid-flood' })
        .expect(200);
    }
    const blocked = await request(server)
      .post('/api/v1/auth/wechat/login')
      .set(appClientHeaders())
      .send({ code: 'openid-flood' })
      .expect(429);
    expect(blocked.body.code).toBe(ERROR_CODES.RATE_LIMITED);
  });
});
