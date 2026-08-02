import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('location update ordering contract', () => {
  it('stores every ping but conditionally advances the current location', async () => {
    const source = await readFile(new URL('../src/services/drivers.ts', import.meta.url), 'utf8');
    expect(source).toContain('INSERT INTO location_pings');
    expect(source).toContain('location_updated_at IS NULL OR location_updated_at < $4');
    expect(source.indexOf('INSERT INTO location_pings')).toBeLessThan(source.indexOf('SET current_location'));
  });
});
