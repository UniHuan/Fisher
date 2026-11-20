export interface RateLimitRule {
  /** Maximum number of hits allowed inside one fixed window. */
  limit: number;
  /** Fixed window length; windows start at multiples of this size since the epoch. */
  windowSeconds: number;
}

export interface RateLimitHit {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Wall-clock instant when the current fixed window rolls over. */
  resetAt: Date;
}
