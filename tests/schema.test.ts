import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL('../migrations/001_initial_schema.sql', import.meta.url);

describe('initial database schema', () => {
  it('enables PostGIS and creates geography columns with GiST indexes', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS postgis');
    expect(sql.match(/geography\(Point, 4326\)/g)).toHaveLength(5);
    expect(sql.match(/USING gist/g)).toHaveLength(5);
  });

  it('enforces at most one active order per driver in the database', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    expect(sql).toContain('CREATE UNIQUE INDEX orders_one_active_per_driver_idx');
    expect(sql).toContain("status IN ('driver_assigned', 'picked_up', 'in_transit')");
  });

  it('includes durable audit, webhook delivery, refresh-token, and outbox storage', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    for (const table of ['order_status_events', 'webhook_deliveries', 'refresh_tokens', 'outbox_events']) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
  });
});
