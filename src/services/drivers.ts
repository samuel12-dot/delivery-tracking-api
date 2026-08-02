import { db } from '../lib/postgres.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { HttpError } from '../middleware/errors.js';
import { locationPingDuration } from '../lib/metrics.js';

interface LocationInput { lat: number; lng: number; recordedAt: Date }

export interface NearbyDriver {
  id: string;
  user_id: string;
  full_name: string;
  vehicle_type: 'bike' | 'car' | 'van';
  lat: number;
  lng: number;
  distance_m: number;
  location_updated_at: Date;
}

export const nearbyDriversQuery = `
  SELECT d.id, d.user_id, u.full_name, d.vehicle_type,
         ST_Y(d.current_location::geometry) AS lat,
         ST_X(d.current_location::geometry) AS lng,
         ST_Distance(
           d.current_location,
           ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
         ) AS distance_m,
         d.location_updated_at
  FROM drivers d
  JOIN users u ON u.id = d.user_id
  WHERE d.status = 'available'
    AND d.current_location IS NOT NULL
    AND ST_DWithin(
      d.current_location,
      ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
      $3
    )
  ORDER BY distance_m, d.id
  LIMIT $4`;

export const findNearbyDrivers = async (
  lat: number,
  lng: number,
  radiusKm: number,
  limit = 50,
): Promise<NearbyDriver[]> => {
  const result = await db.query<NearbyDriver>(nearbyDriversQuery, [lat, lng, radiusKm * 1000, limit]);
  return result.rows.map((row) => ({
    ...row,
    lat: Number(row.lat),
    lng: Number(row.lng),
    distance_m: Number(row.distance_m),
  }));
};

export const updateDriverStatus = async (
  userId: string,
  status: 'offline' | 'available' | 'unavailable',
) => {
  const result = await db.query<{ id: string; status: string }>(
    `UPDATE drivers SET status = $1
     WHERE user_id = $2
     RETURNING id, status`,
    [status, userId],
  );
  const driver = result.rows[0];
  if (!driver) throw new HttpError(404, 'Driver not found', 'No driver profile exists for this user');
  return driver;
};

export const recordDriverLocation = async (userId: string, input: LocationInput) => {
  const stopTimer = locationPingDuration.startTimer();
  const client = await db.connect();
  let driverId: string;
  let updated = false;
  let activeOrderIds: string[] = [];

  try {
    await client.query('BEGIN');
    const driverResult = await client.query<{ id: string }>(
      'SELECT id FROM drivers WHERE user_id = $1',
      [userId],
    );
    const driver = driverResult.rows[0];
    if (!driver) throw new HttpError(404, 'Driver not found', 'No driver profile exists for this user');
    driverId = driver.id;

    await client.query(
      `INSERT INTO location_pings (driver_id, location, recorded_at)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)`,
      [driverId, input.lng, input.lat, input.recordedAt],
    );
    const updateResult = await client.query<{ id: string }>(
      `UPDATE drivers
       SET current_location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
           location_updated_at = $4
       WHERE id = $1
         AND (location_updated_at IS NULL OR location_updated_at < $4)
       RETURNING id`,
      [driverId, input.lng, input.lat, input.recordedAt],
    );
    updated = updateResult.rowCount === 1;

    if (updated) {
      const orders = await client.query<{ id: string }>(
        `SELECT id FROM orders
         WHERE driver_id = $1
           AND status IN ('driver_assigned', 'picked_up', 'in_transit')`,
        [driverId],
      );
      activeOrderIds = orders.rows.map((row) => row.id);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (updated) {
    const payload = JSON.stringify({
      type: 'driver_location_updated',
      driver_id: driverId,
      lat: input.lat,
      lng: input.lng,
      recorded_at: input.recordedAt.toISOString(),
    });
    const channels = [`driver:${driverId}:location`, ...activeOrderIds.map((id) => `order:${id}:events`)];
    await Promise.all(channels.map((channel) => redis.publish(channel, payload))).catch((error: unknown) => {
      logger.warn({ err: error, driverId }, 'location committed but live broadcast failed');
    });
  }

  stopTimer();
  return { accepted: true, current_location_updated: updated, driver_id: driverId };
};
