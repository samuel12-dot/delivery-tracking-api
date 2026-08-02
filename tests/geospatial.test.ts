import { describe, expect, it } from 'vitest';
import { nearbyDriversQuery } from '../src/services/drivers.js';

describe('nearby-driver PostGIS query', () => {
  it('uses indexed geography predicates and database-side distance ordering', () => {
    expect(nearbyDriversQuery).toContain('ST_DWithin(');
    expect(nearbyDriversQuery).toContain('ST_Distance(');
    expect(nearbyDriversQuery).toContain("d.status = 'available'");
    expect(nearbyDriversQuery).toContain('ORDER BY distance_m');
    expect(nearbyDriversQuery).not.toMatch(/haversine/i);
  });

  it('constructs the query point in longitude-latitude order and receives radius in metres', () => {
    expect(nearbyDriversQuery).toContain('ST_MakePoint($2, $1)');
    expect(nearbyDriversQuery).toContain('$3');
  });
});

