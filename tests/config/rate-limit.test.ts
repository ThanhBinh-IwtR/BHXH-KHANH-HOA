import { describe, expect, it } from 'vitest';

import { RateLimiter } from '@/lib/http/rate-limit';

describe('RateLimiter', () => {
  it('allows a client again after the window expires', () => {
    let now = 1_000;
    const limiter = new RateLimiter({
      limit: 1,
      windowMs: 100,
      salt: 'test-salt',
      now: () => now,
    });

    expect(limiter.check('203.0.113.1').allowed).toBe(true);
    expect(limiter.check('203.0.113.1').allowed).toBe(false);

    now = 1_100;
    expect(limiter.check('203.0.113.1').allowed).toBe(true);
  });
});
