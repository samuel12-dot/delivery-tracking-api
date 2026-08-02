import { describe, expect, it } from 'vitest';
import { normalizeMetricPath } from '../src/middleware/metrics.js';
import { tokenBucketScript } from '../src/middleware/rate-limit.js';

describe('metrics cardinality', () => {
  it('normalizes UUID resource identifiers', () => {
    expect(normalizeMetricPath('/api/v1/orders/f793db0e-8821-48d9-9645-571bffc8255f?include=driver'))
      .toBe('/api/v1/orders/:id');
  });
});

describe('Redis token bucket', () => {
  it('uses Redis server time and persists refill state atomically', () => {
    expect(tokenBucketScript).toContain("redis.call('TIME')");
    expect(tokenBucketScript).toContain("redis.call('HMGET'");
    expect(tokenBucketScript).toContain("redis.call('HSET'");
    expect(tokenBucketScript).toContain('tokens >= 1');
  });
});
