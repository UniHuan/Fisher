import { Injectable } from '@nestjs/common';

export const LOGIN_RATE_LIMIT_MAX = 5;
export const LOGIN_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_TRACKED_CLIENTS = 10_000;

export interface LoginRateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Epoch milliseconds when the current window frees a slot. */
  resetAt: number;
  retryAfterSeconds: number;
}

/**
 * In-memory, per-IP sliding-window limiter for the login endpoint.
 *
 * V1.0 runs a single API instance, so a process-local map is sufficient. The two-ECS
 * topology in Plan D must move this counter to Redis (shared state) or a WAF rate rule,
 * because each instance would otherwise allow its own LOGIN_RATE_LIMIT_MAX per window.
 * Reset is exposed so e2e tests can isolate their login sequences; it is not used in
 * production paths.
 */
@Injectable()
export class LoginRateLimiter {
  private readonly hits = new Map<string, number[]>();

  hit(clientKey: string, now = Date.now()): LoginRateLimitDecision {
    const windowStart = now - LOGIN_RATE_LIMIT_WINDOW_MS;
    const recent = (this.hits.get(clientKey) ?? []).filter(
      (timestamp) => timestamp > windowStart,
    );
    this.evictStaleEntries(windowStart);

    if (recent.length >= LOGIN_RATE_LIMIT_MAX) {
      const oldest = recent[0] ?? now;
      const resetAt = oldest + LOGIN_RATE_LIMIT_WINDOW_MS;
      this.hits.set(clientKey, recent);
      return {
        allowed: false,
        limit: LOGIN_RATE_LIMIT_MAX,
        remaining: 0,
        resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      };
    }

    recent.push(now);
    this.hits.set(clientKey, recent);
    const resetAt = (recent[0] ?? now) + LOGIN_RATE_LIMIT_WINDOW_MS;
    return {
      allowed: true,
      limit: LOGIN_RATE_LIMIT_MAX,
      remaining: Math.max(0, LOGIN_RATE_LIMIT_MAX - recent.length),
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  /** Test hook: forget every tracked client so a new sequence starts clean. */
  reset(): void {
    this.hits.clear();
  }

  private evictStaleEntries(windowStart: number): void {
    if (this.hits.size < MAX_TRACKED_CLIENTS) {
      return;
    }
    for (const [key, timestamps] of this.hits) {
      const recent = timestamps.filter((timestamp) => timestamp > windowStart);
      if (recent.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, recent);
      }
    }
  }
}
