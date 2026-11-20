import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RateLimitService } from '../src/modules/rate-limit/rate-limit.service';
import { purgeExpiredRateLimits } from '../src/jobs/purge-rate-limits.job';
import { PrismaService } from '../src/prisma/prisma.service';
import { adminHeaders, cleanupAuthTestData } from './support/auth-helpers';
import { createTestApp } from './create-test-app';

jest.setTimeout(30000);

describe('Rate limits (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let service: RateLimitService;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    service = app.get(RateLimitService);
  });

  afterAll(async () => {
    await service.reset('test:');
    await service.reset('admin-login:');
    await cleanupAuthTestData();
    await app.close();
  });

  it('shares a fixed window across service calls', async () => {
    await service.reset('test:');
    const results = await Promise.all(
      Array.from({ length: 4 }, () => service.hit('test:key', { limit: 3, windowSeconds: 60 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    expect(results.filter((r) => !r.allowed)).toHaveLength(1);
    const fifth = await service.hit('test:key', { limit: 3, windowSeconds: 60 });
    expect(fifth.allowed).toBe(false);
  });

  it('purges expired counters', async () => {
    await prisma.rateLimitCounter.create({
      data: {
        counter_key: 'test:expired',
        window_start: new Date(Date.now() - 120000),
        count: 1,
        expires_at: new Date(Date.now() - 1000),
      },
    });
    await purgeExpiredRateLimits(prisma);
    const remaining = await prisma.rateLimitCounter.count({
      where: { counter_key: 'test:expired' },
    });
    expect(remaining).toBe(0);
  });

  it('takes the client IP from X-Forwarded-For behind nginx', async () => {
    await service.reset('admin-login:');
    const response = await request(server)
      .post('/api/v1/admin/auth/login')
      .set(adminHeaders())
      .set('X-Forwarded-For', '203.0.113.9')
      .send({ username: 'none', password: 'none' });
    expect(response.status).toBe(401);
    const rows = await prisma.rateLimitCounter.findMany({
      where: { counter_key: { startsWith: 'admin-login:ip:' } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.counter_key).not.toContain('203.0.113.9');
    expect(rows[0]?.counter_key).toBe(
      `admin-login:ip:${createHash('sha256').update('203.0.113.9').digest('hex')}`,
    );
  });
});
