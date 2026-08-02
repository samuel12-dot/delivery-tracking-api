import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    message: string,
    public readonly type = 'about:blank',
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, 'Not Found', `No route matches ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  const normalized = error instanceof ZodError
    ? new HttpError(400, 'Validation failed', error.issues.map((issue) => issue.message).join('; '))
    : error instanceof HttpError
      ? error
      : new HttpError(500, 'Internal Server Error', 'An unexpected error occurred');

  if (normalized.status >= 500) req.log.error({ err: error }, normalized.message);
  res.status(normalized.status).type('application/problem+json').send({
    type: normalized.type,
    title: normalized.title,
    status: normalized.status,
    detail: normalized.message,
    instance: req.originalUrl,
    request_id: req.id,
  });
};

