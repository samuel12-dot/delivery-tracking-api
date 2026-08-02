import pg from 'pg';
import { config } from '../config.js';

export const db = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
});

