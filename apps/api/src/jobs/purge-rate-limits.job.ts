import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { withAdvisoryLock } from '../common/db/advisory-lock';
import { JsonLogger } from '../common/logging/json-logger';
import { PrismaService } from '../prisma/prisma.service';

const PURGE_LOCK_KEY = 'rate-limits:purge';

/**
 * Deletes rate-limit counters whose window expired more than the retention
 * horizon ago. Safe to run from multiple hosts: only the advisory-lock holder
 * performs the delete, the others are no-ops.
 */
export async function purgeExpiredRateLimits(
  prisma: PrismaService,
  now: Date = new Date(),
): Promise<number> {
  const deleted = await withAdvisoryLock(prisma, PURGE_LOCK_KEY, () =>
    prisma.rateLimitCounter.deleteMany({ where: { expires_at: { lt: now } } }),
  );
  return deleted?.count ?? 0;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(), {
    logger: new JsonLogger(),
  });
  try {
    const deleted = await purgeExpiredRateLimits(app.get(PrismaService));
    process.stdout.write(`${JSON.stringify({ event: 'rate_limits_purge', deleted })}\n`);
  } finally {
    await app.close();
  }
}

// Guarded so tests can import purgeExpiredRateLimits without starting an app.
if (require.main === module) {
  void main();
}
