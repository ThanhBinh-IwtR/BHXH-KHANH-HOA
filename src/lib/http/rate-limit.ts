import { createHash } from 'node:crypto';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  salt: string;
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Fixed-window in-memory rate limiter keyed by a short-lived SHA-256 hash of the
 * forwarded IP plus a server salt. Raw IP addresses are never stored.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly salt: string;
  private readonly now: () => number;

  constructor(options: RateLimitOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.salt = options.salt;
    this.now = options.now ?? Date.now;
  }

  private key(ip: string): string {
    return createHash('sha256').update(`${this.salt}:${ip}`).digest('hex');
  }

  private removeExpired(now: number): void {
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }

  check(ip: string): RateLimitResult {
    const now = this.now();
    this.removeExpired(now);
    const key = this.key(ip);
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.limit - 1 };
    }
    if (entry.count >= this.limit) {
      return { allowed: false, remaining: 0 };
    }
    entry.count += 1;
    return { allowed: true, remaining: this.limit - entry.count };
  }
}

/** Extract the client IP from proxy headers without trusting user-controlled bodies. */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
