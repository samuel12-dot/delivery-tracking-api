import { Router } from 'express';
import { db } from '../lib/postgres.js';
import { redis } from '../lib/redis.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const checks = await Promise.allSettled([
    db.query('SELECT 1'),
    redis.status === 'wait' ? redis.connect().then(() => redis.ping()) : redis.ping(),
  ]);
  const healthy = checks.every((check) => check.status === 'fulfilled');
  res.status(healthy ? 200 : 503).send({
    status: healthy ? 'ok' : 'degraded',
    checks: {
      database: checks[0]?.status === 'fulfilled' ? 'up' : 'down',
      redis: checks[1]?.status === 'fulfilled' ? 'up' : 'down',
    },
  });
});

