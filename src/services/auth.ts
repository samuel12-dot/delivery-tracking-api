import type { PoolClient } from 'pg';
import { db } from '../lib/postgres.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { hashToken, issueTokenPair, verifyRefreshToken, type TokenPair } from '../lib/tokens.js';
import type { UserRole } from '../domain/auth.js';
import { HttpError } from '../middleware/errors.js';

interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  role: Exclude<UserRole, 'admin'>;
  vehicleType?: 'bike' | 'car' | 'van';
  merchant?: { name: string; address: string; lat: number; lng: number };
}

interface UserRecord { id: string; email: string; full_name: string; role: UserRole; password_hash: string }

const saveRefreshToken = async (client: PoolClient, userId: string, pair: TokenPair) => {
  await client.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [pair.refreshTokenId, userId, hashToken(pair.refreshToken), pair.familyId, pair.refreshExpiresAt],
  );
};

const publicUser = (user: UserRecord) => ({
  id: user.id,
  email: user.email,
  full_name: user.full_name,
  role: user.role,
});

export const register = async (input: RegisterInput) => {
  if (input.role === 'driver' && !input.vehicleType) {
    throw new HttpError(400, 'Validation failed', 'vehicle_type is required for drivers');
  }
  if (input.role === 'merchant' && !input.merchant) {
    throw new HttpError(400, 'Validation failed', 'merchant details are required for merchants');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const passwordHash = await hashPassword(input.password);
    const result = await client.query<UserRecord>(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4) RETURNING id, email, password_hash, full_name, role`,
      [input.email.toLowerCase(), passwordHash, input.fullName, input.role],
    );
    const user = result.rows[0];
    if (!user) throw new Error('User insert returned no row');

    if (input.role === 'driver') {
      await client.query('INSERT INTO drivers (user_id, vehicle_type) VALUES ($1, $2)', [user.id, input.vehicleType]);
    } else if (input.role === 'merchant' && input.merchant) {
      await client.query(
        `INSERT INTO merchants (user_id, name, address, location)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography)`,
        [user.id, input.merchant.name, input.merchant.address, input.merchant.lng, input.merchant.lat],
      );
    }

    const tokens = issueTokenPair(user.id, user.role);
    await saveRefreshToken(client, user.id, tokens);
    await client.query('COMMIT');
    return { user: publicUser(user), tokens: { access_token: tokens.accessToken, refresh_token: tokens.refreshToken } };
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new HttpError(409, 'Conflict', 'An account with this email already exists');
    }
    throw error;
  } finally {
    client.release();
  }
};

export const login = async (email: string, password: string) => {
  const result = await db.query<UserRecord>(
    'SELECT id, email, password_hash, full_name, role FROM users WHERE email = $1',
    [email.toLowerCase()],
  );
  const user = result.rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new HttpError(401, 'Unauthorized', 'Email or password is incorrect');
  }

  const tokens = issueTokenPair(user.id, user.role);
  const client = await db.connect();
  try {
    await saveRefreshToken(client, user.id, tokens);
  } finally {
    client.release();
  }
  return { user: publicUser(user), tokens: { access_token: tokens.accessToken, refresh_token: tokens.refreshToken } };
};

export const rotateRefreshToken = async (token: string) => {
  let claims: ReturnType<typeof verifyRefreshToken>;
  try {
    claims = verifyRefreshToken(token);
  } catch {
    throw new HttpError(401, 'Unauthorized', 'The refresh token is invalid or expired');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ id: string; user_id: string; family_id: string; revoked_at: Date | null; expires_at: Date; role: UserRole }>(
      `SELECT rt.id, rt.user_id, rt.family_id, rt.revoked_at, rt.expires_at, u.role
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 FOR UPDATE OF rt`,
      [hashToken(token)],
    );
    const stored = result.rows[0];
    if (!stored || stored.user_id !== claims.sub || stored.id !== claims.jti) {
      throw new HttpError(401, 'Unauthorized', 'The refresh token is not recognized');
    }
    if (stored.revoked_at) {
      await client.query('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = $1', [stored.family_id]);
      await client.query('COMMIT');
      throw new HttpError(401, 'Refresh token reuse detected', 'This token family has been revoked');
    }
    if (stored.expires_at <= new Date()) throw new HttpError(401, 'Unauthorized', 'The refresh token has expired');

    const replacement = issueTokenPair(stored.user_id, stored.role, stored.family_id);
    await saveRefreshToken(client, stored.user_id, replacement);
    await client.query(
      'UPDATE refresh_tokens SET revoked_at = now(), replaced_by_id = $1 WHERE id = $2',
      [replacement.refreshTokenId, stored.id],
    );
    await client.query('COMMIT');
    return { access_token: replacement.accessToken, refresh_token: replacement.refreshToken };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const logout = async (token: string) => {
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1',
    [hashToken(token)],
  );
};
