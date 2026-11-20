import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ADMIN_ROLE, type AdminRole } from '@szfisher/shared';
import { argon2id, hash } from 'argon2';
import { generateSync } from 'otplib';
import request from 'supertest';
import { ulid } from 'ulid';
import { RateLimitService } from '../../src/modules/rate-limit/rate-limit.service';

export const ADMIN_ORIGIN = 'https://admin.szfisher.test';
export const ADMIN_STAGING_ORIGIN = 'https://admin-staging.szfisher.test';
export const ADMIN_USER_AGENT = 'szfisher-admin-e2e/1.0.0';
export const ADMIN_CLIENT_VERSION = '1.0.0';

export interface TestAdmin {
  adminId: string;
  username: string;
  password: string;
  role: AdminRole;
  totpSecret?: string;
}

export interface AuthBody {
  csrf_token?: string;
  admin?: {
    admin_id: string;
    username: string;
    role: AdminRole;
    totp_enabled: boolean;
  };
  mfa_token?: string;
  mfa_required?: boolean;
  must_bind_totp?: boolean;
  recovery_codes?: string[];
  remaining_recovery_codes?: number;
  otpauth_uri?: string;
  manual_key?: string;
}

export interface AuthSession {
  response: request.Response;
  body: AuthBody;
  cookie: string;
  csrf: string;
  admin: TestAdmin;
}

let prisma: PrismaClient | undefined;
const createdAdminIds: string[] = [];
let usernameSequence = 0;

export function getAuthTestPrisma(): PrismaClient {
  if (!prisma) {
    // createTestApp sets DATABASE_URL before any helper call, so this is lazy on purpose.
    prisma = new PrismaClient();
  }
  return prisma;
}

/**
 * The per-IP login limiter shares Postgres state across app instances. Tests that
 * issue several raw login requests clear its counters first so the limiter never
 * masks account-lockout assertions.
 */
export async function resetLoginRateLimiter(app: INestApplication): Promise<void> {
  await app.get(RateLimitService).reset('admin-login:');
}

export function clientHeaders(): Record<string, string> {
  return {
    'X-Client-Type': 'admin',
    'X-Client-Version': ADMIN_CLIENT_VERSION,
    'User-Agent': ADMIN_USER_AGENT,
  };
}

export function adminHeaders(origin: string | null = ADMIN_ORIGIN): Record<string, string> {
  const headers = clientHeaders();
  if (origin !== null) {
    headers.Origin = origin;
  }
  return headers;
}

export function cookieHeaderFrom(response: request.Response): string {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : typeof header === 'string' ? [header] : [];
  return values
    .map((value) => value.split(';')[0])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('; ');
}

export function rawSetCookieHeader(response: request.Response): string {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : typeof header === 'string' ? [header] : [];
  return values.join(';');
}

export function readAuthBody(response: request.Response): AuthBody {
  const envelope = response.body as { data?: AuthBody } | undefined;
  return envelope?.data ?? {};
}

export async function createAdmin(
  _app: INestApplication,
  role: AdminRole,
  username?: string,
): Promise<TestAdmin> {
  usernameSequence += 1;
  const uniqueUsername =
    username ?? `${role}_${Date.now().toString(36)}_${usernameSequence.toString(36)}`;
  const password = `test-password-${role}-${usernameSequence}-secure`;
  const passwordHash = await hash(password, { type: argon2id });
  const admin = await getAuthTestPrisma().adminUser.create({
    data: {
      admin_id: ulid(),
      username: uniqueUsername,
      password_hash: passwordHash,
      role,
      status: 'active',
    },
  });
  createdAdminIds.push(admin.admin_id);
  return { adminId: admin.admin_id, username: admin.username, password, role };
}

export async function loginWithPassword(
  app: INestApplication,
  admin: TestAdmin,
  origin: string | null = ADMIN_ORIGIN,
): Promise<request.Response> {
  // Isolate login sequences from the shared limiter; the limiter suite bypasses
  // this helper on purpose so it observes real counting.
  await resetLoginRateLimiter(app);
  return request(app.getHttpServer())
    .post('/api/v1/admin/auth/login')
    .set(adminHeaders(origin))
    .send({ username: admin.username, password: admin.password });
}

