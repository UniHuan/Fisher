import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { withAdvisoryLock } from '../common/db/advisory-lock';
import { JsonLogger } from '../common/logging/json-logger';
import { PrismaService } from '../prisma/prisma.service';

const PURGE_LOCK_KEY = 'user-sessions:purge';
/** Expired or revoked sessions are kept 30 days for abuse analysis. */
export const SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Deletes session rows that expired or were revoked more than 30 days ago.
 * Active sessions and recently revoked rows (refresh-token reuse evidence)
 * stay. Safe to run from multiple hosts: only the advisory-lock holder
 * deletes, the others are no-ops.
 */
export async function purgeUserSessions(
  prisma: PrismaService,
  now: Date = new Date(),
): Promise<number | null> {
  const cutoff = new Date(now.getTime() - SESSION_RETENTION_MS);
  return withAdvisoryLock(prisma, PURGE_LOCK_KEY, async () => {
    const deleted = await prisma.userSession.deleteMany({
      where: {
        OR: [
          { expires_at: { lt: cutoff } },
          { revoked_at: { not: null, lt: cutoff } },
        ],
      },
    });
    return deleted.count;
  });
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(), {
    logger: new JsonLogger(),
  });
  try {
    const deleted = await purgeUserSessions(app.get(PrismaService));
    process.stdout.write(
      `${JSON.stringify({
        event: 'user_sessions_purge',
        deleted,
        locked: deleted !== null,
      })}\n`,
    );
  } finally {
    await app.close();
  }
}

// Guarded so tests can import purgeUserSessions without starting an app.
if (require.main === module) {
  void main();
}
