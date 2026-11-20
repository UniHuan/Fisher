import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { withAdvisoryLock } from '../common/db/advisory-lock';
import { JsonLogger } from '../common/logging/json-logger';
import { PrismaService } from '../prisma/prisma.service';

const TIMEOUT_LOCK_KEY = 'media-check:timeout';
/** Spec 8.3: a missing callback after 10 minutes becomes `timeout`, never `pass`. */
export const MEDIA_CHECK_TIMEOUT_MS = 10 * 60 * 1000;
const BATCH_SIZE = 500;

/**
 * Marks stale `pending` image checks as `timeout` so their reports go to the
 * human queue. It deliberately does not publish anything. Instances coordinate
 * through a Postgres advisory lock; the non-holder is a no-op.
 */
export async function expirePendingMediaChecks(
  prisma: PrismaService,
  now: Date = new Date(),
): Promise<number | null> {
  return withAdvisoryLock(prisma, TIMEOUT_LOCK_KEY, async () => {
    const cutoff = new Date(now.getTime() - MEDIA_CHECK_TIMEOUT_MS);
    const stale = await prisma.reportMediaCheck.findMany({
      where: { status: 'pending', created_at: { lt: cutoff } },
      select: { trace_id: true },
      take: BATCH_SIZE,
    });

    let updated = 0;
    for (const check of stale) {
      const result = await prisma.reportMediaCheck.updateMany({
        where: { trace_id: check.trace_id, status: 'pending' },
        data: { status: 'timeout', checked_at: now },
      });
      updated += result.count;
    }
    return updated;
  });
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(), {
    logger: new JsonLogger(),
  });
  try {
    const expired = await expirePendingMediaChecks(app.get(PrismaService));
    process.stdout.write(
      `${JSON.stringify({ event: 'media_check_timeout', expired, locked: expired !== null })}\n`,
    );
  } finally {
    await app.close();
  }
}

// Guarded so tests can import expirePendingMediaChecks without starting an app.
if (require.main === module) {
  void main();
}
