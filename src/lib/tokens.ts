import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import type { UserRole } from '../domain/auth.js';

type TokenType = 'access' | 'refresh';

interface TokenPayload {
  sub: string;
  role: UserRole;
  type: TokenType;
  iat: number;
  exp: number;
  jti: string;
  family?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  refreshTokenId: string;
  familyId: string;
  refreshExpiresAt: Date;
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

const secondsFromDuration = (duration: string): number => {
  const match = /^(\d+)(s|m|h|d)$/.exec(duration);
  if (!match) throw new Error(`Unsupported token duration: ${duration}`);
  const amount = Number(match[1]);
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 } as const;
  return amount * multipliers[match[2] as keyof typeof multipliers];
};

const sign = (payload: TokenPayload, secret: string): string => {
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
};

const verify = (token: string, expectedType: TokenType, secret: string): TokenPayload => {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [headerEncoded, payloadEncoded, signatureEncoded] = parts;
  if (!headerEncoded || !payloadEncoded || !signatureEncoded) throw new Error('Malformed token');

  const header = JSON.parse(Buffer.from(headerEncoded, 'base64url').toString()) as { alg?: string; typ?: string };
  if (header.alg !== 'HS256' || header.typ !== 'JWT') throw new Error('Unsupported token');

  const expected = createHmac('sha256', secret)
    .update(`${headerEncoded}.${payloadEncoded}`)
    .digest();
  const received = Buffer.from(signatureEncoded, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString()) as TokenPayload;
  if (!payload.sub || !payload.jti || payload.type !== expectedType || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Invalid or expired token');
  }
  return payload;
};

export const issueTokenPair = (
  userId: string,
  role: UserRole,
  familyId: string = randomUUID(),
): TokenPair => {
  const now = Math.floor(Date.now() / 1000);
  const refreshTokenId = randomUUID();
  const refreshLifetime = config.REFRESH_TOKEN_TTL_DAYS * 86400;
  const accessPayload: TokenPayload = {
    sub: userId,
    role,
    type: 'access',
    iat: now,
    exp: now + secondsFromDuration(config.ACCESS_TOKEN_TTL),
    jti: randomUUID(),
  };
  const refreshPayload: TokenPayload = {
    sub: userId,
    role,
    type: 'refresh',
    iat: now,
    exp: now + refreshLifetime,
    jti: refreshTokenId,
    family: familyId,
  };
  return {
    accessToken: sign(accessPayload, config.JWT_ACCESS_SECRET),
    refreshToken: sign(refreshPayload, config.JWT_REFRESH_SECRET),
    refreshTokenId,
    familyId,
    refreshExpiresAt: new Date((now + refreshLifetime) * 1000),
  };
};

export const verifyAccessToken = (token: string): TokenPayload =>
  verify(token, 'access', config.JWT_ACCESS_SECRET);

export const verifyRefreshToken = (token: string): TokenPayload =>
  verify(token, 'refresh', config.JWT_REFRESH_SECRET);

export const hashToken = (token: string): string =>
  createHmac('sha256', config.JWT_REFRESH_SECRET).update(token).digest('hex');
