import { Logger, type INestApplication } from '@nestjs/common';
import { ADMIN_ROLE } from '@szfisher/shared';
import jwt from 'jsonwebtoken';
import { generateSync } from 'otplib';
import request from 'supertest';
import { AuditLogRepository } from '../src/modules/audit/audit-log.repository';
import { PERMISSIONS } from '../src/modules/auth/permissions';
import {
  ADMIN_ORIGIN,
  ADMIN_USER_AGENT,
  adminHeaders,
  cleanupAuthTestData,
  clientHeaders,
  cookieHeaderFrom,
  createAdmin,
  getAuthTestPrisma,
  loginAs,
  loginWithPassword,
  rawSetCookieHeader,
  refresh,
  resetLoginRateLimiter,
  type TestAdmin,
} from './support/auth-helpers';
import { createTestApp } from './create-test-app';

jest.setTimeout(30000);

const TEST_JWT_ACCESS_SECRET = 'test-jwt-access-secret-0123456789abcdef';

describe('Admin auth (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await cleanupAuthTestData();
    await app.close();
  });

  async function bindTotp(admin: TestAdmin): Promise<string> {
    const firstLogin = await loginWithPassword(app, admin);
    const bindToken = firstLogin.body.data.mfa_token as string;
    const setup = await request(server)
      .post('/api/v1/admin/auth/totp/setup')
      .set(adminHeaders())
      .send({ mfa_token: bindToken })
      .expect(200);
    const manualKey = setup.body.data.manual_key as string;
    await request(server)
      .post('/api/v1/admin/auth/totp/enable')
      .set(adminHeaders())
      .send({ mfa_token: bindToken, code: generateSync({ secret: manualKey }) })
      .expect(200);
    admin.totpSecret = manualKey;
    return manualKey;
  }

  it('sets host-only secure cookies and never returns tokens', async () => {
    const session = await loginAs(app, 'operator');

    expect(session.response.status).toBe(200);
    const setCookie = rawSetCookieHeader(session.response);
    const cookie = cookieHeaderFrom(session.response);
    expect(cookie).toContain('__Host-fish_access=');
    expect(cookie).toContain('__Host-fish_refresh=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toContain('Domain=');

    expect(session.body.csrf_token).toEqual(expect.any(String));
    expect(session.body.admin).toMatchObject({
      admin_id: session.admin.adminId,
      username: session.admin.username,
      role: 'operator',
      totp_enabled: false,
    });

    const json = JSON.stringify(session.response.body);
    expect(json).not.toContain('access_token');
    expect(json).not.toContain('refresh_token');
    expect(json).not.toContain('__Host-fish_access');
    expect(json).not.toContain('__Host-fish_refresh');
    for (const pair of cookie.split('; ')) {
      const value = pair.slice(pair.indexOf('=') + 1);
      if (value.length > 0) {
        expect(json).not.toContain(value);
      }
    }
  });

  it('requires csrf on authenticated writes and clears the session on logout', async () => {
    const session = await loginAs(app, 'operator');

    await request(server)
      .post('/api/v1/admin/auth/logout')
      .set(clientHeaders())
      .set('Cookie', session.cookie)
      .expect(403);

    const logout = await request(server)
      .post('/api/v1/admin/auth/logout')
      .set(clientHeaders())
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .expect(200);
    expect(logout.body).toMatchObject({ code: 0, data: null });

    const cleared = rawSetCookieHeader(logout);
    expect(cleared).toContain('__Host-fish_access=');
    expect(cleared).toContain('__Host-fish_refresh=');
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

    await request(server)
      .get('/api/v1/admin/me')
      .set(clientHeaders())
      .set('Cookie', session.cookie)
      .expect(401);
  });

  it('rotates refresh tokens and revokes all sessions when an old token is reused', async () => {
    const first = await loginAs(app, 'operator');
    const rotated = await refresh(app, first.cookie);

    expect(rotated.response.status).toBe(200);
    expect(rotated.cookie).toContain('__Host-fish_access=');
    expect(rotated.cookie).toContain('__Host-fish_refresh=');
    expect(rotated.cookie).not.toBe(first.cookie);
    expect(rotated.body.admin?.admin_id).toBe(first.admin.adminId);
    expect(rotated.csrf).toEqual(expect.any(String));

    await request(server)
      .post('/api/v1/admin/auth/refresh')
      .set(adminHeaders())
      .set('Cookie', first.cookie)
      .expect(401);

    await request(server)
      .get('/api/v1/admin/me')
      .set(clientHeaders())
      .set('Cookie', rotated.cookie)
      .expect(401);
  });

  it('binds TOTP for super admins, then requires verify and supports recovery codes', async () => {
    const admin = await createAdmin(app, 'super_admin');

    const firstLogin = await loginWithPassword(app, admin);
    expect(firstLogin.status).toBe(200);
    expect(firstLogin.body.data).toMatchObject({
      must_bind_totp: true,
      mfa_token: expect.any(String),
    });
    expect(firstLogin.headers['set-cookie']).toBeUndefined();
    const bindToken = firstLogin.body.data.mfa_token as string;

    const setup = await request(server)
      .post('/api/v1/admin/auth/totp/setup')
      .set(adminHeaders())
      .send({ mfa_token: bindToken })
      .expect(200);
    const otpauthUri = setup.body.data.otpauth_uri as string;
    const manualKey = setup.body.data.manual_key as string;
    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(otpauthUri).toContain(encodeURIComponent('深圳钓鱼助手'));
    expect(otpauthUri).toContain(manualKey);
    admin.totpSecret = manualKey;

    const enable = await request(server)
      .post('/api/v1/admin/auth/totp/enable')
      .set(adminHeaders())
      .send({ mfa_token: bindToken, code: generateSync({ secret: manualKey }) })
      .expect(200);
    const enableData = enable.body.data;
    expect(enableData.admin).toMatchObject({
      admin_id: admin.adminId,
      username: admin.username,
      role: 'super_admin',
      totp_enabled: true,
    });
    expect(enableData.csrf_token).toEqual(expect.any(String));
    const recoveryCodes = enableData.recovery_codes as string[];
    expect(recoveryCodes).toHaveLength(10);
    for (const code of recoveryCodes) {
      expect(code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    }
    expect(cookieHeaderFrom(enable)).toContain('__Host-fish_refresh=');

    const secondLogin = await loginWithPassword(app, admin);
    expect(secondLogin.body.data).toMatchObject({
      mfa_required: true,
      mfa_token: expect.any(String),
    });
    expect(secondLogin.headers['set-cookie']).toBeUndefined();

    const verify = await request(server)
      .post('/api/v1/admin/auth/totp/verify')
      .set(adminHeaders())
      .send({
        mfa_token: secondLogin.body.data.mfa_token as string,
        code: generateSync({ secret: manualKey }),
      })
      .expect(200);
    expect(verify.body.data.admin).toMatchObject({
      admin_id: admin.adminId,
      totp_enabled: true,
    });
    expect(verify.body.data.csrf_token).toEqual(expect.any(String));
    expect(cookieHeaderFrom(verify)).toContain('__Host-fish_access=');

    const thirdLogin = await loginWithPassword(app, admin);
    const recoveryCode = recoveryCodes[0] ?? 'missing-code';
    const recovery = await request(server)
      .post('/api/v1/admin/auth/totp/recovery')
      .set(adminHeaders())
      .send({
        mfa_token: thirdLogin.body.data.mfa_token as string,
        recovery_code: recoveryCode,
      })
      .expect(200);
    expect(recovery.body.data).toMatchObject({
      remaining_recovery_codes: 9,
      admin: { admin_id: admin.adminId, totp_enabled: true },
    });
    expect(cookieHeaderFrom(recovery)).toContain('__Host-fish_refresh=');

    const stored = await getAuthTestPrisma().adminUser.findUniqueOrThrow({
      where: { admin_id: admin.adminId },
    });
    expect(stored.totp_enabled_at).not.toBeNull();
    expect(stored.recovery_codes_hash).toHaveLength(9);

    const totpAudits = await getAuthTestPrisma().auditLog.findMany({
      where: {
        admin_id: admin.adminId,
        action: { in: ['auth.totp_enabled', 'auth.totp_verified', 'auth.recovery_used'] },
      },
    });
    expect(new Set(totpAudits.map((row) => row.action))).toEqual(
      new Set(['auth.totp_enabled', 'auth.totp_verified', 'auth.recovery_used']),
    );
    for (const row of totpAudits) {
      expect(row.entity_type).toBe('admin_user');
      expect(row.entity_id).toBe(admin.adminId);
      expect(row.ip).toBeTruthy();
      expect(row.request_id).toMatch(/^req_/);
      expect(row.user_agent).toBe(ADMIN_USER_AGENT);
    }
  });

  it('locks an account for 15 minutes after five wrong passwords', async () => {
    const admin = await createAdmin(app, 'operator');
    resetLoginRateLimiter(app);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await request(server)
        .post('/api/v1/admin/auth/login')
        .set(adminHeaders())
        .send({ username: admin.username, password: `wrong-password-${attempt}-secure` })
        .expect(401);
      expect(res.body).toMatchObject({ code: 40101, message: 'Invalid username or password' });
    }

    const locked = await getAuthTestPrisma().adminUser.findUniqueOrThrow({
      where: { admin_id: admin.adminId },
    });
    expect(locked.failed_login_count).toBe(5);
    expect(locked.locked_until).not.toBeNull();
    const lockedUntil = locked.locked_until?.getTime() ?? 0;
    expect(lockedUntil).toBeGreaterThan(Date.now());
    expect(lockedUntil).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000 + 5000);

    // Five logins already consumed the IP window; clear it so 401 lockout behavior is visible.
    resetLoginRateLimiter(app);
    const lockedAttempt = await request(server)
      .post('/api/v1/admin/auth/login')
      .set(adminHeaders())
      .send({ username: admin.username, password: admin.password })
      .expect(401);
    expect(lockedAttempt.body).toMatchObject({
      code: 40101,
      message: 'Invalid username or password',
    });

    const unknown = await request(server)
      .post('/api/v1/admin/auth/login')
      .set(adminHeaders())
      .send({ username: 'no_such_admin_account', password: 'irrelevant-password' })
      .expect(401);
    expect(unknown.body.message).toBe(lockedAttempt.body.message);

    await getAuthTestPrisma().adminUser.update({
      where: { admin_id: admin.adminId },
      data: { locked_until: new Date(Date.now() - 1000) },
    });
    await request(server)
      .post('/api/v1/admin/auth/login')
      .set(adminHeaders())
      .send({ username: admin.username, password: 'wrong-password-after-lock' })
      .expect(401);

    const fresh = await getAuthTestPrisma().adminUser.findUniqueOrThrow({
      where: { admin_id: admin.adminId },
    });
    expect(fresh.failed_login_count).toBe(1);
    expect(fresh.locked_until).toBeNull();
  });

  it('rejects login without an allowed Origin', async () => {
    const admin = await createAdmin(app, 'operator');
    resetLoginRateLimiter(app);

    await request(server)
      .post('/api/v1/admin/auth/login')
      .set(adminHeaders('https://evil.example'))
      .send({ username: admin.username, password: admin.password })
      .expect(403);

    await request(server)
      .post('/api/v1/admin/auth/login')
      .set(adminHeaders(null))
      .send({ username: admin.username, password: admin.password })
      .expect(403);
  });

  it('binds the mfa token to the client ip and user agent', async () => {
    const admin = await createAdmin(app, 'super_admin');
    const login = await loginWithPassword(app, admin);
    const mfaToken = login.body.data.mfa_token as string;

    await request(server)
      .post('/api/v1/admin/auth/totp/setup')
      .set({ ...adminHeaders(), 'User-Agent': 'different-client/9.9.9' })
      .send({ mfa_token: mfaToken })
      .expect(401);

    await request(server)
      .post('/api/v1/admin/auth/totp/setup')
      .set(adminHeaders())
      .send({ mfa_token: mfaToken })
      .expect(200);
  });

  it('enforces idle and absolute session expiry', async () => {
    const idle = await loginAs(app, 'operator');
    await getAuthTestPrisma().adminUser.update({
      where: { admin_id: idle.admin.adminId },
      data: { last_active_at: new Date(Date.now() - 31 * 60 * 1000) },
    });
    await request(server)
      .get('/api/v1/admin/me')
      .set(clientHeaders())
      .set('Cookie', idle.cookie)
      .expect(401);

    const absolute = await loginAs(app, 'operator');
    await getAuthTestPrisma().adminUser.update({
      where: { admin_id: absolute.admin.adminId },
      data: { session_started_at: new Date(Date.now() - 9 * 60 * 60 * 1000) },
    });
    const expired = await refresh(app, absolute.cookie);
    expect(expired.response.status).toBe(401);

    const stored = await getAuthTestPrisma().adminUser.findUniqueOrThrow({
      where: { admin_id: absolute.admin.adminId },
    });
    expect(stored.refresh_token_hash).toBeNull();
    expect(stored.session_started_at).toBeNull();
    expect(stored.last_active_at).toBeNull();

    await request(server)
      .get('/api/v1/admin/me')
      .set(clientHeaders())
      .set('Cookie', absolute.cookie)
      .expect(401);
  });

  it('returns the current admin, role permissions and a usable csrf token', async () => {
    expect(PERMISSIONS.reviewer).toEqual(
      expect.arrayContaining(['report:read', 'report:moderate']),
    );
    expect(PERMISSIONS.reviewer).not.toContain('user:ban');
    expect(PERMISSIONS.operator).toEqual(
      expect.arrayContaining(['report:moderate', 'user:restrict', 'user:ban']),
    );

    await request(server).get('/api/v1/admin/me').set(clientHeaders()).expect(401);

    const session = await loginAs(app, 'operator');
    const me = await request(server)
      .get('/api/v1/admin/me')
      .set(clientHeaders())
      .set('Cookie', session.cookie)
      .expect(200);

    expect(me.body.data).toMatchObject({
      admin: {
        admin_id: session.admin.adminId,
        username: session.admin.username,
        role: 'operator',
        totp_enabled: false,
      },
      permissions: [...PERMISSIONS[ADMIN_ROLE.OPERATOR]],
    });
    expect(me.body.data.csrf_token).toBe(session.csrf);

    await request(server)
      .post('/api/v1/admin/auth/logout')
      .set(clientHeaders())
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', me.body.data.csrf_token as string)
      .expect(200);
  });

  it('writes an auth.refresh_reuse audit row when a refresh token is reused', async () => {
    const first = await loginAs(app, 'operator');
    await refresh(app, first.cookie);

    await request(server)
      .post('/api/v1/admin/auth/refresh')
      .set(adminHeaders())
      .set('Cookie', first.cookie)
      .expect(401);

    const audit = await getAuthTestPrisma().auditLog.findFirst({
      where: { admin_id: first.admin.adminId, action: 'auth.refresh_reuse' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entity_type).toBe('admin_user');
    expect(audit?.ip).toBeTruthy();
    expect(audit?.user_agent).toBe(ADMIN_USER_AGENT);
    expect(audit?.request_id).toMatch(/^req_/);
  });

  it('invalidates the mfa token after five failed TOTP codes', async () => {
    const admin = await createAdmin(app, 'super_admin');
    const login = await loginWithPassword(app, admin);
    const mfaToken = login.body.data.mfa_token as string;

    const setup = await request(server)
      .post('/api/v1/admin/auth/totp/setup')
      .set(adminHeaders())
      .send({ mfa_token: mfaToken })
      .expect(200);
    const manualKey = setup.body.data.manual_key as string;

    const activeCode = generateSync({ secret: manualKey });
    const wrongCode = activeCode === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server)
        .post('/api/v1/admin/auth/totp/enable')
        .set(adminHeaders())
        .send({ mfa_token: mfaToken, code: wrongCode })
        .expect(401);
    }

    const challenge = await getAuthTestPrisma().idempotencyKey.findFirst({
      where: { actor_type: 'admin_mfa', actor_id: admin.adminId },
    });
    expect(challenge).toBeNull();

    await request(server)
      .post('/api/v1/admin/auth/totp/enable')
      .set(adminHeaders())
      .send({ mfa_token: mfaToken, code: generateSync({ secret: manualKey }) })
      .expect(401);
  });

  it('rejects authenticated writes with a present disallowed Origin', async () => {
    const session = await loginAs(app, 'operator');

    await request(server)
      .post('/api/v1/admin/auth/logout')
      .set(clientHeaders())
      .set('Origin', 'https://evil.example')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .expect(403);

    await request(server)
      .get('/api/v1/admin/me')
      .set(clientHeaders())
      .set('Cookie', session.cookie)
      .expect(200);
  });

  it('accepts the configured staging origin', async () => {
    const admin = await createAdmin(app, 'operator');
    const response = await loginWithPassword(app, admin, 'https://admin-staging.szfisher.test');
    expect(response.status).toBe(200);
    expect(response.body.data.admin.admin_id).toBe(admin.adminId);
    expect(ADMIN_ORIGIN).not.toBe('https://admin-staging.szfisher.test');
  });

  it('guards mixed-case admin paths that Express routes case-insensitively', async () => {
    await request(server)
      .post('/API/V1/ADMIN/AUTH/LOGOUT')
      .set(clientHeaders())
      .expect(401);

    const session = await loginAs(app, 'operator');
    await request(server)
      .post('/API/V1/ADMIN/AUTH/LOGOUT')
      .set(clientHeaders())
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .expect(200);
  });

  it('counts parallel wrong passwords atomically and locks at five', async () => {
    const admin = await createAdmin(app, 'operator');
    resetLoginRateLimiter(app);
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_value, index) =>
        request(server)
          .post('/api/v1/admin/auth/login')
          .set(adminHeaders())
          .send({ username: admin.username, password: `parallel-wrong-${index}-password` }),
      ),
    );
    for (const response of responses) {
      expect(response.status).toBe(401);
    }

    const stored = await getAuthTestPrisma().adminUser.findUniqueOrThrow({
      where: { admin_id: admin.adminId },
    });
    expect(stored.failed_login_count).toBe(5);
    expect(stored.locked_until).not.toBeNull();
  });

  it('invalidates the mfa token after five parallel wrong TOTP codes', async () => {
    const admin = await createAdmin(app, 'super_admin');
    const manualKey = await bindTotp(admin);

    const login = await loginWithPassword(app, admin);
    const mfaToken = login.body.data.mfa_token as string;
    const activeCode = generateSync({ secret: manualKey });
    const wrongCode = activeCode === '000000' ? '000001' : '000000';

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(server)
          .post('/api/v1/admin/auth/totp/verify')
          .set(adminHeaders())
          .send({ mfa_token: mfaToken, code: wrongCode }),
      ),
    );
    for (const response of responses) {
      expect(response.status).toBe(401);
    }

    const challenge = await getAuthTestPrisma().idempotencyKey.findFirst({
      where: { actor_type: 'admin_mfa', actor_id: admin.adminId },
    });
    expect(challenge).toBeNull();

    await request(server)
      .post('/api/v1/admin/auth/totp/verify')
      .set(adminHeaders())
      .send({ mfa_token: mfaToken, code: generateSync({ secret: manualKey }) })
      .expect(401);
  });

  it('truncates long user agents when recording refresh-reuse audits', async () => {
    const first = await loginAs(app, 'operator');
    await refresh(app, first.cookie);
    const before = await getAuthTestPrisma().adminUser.findUniqueOrThrow({
      where: { admin_id: first.admin.adminId },
    });

    const longUserAgent = 'long-agent-'.padEnd(300, 'x');
    await request(server)
      .post('/api/v1/admin/auth/refresh')
      .set(adminHeaders())
      .set('User-Agent', longUserAgent)
      .set('Cookie', first.cookie)
      .expect(401);

    const after = await getAuthTestPrisma().adminUser.findUniqueOrThrow({
      where: { admin_id: first.admin.adminId },
    });
    expect(after.token_version).toBe(before.token_version + 1);
    expect(after.refresh_token_hash).toBeNull();
    expect(after.session_started_at).toBeNull();

    const audit = await getAuthTestPrisma().auditLog.findFirst({
      where: { admin_id: first.admin.adminId, action: 'auth.refresh_reuse' },
      orderBy: { created_at: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.user_agent).toHaveLength(255);
  });

  it('returns 40102 for an expired access token', async () => {
    const admin = await createAdmin(app, 'operator');
    const expiredToken = jwt.sign(
      { role: 'operator', token_version: 0 },
      TEST_JWT_ACCESS_SECRET,
      {
        algorithm: 'HS256',
        subject: admin.adminId,
        jwtid: 'expired-access-token',
        expiresIn: -10,
      },
    );

    const response = await request(server)
      .get('/api/v1/admin/me')
      .set(clientHeaders())
      .set('Cookie', `__Host-fish_access=${expiredToken}`)
      .expect(401);
    expect(response.body).toMatchObject({ code: 40102, message: 'Token expired' });
  });

  it('requires MFA when totp_enabled_at is set but the secret is missing', async () => {
    const admin = await createAdmin(app, 'operator');
    await getAuthTestPrisma().adminUser.update({
      where: { admin_id: admin.adminId },
      data: { totp_enabled_at: new Date() },
    });

    const login = await loginWithPassword(app, admin);
    expect(login.status).toBe(200);
    expect(login.body.data).toMatchObject({
      mfa_required: true,
      mfa_token: expect.any(String),
    });
    expect(login.headers['set-cookie']).toBeUndefined();

    const verify = await request(server)
      .post('/api/v1/admin/auth/totp/verify')
      .set(adminHeaders())
      .send({ mfa_token: login.body.data.mfa_token as string, code: '123456' })
      .expect(401);
    expect(verify.body.code).toBe(40101);
    expect(verify.headers['set-cookie']).toBeUndefined();

    const stored = await getAuthTestPrisma().adminUser.findUniqueOrThrow({
      where: { admin_id: admin.adminId },
    });
    expect(stored.session_started_at).toBeNull();
    expect(stored.refresh_token_hash).toBeNull();
  });

  it('rate limits login per IP and returns retry headers', async () => {
    resetLoginRateLimiter(app);
    const attempt = (): request.Test =>
      request(server)
        .post('/api/v1/admin/auth/login')
        .set(adminHeaders())
        .send({ username: 'no_such_rate_limit_admin', password: 'irrelevant-password-value' });

    for (let index = 0; index < 5; index += 1) {
      const allowed = await attempt().expect(401);
      expect(allowed.headers['x-ratelimit-limit']).toBe('5');
      expect(allowed.headers['x-ratelimit-remaining']).toBe(String(4 - index));
      expect(allowed.headers['x-ratelimit-reset']).toMatch(/^\d+$/);
    }

    const blocked = await attempt().expect(429);
    expect(blocked.body).toMatchObject({ code: 42901 });
    expect(blocked.body.request_id).toMatch(/^req_/);
    expect(blocked.headers['retry-after']).toMatch(/^\d+$/);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers['x-ratelimit-limit']).toBe('5');
    expect(blocked.headers['x-ratelimit-remaining']).toBe('0');
    expect(blocked.headers['x-ratelimit-reset']).toMatch(/^\d+$/);

    resetLoginRateLimiter(app);
  });

  it('marks auth and admin responses as no-store by default', async () => {
    const session = await loginAs(app, ADMIN_ROLE.OPERATOR);
    expect(session.response.headers['cache-control']).toBe('no-store');

    const me = await request(server)
      .get('/api/v1/admin/me')
      .set(clientHeaders())
      .set('Cookie', session.cookie)
      .expect(200);
    expect(me.headers['cache-control']).toBe('no-store');

    const auditList = await request(server)
      .get('/api/v1/admin/audit-logs')
      .set(clientHeaders())
      .set('Cookie', session.cookie)
      .expect(200);
    expect(auditList.headers['cache-control']).toBe('no-store');

    const admin = await createAdmin(app, ADMIN_ROLE.SUPER_ADMIN);
    const firstLogin = await loginWithPassword(app, admin);
    const setup = await request(server)
      .post('/api/v1/admin/auth/totp/setup')
      .set(adminHeaders())
      .send({ mfa_token: firstLogin.body.data.mfa_token as string })
      .expect(200);
    expect(setup.headers['cache-control']).toBe('no-store');
  });

  it('records auth.login, auth.login_failed and auth.logout audit rows', async () => {
    resetLoginRateLimiter(app);
    const failedAdmin = await createAdmin(app, ADMIN_ROLE.OPERATOR);
    await request(server)
      .post('/api/v1/admin/auth/login')
      .set(adminHeaders())
      .send({ username: failedAdmin.username, password: 'wrong-password-for-audit' })
      .expect(401);

    const failedRow = await getAuthTestPrisma().auditLog.findFirst({
      where: { admin_id: failedAdmin.adminId, action: 'auth.login_failed' },
    });
    expect(failedRow).not.toBeNull();
    expect(failedRow).toMatchObject({
      entity_type: 'admin_user',
      entity_id: failedAdmin.adminId,
      user_agent: ADMIN_USER_AGENT,
    });
    expect(failedRow?.ip).toBeTruthy();
    expect(failedRow?.request_id).toMatch(/^req_/);

    const auditCountBeforeUnknown = await getAuthTestPrisma().auditLog.count();
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      await request(server)
        .post('/api/v1/admin/auth/login')
        .set(adminHeaders())
        .send({ username: 'no_such_audit_admin', password: 'irrelevant-password' })
        .expect(401);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown_username'));
    } finally {
      warnSpy.mockRestore();
    }
    // Unknown usernames fail the audit_log FK, so they are logger-only.
    expect(await getAuthTestPrisma().auditLog.count()).toBe(auditCountBeforeUnknown);

    const session = await loginAs(app, ADMIN_ROLE.OPERATOR);
    expect(
      await getAuthTestPrisma().auditLog.findFirst({
        where: { admin_id: session.admin.adminId, action: 'auth.login' },
      }),
    ).not.toBeNull();

    await request(server)
      .post('/api/v1/admin/auth/logout')
      .set(clientHeaders())
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .expect(200);

    const logoutRow = await getAuthTestPrisma().auditLog.findFirst({
      where: { admin_id: session.admin.adminId, action: 'auth.logout' },
    });
    expect(logoutRow).not.toBeNull();
    expect(logoutRow).toMatchObject({
      entity_type: 'admin_user',
      entity_id: session.admin.adminId,
      user_agent: ADMIN_USER_AGENT,
    });
    expect(logoutRow?.ip).toBeTruthy();
    expect(logoutRow?.request_id).toMatch(/^req_/);
  });

  it('revokes refresh sessions even when the audit write fails', async () => {
    const first = await loginAs(app, ADMIN_ROLE.OPERATOR);
    await refresh(app, first.cookie);
    const before = await getAuthTestPrisma().adminUser.findUniqueOrThrow({
      where: { admin_id: first.admin.adminId },
    });

    const auditRepository = app.get(AuditLogRepository);
    const createSpy = jest
      .spyOn(auditRepository, 'create')
      .mockRejectedValue(new Error('audit store unavailable'));
    const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      await request(server)
        .post('/api/v1/admin/auth/refresh')
        .set(adminHeaders())
        .set('Cookie', first.cookie)
        .expect(401);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('auth.refresh_reuse'));
    } finally {
      createSpy.mockRestore();
      logSpy.mockRestore();
    }

    const after = await getAuthTestPrisma().adminUser.findUniqueOrThrow({
      where: { admin_id: first.admin.adminId },
    });
    expect(after.token_version).toBe(before.token_version + 1);
    expect(after.refresh_token_hash).toBeNull();
    expect(after.session_started_at).toBeNull();
    expect(after.last_active_at).toBeNull();
  });
});
