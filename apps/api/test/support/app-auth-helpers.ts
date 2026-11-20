import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RateLimitService } from '../../src/modules/rate-limit/rate-limit.service';
import { getAuthTestPrisma } from './auth-helpers';

export const APP_CLIENT_VERSION = '1.0.0';

type TestServer = ReturnType<INestApplication['getHttpServer']>;

export interface AppSessionBody {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: {
    nickname: string | null;
    avatar_url: string | null;
  };
}

export interface AppSession extends AppSessionBody {
  user_id: string;
}

export function appClientHeaders(): Record<string, string> {
  return {
    'X-Client-Type': 'miniprogram',
    'X-Client-Version': APP_CLIENT_VERSION,
  };
}

export function appAuthHeaders(accessToken?: string): Record<string, string> {
  const headers = appClientHeaders();
  if (accessToken !== undefined && accessToken.length > 0) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

/** App login counters share Postgres state; every test starts from a clean window. */
export async function resetAppLoginRateLimiter(app: INestApplication): Promise<void> {
  await app.get(RateLimitService).reset('app-login:');
}

export async function loginAppUser(server: TestServer, openid: string): Promise<AppSession> {
  const response = await request(server)
    .post('/api/v1/auth/wechat/login')
    .set(appClientHeaders())
    .send({ code: openid })
    .expect(200);
  const body = response.body.data as AppSessionBody;
  const identity = await getAuthTestPrisma().userIdentity.findUnique({
    where: { provider_provider_uid: { provider: 'wechat_mini', provider_uid: openid } },
    select: { user_id: true },
  });
  if (identity === null) {
    throw new Error('loginAppUser: login did not create a wechat_mini identity');
  }
  return { ...body, user_id: identity.user_id };
}

export async function refreshAppSession(
  server: TestServer,
  refreshToken: string,
): Promise<AppSessionBody> {
  const response = await request(server)
    .post('/api/v1/auth/refresh')
    .set(appClientHeaders())
    .send({ refresh_token: refreshToken })
    .expect(200);
  return response.body.data as AppSessionBody;
}

/** Removes only identities created with the openids a spec owns, plus their data. */
export async function cleanupAppAuthTestData(openids: readonly string[]): Promise<void> {
  if (openids.length === 0) {
    return;
  }
  const prisma = getAuthTestPrisma();
  const identities = await prisma.userIdentity.findMany({
    where: { provider: 'wechat_mini', provider_uid: { in: [...openids] } },
    select: { user_id: true },
  });
  const userIds = [...new Set(identities.map((identity) => identity.user_id))];
  if (userIds.length === 0) {
    return;
  }
  await prisma.userSession.deleteMany({ where: { user_id: { in: userIds } } });
  // report children (likes, abuses, media checks) cascade from the report row.
  await prisma.report.deleteMany({ where: { user_id: { in: userIds } } });
  await prisma.ugcUpload.deleteMany({ where: { user_id: { in: userIds } } });
  await prisma.userIdentity.deleteMany({ where: { user_id: { in: userIds } } });
  await prisma.appUser.deleteMany({ where: { user_id: { in: userIds } } });
}
