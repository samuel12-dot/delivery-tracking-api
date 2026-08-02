import type { RequestHandler } from 'express';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { HttpError } from './errors.js';

interface TokenBucketOptions {
  keyPrefix: string;
  capacity: number;
  refillPerSecond: number;
}

export const tokenBucketScript = `
local current = redis.call('TIME')
local now = tonumber(current[1]) + tonumber(current[2]) / 1000000
local values = redis.call('HMGET', KEYS[1], 'tokens', 'updated_at')
local tokens = tonumber(values[1]) or tonumber(ARGV[1])
local updated_at = tonumber(values[2]) or now
tokens = math.min(tonumber(ARGV[1]), tokens + math.max(0, now - updated_at) * tonumber(ARGV[2]))
local allowed = 0
local retry_after = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry_after = math.ceil((1 - tokens) / tonumber(ARGV[2]))
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'updated_at', now)
redis.call('EXPIRE', KEYS[1], math.ceil(tonumber(ARGV[1]) / tonumber(ARGV[2]) * 2))
return { allowed, math.floor(tokens), retry_after }
`;

export const createRateLimit = (options: TokenBucketOptions): RequestHandler => async (req, res, next) => {
  const identity = req.auth?.userId ?? req.ip ?? req.socket.remoteAddress ?? 'unknown';
  try {
    const result = await redis.eval(
      tokenBucketScript,
      1,
      `rate_limit:${options.keyPrefix}:${identity}`,
      options.capacity,
      options.refillPerSecond,
    ) as [number, number, number];
    const [allowed, remaining, retryAfter] = result;
    res.setHeader('X-RateLimit-Limit', options.capacity);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
    if (allowed === 1) return next();
    res.setHeader('Retry-After', Math.max(1, retryAfter));
    return next(new HttpError(429, 'Too Many Requests', 'Rate limit exceeded; retry later'));
  } catch (error: unknown) {
    logger.warn({ err: error, keyPrefix: options.keyPrefix }, 'rate limiter unavailable; request allowed');
    return next();
  }
};

