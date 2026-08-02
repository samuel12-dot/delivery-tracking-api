import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { issueTokenPair, verifyAccessToken, verifyRefreshToken } from '../src/lib/tokens.js';

describe('password security', () => {
  it('hashes with a unique salt and verifies without exposing the password', async () => {
    const first = await hashPassword('correct horse battery staple');
    const second = await hashPassword('correct horse battery staple');
    expect(first).not.toBe(second);
    expect(first).not.toContain('correct horse');
    await expect(verifyPassword('correct horse battery staple', first)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', first)).resolves.toBe(false);
  });
});

describe('JWT token pairs', () => {
  it('issues independently identifiable access and refresh tokens', () => {
    const userId = '38cfb8cb-e39c-44e9-8bc5-109f01194941';
    const pair = issueTokenPair(userId, 'driver');
    const access = verifyAccessToken(pair.accessToken);
    const refresh = verifyRefreshToken(pair.refreshToken);
    expect(access).toMatchObject({ sub: userId, role: 'driver', type: 'access' });
    expect(refresh).toMatchObject({ sub: userId, role: 'driver', type: 'refresh', family: pair.familyId });
    expect(access.jti).not.toBe(refresh.jti);
  });

  it('rejects a token presented for the wrong purpose', () => {
    const pair = issueTokenPair('e8a54f96-87d4-4bc9-ac33-633756886f49', 'customer');
    expect(() => verifyAccessToken(pair.refreshToken)).toThrow();
    expect(() => verifyRefreshToken(pair.accessToken)).toThrow();
  });

  it('rejects payload tampering', () => {
    const pair = issueTokenPair('07e61139-e0b8-4356-a845-179872b472ad', 'merchant');
    const [header, payload, signature] = pair.accessToken.split('.');
    const decoded = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()) as Record<string, unknown>;
    decoded.role = 'admin';
    const tampered = `${header}.${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;
    expect(() => verifyAccessToken(tampered)).toThrow('Invalid token signature');
  });
});
