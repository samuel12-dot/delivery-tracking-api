import type { RequestHandler } from 'express';
import { httpRequestDuration, httpRequestsTotal } from '../lib/metrics.js';

export const normalizeMetricPath = (path: string): string => path
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ':id')
  .replace(/\?.*$/, '');

export const observeHttpRequest: RequestHandler = (req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const labels = {
      method: req.method,
      route: normalizeMetricPath(req.originalUrl),
      status: String(res.statusCode),
    };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, Number(process.hrtime.bigint() - started) / 1e9);
  });
  next();
};

