import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);
const KEY_LENGTH = 64;

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
};

export const verifyPassword = async (password: string, encoded: string): Promise<boolean> => {
  const [algorithm, saltEncoded, hashEncoded] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltEncoded || !hashEncoded) return false;

  const expected = Buffer.from(hashEncoded, 'base64url');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await scrypt(password, Buffer.from(saltEncoded, 'base64url'), KEY_LENGTH) as Buffer;
  return timingSafeEqual(actual, expected);
};

