import type { PrismaService } from '../../prisma/prisma.service';

export interface AdvisoryLockOptions {
  /**
   * Prisma interactive-transaction timeout in milliseconds (Prisma defaults to
   * 5000). Jobs that do slow work inside the lock must raise it: if the
   * transaction aborts before the explicit unlock runs, the session-level
   * advisory lock stays on the pooled connection.
   */
  timeoutMs?: number;
}

/**
 * Runs `fn` while holding a Postgres session advisory lock named by `key`.
 *
 * The queries run inside an interactive transaction so that lock acquisition and
 * release always use the same pooled connection; a bare `$queryRaw` pair could
 * land on different connections and leave the lock behind. Returns null without
 * calling `fn` when another process already holds the lock. The lock is released
 * in `finally`, including when `fn` throws.
 */
export async function withAdvisoryLock<T>(
  prisma: PrismaService,
  key: string,
  fn: () => Promise<T>,
  options: AdvisoryLockOptions = {},
): Promise<T | null> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_lock(hashtext(${key})) AS locked
      `;
      if (rows[0]?.locked !== true) {
        return null;
      }
      try {
        return await fn();
      } finally {
        await tx.$queryRaw`SELECT pg_advisory_unlock(hashtext(${key}))`;
      }
    },
    options.timeoutMs === undefined ? undefined : { timeout: options.timeoutMs },
  );
}
