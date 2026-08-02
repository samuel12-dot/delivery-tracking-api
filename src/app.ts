import { randomUUID } from 'node:crypto';
import express from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from './lib/logger.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { driversRouter } from './routes/drivers.js';
import { customersRouter } from './routes/customers.js';
import { merchantsRouter } from './routes/merchants.js';
import { healthRouter } from './routes/health.js';
import { ordersRouter } from './routes/orders.js';

export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger, genReqId: (req) => req.headers['x-request-id']?.toString() ?? randomUUID() }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/health', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/drivers', driversRouter);
  app.use('/api/v1/customers', customersRouter);
  app.use('/api/v1/merchants', merchantsRouter);
  app.use('/api/v1/orders', ordersRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
};
