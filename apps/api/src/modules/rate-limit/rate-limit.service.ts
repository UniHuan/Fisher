import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { RateLimitHit, RateLimitRule } from './rate-limit.types';

const RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Fixed-window rate limiter backed by Postgres so every API instance shares
 * the same counters. The counter upsert is a single atomic statement: concurrent
 * first hits either insert count 1 or increment the winner's row, so no caller
 * can observe a lost update.
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async hit(key: string, rule: RateLimitRule, now: Date = new Date()): Promise<RateLimitHit> {
    const windowMs = rule.windowSeconds * 1000;
    const windowStartMs = Math.floor(now.getTime() / windowMs) * windowMs;
    const windowStart = new Date(windowStartMs);
    const resetAt = new Date(windowStartMs + windowMs);
    // Keep rows one day past their window so purge jobs can run on any schedule.
    const expiresAt = new Date(resetAt.getTime() + RETENTION_MS);

    const rows = await this.prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO rate_limit_counter (counter_key, window_start, count, expires_at)
      VALUES (${key}, ${windowStart}, 1, ${expiresAt})
      ON CONFLICT (counter_key, window_start)
      DO UPDATE SET count = rate_limit_counter.count + 1
      RETURNING count
    `;
    const count = rows[0]?.count ?? 1;

    return {
      allowed: count <= rule.limit,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - count),
      resetAt,
    };
  }

  /** Test hook: drop counters whose key starts with `prefix` (all when omitted). */
  async reset(prefix?: string): Promise<void> {
    if (prefix === undefined) {
      await this.prisma.rateLimitCounter.deleteMany();
      return;
    }
    await this.prisma.rateLimitCounter.deleteMany({
      where: { counter_key: { startsWith: prefix } },
    });
  }
}