export async function loginAs(
  app: INestApplication,
  role: AdminRole,
  username?: string,
): Promise<AuthSession> {
  const admin = await createAdmin(app, role, username);
  const response = await loginWithPassword(app, admin);
  const body = readAuthBody(response);
  return {
    response,
    body,
    cookie: cookieHeaderFrom(response),
    csrf: body.csrf_token ?? '',
    admin,
  };
}

export async function loginWithTotp(
  app: INestApplication,
  admin: TestAdmin,
): Promise<AuthSession> {
  if (!admin.totpSecret) {
    throw new Error('loginWithTotp requires admin.totpSecret to be set');
  }
  const loginResponse = await loginWithPassword(app, admin);
  const loginBody = readAuthBody(loginResponse);
  if (!loginBody.mfa_token) {
    throw new Error(`expected mfa_required, got HTTP ${loginResponse.status}`);
  }
  const response = await request(app.getHttpServer())
    .post('/api/v1/admin/auth/totp/verify')
    .set(adminHeaders())
    .send({ mfa_token: loginBody.mfa_token, code: generateSync({ secret: admin.totpSecret }) });
  const body = readAuthBody(response);
  return {
    response,
    body,
    cookie: cookieHeaderFrom(response),
    csrf: body.csrf_token ?? '',
    admin,
  };
}

/**
 * Creates a brand-new super admin and completes the forced TOTP binding flow.
 * New admins start without TOTP, so the first password login returns must_bind_totp.
 */
export async function loginAsSuperAdmin(app: INestApplication): Promise<AuthSession> {
  const server = app.getHttpServer();
  const admin = await createAdmin(app, ADMIN_ROLE.SUPER_ADMIN);
  const firstLogin = await loginWithPassword(app, admin);
  const mfaToken = readAuthBody(firstLogin).mfa_token;
  if (mfaToken === undefined) {
    throw new Error('expected must_bind_totp mfa_token');
  }
  const setup = await request(server)
    .post('/api/v1/admin/auth/totp/setup')
    .set(adminHeaders())
    .send({ mfa_token: mfaToken })
    .expect(200);
  const secret = setup.body.data.manual_key as string;
  admin.totpSecret = secret;
  const enable = await request(server)
    .post('/api/v1/admin/auth/totp/enable')
    .set(adminHeaders())
    .send({ mfa_token: mfaToken, code: generateSync({ secret }) })
    .expect(200);
  const body = readAuthBody(enable);
  return {
    response: enable,
    body,
    cookie: cookieHeaderFrom(enable),
    csrf: body.csrf_token ?? '',
    admin,
  };
}

export async function refresh(app: INestApplication, cookie: string): Promise<AuthSession> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/admin/auth/refresh')
    .set(adminHeaders())
    .set('Cookie', cookie);
  const body = readAuthBody(response);
  return {
    response,
    body,
    cookie: cookieHeaderFrom(response),
    csrf: body.csrf_token ?? '',
    admin: {
      adminId: body.admin?.admin_id ?? '',
      username: body.admin?.username ?? '',
      password: '',
      role: (body.admin?.role ?? 'operator') as AdminRole,
    },
  };
}

export async function cleanupAuthTestData(): Promise<void> {
  if (!prisma) {
    return;
  }
  if (createdAdminIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { admin_id: { in: createdAdminIds } } });
    await prisma.idempotencyKey.deleteMany({ where: { actor_id: { in: createdAdminIds } } });
    await prisma.importJob.deleteMany({ where: { admin_id: { in: createdAdminIds } } });
    await prisma.adminUser.deleteMany({ where: { admin_id: { in: createdAdminIds } } });
    createdAdminIds.length = 0;
  }
  await prisma.$disconnect();
  prisma = undefined;
}
