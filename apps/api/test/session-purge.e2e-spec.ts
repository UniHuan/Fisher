import type { INestApplication } from '@nestjs/common';
import { ulid } from 'ulid';
import { purgeUserSessions } from '../src/jobs/purge-user-sessions.job';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './create-test-app';

jest.setTimeout(30000);

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Session purge job (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId = '';

  async function seedSession(input: {
    expiresAt: Date;
    revokedAt: Date | null;
  }): Promise<string> {
    const sessionId = ulid();
    await prisma.userSession.create({
      data: {
        session_id: sessionId,
        user_id: userId,
        refresh_token_hash: `purge-test-${sessionId}`.padEnd(64, '0').slice(0, 64),
        expires_at: input.expiresAt,
        revoked_at: input.revokedAt,
      },
    });
    return sessionId;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    userId = ulid();
    await prisma.appUser.create({
      data: { user_id: userId, nickname: '会话清理测试' },
    });
  });

  afterAll(async () => {
    await prisma.userSession.deleteMany({ where: { user_id: userId } });
    await prisma.appUser.deleteMany({ where: { user_id: userId } });
    await app.close();
  });

  it('deletes only sessions expired or revoked more than 30 days ago', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 31 * DAY_MS);
    const recent = new Date(now.getTime() - 29 * DAY_MS);

    const expiredOld = await seedSession({
      expiresAt: old,
      revokedAt: null,
    });
    const revokedOld = await seedSession({
      expiresAt: new Date(now.getTime() + 10 * DAY_MS),
      revokedAt: old,
    });
    const expiredRecent = await seedSession({
      expiresAt: recent,
      revokedAt: null,
    });
    const revokedRecent = await seedSession({
      expiresAt: new Date(now.getTime() + 10 * DAY_MS),
      revokedAt: recent,
    });
    const active = await seedSession({
      expiresAt: new Date(now.getTime() + 10 * DAY_MS),
      revokedAt: null,
    });

    const deleted = await purgeUserSessions(prisma, now);
    expect(deleted).not.toBeNull();

    const remaining = await prisma.userSession.findMany({
      where: { user_id: userId },
      select: { session_id: true },
    });
    const remainingIds = new Set(remaining.map((row) => row.session_id));
    expect(remainingIds.has(expiredOld)).toBe(false);
    expect(remainingIds.has(revokedOld)).toBe(false);
    expect(remainingIds.has(expiredRecent)).toBe(true);
    expect(remainingIds.has(revokedRecent)).toBe(true);
    expect(remainingIds.has(active)).toBe(true);
    expect(deleted).toBeGreaterThanOrEqual(2);
  });
});
