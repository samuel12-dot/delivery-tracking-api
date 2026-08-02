import { randomUUID } from 'node:crypto';
import express from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from './lib/logger.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';

export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger, genReqId: (req) => req.headers['x-request-id']?.toString() ?? randomUUID() }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/health', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
};
