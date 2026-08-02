import type { RequestHandler } from 'express';
import type { UserRole } from '../domain/auth.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { HttpError } from './errors.js';

export const authenticate: RequestHandler = (req, _res, next) => {
  const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
  if (scheme !== 'Bearer' || !token) return next(new HttpError(401, 'Unauthorized', 'A bearer token is required'));

  try {
    const payload = verifyAccessToken(token);
    req.auth = { userId: payload.sub, role: payload.role };
    next();
  } catch {
    next(new HttpError(401, 'Unauthorized', 'The access token is invalid or expired'));
  }
};

export const authorize = (...roles: UserRole[]): RequestHandler => (req, _res, next) => {
  if (!req.auth) return next(new HttpError(401, 'Unauthorized', 'Authentication is required'));
  if (!roles.includes(req.auth.role)) return next(new HttpError(403, 'Forbidden', 'Your role cannot perform this action'));
  next();
};

