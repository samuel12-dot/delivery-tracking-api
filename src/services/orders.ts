import type { AuthContext } from '../domain/auth.js';
import type { OrderStatus } from '../domain/order-status.js';
import { db } from '../lib/postgres.js';
import { HttpError } from '../middleware/errors.js';
import { writeOrderStatusChange } from './order-events.js';

interface OrderAccess {
  customer_id: string;
  merchant_user_id: string;
  driver_user_id: string | null;
}

export const canViewOrder = (actor: AuthContext, order: OrderAccess): boolean =>
  actor.role === 'admin'
  || (actor.role === 'customer' && actor.userId === order.customer_id)
  || (actor.role === 'merchant' && actor.userId === order.merchant_user_id)
  || (actor.role === 'driver' && actor.userId === order.driver_user_id);

const assertOrderAccess = (actor: AuthContext, order: OrderAccess) => {
  if (!canViewOrder(actor, order)) throw new HttpError(403, 'Forbidden', 'You cannot access this order');
};

export const createOrder = async (
  customerId: string,
  merchantId: string,
  dropoff: { lat: number; lng: number },
) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ id: string; status: OrderStatus; created_at: Date }>(
      `INSERT INTO orders (customer_id, merchant_id, pickup_location, dropoff_location)
       SELECT $1, m.id, m.location,
              ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
       FROM merchants m WHERE m.id = $4
       RETURNING id, status, created_at`,
      [customerId, dropoff.lat, dropoff.lng, merchantId],
    );
    const order = result.rows[0];
    if (!order) throw new HttpError(404, 'Merchant not found', `Merchant ${merchantId} does not exist`);
    const event = await writeOrderStatusChange(client, order.id, null, 'placed', customerId);
    await client.query('COMMIT');
    return { ...order, event_id: event.id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const orderDetailQuery = `
  SELECT o.id, o.status, o.customer_id, o.merchant_id, o.driver_id,
         o.estimated_delivery_at, o.created_at, o.updated_at,
         ST_AsGeoJSON(o.pickup_location)::json AS pickup_location,
         ST_AsGeoJSON(o.dropoff_location)::json AS dropoff_location,
         m.name AS merchant_name, m.user_id AS merchant_user_id,
         d.user_id AS driver_user_id, du.full_name AS driver_name,
         d.vehicle_type, d.location_updated_at,
         CASE WHEN d.current_location IS NULL THEN NULL
              ELSE ST_AsGeoJSON(d.current_location)::json END AS driver_location
  FROM orders o
  JOIN merchants m ON m.id = o.merchant_id
  LEFT JOIN drivers d ON d.id = o.driver_id
  LEFT JOIN users du ON du.id = d.user_id
  WHERE o.id = $1`;

export const getOrder = async (orderId: string, actor: AuthContext) => {
  const result = await db.query<OrderAccess & Record<string, unknown>>(orderDetailQuery, [orderId]);
  const order = result.rows[0];
  if (!order) throw new HttpError(404, 'Order not found', `Order ${orderId} does not exist`);
  assertOrderAccess(actor, order);
  return order;
};

export const getOrderEvents = async (orderId: string, actor: AuthContext) => {
  await getOrder(orderId, actor);
  const result = await db.query(
    `SELECT id, from_status, to_status, changed_by,
            CASE WHEN changed_by_system THEN 'system' ELSE 'user' END AS actor_type,
            occurred_at, metadata
     FROM order_status_events WHERE order_id = $1
     ORDER BY occurred_at, id`,
    [orderId],
  );
  return result.rows;
};

export const assignNearestDriver = async (orderId: string, adminId: string, radiusKm = 50) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const orderResult = await client.query<{ id: string; status: OrderStatus }>(
      'SELECT id, status FROM orders WHERE id = $1 FOR UPDATE',
      [orderId],
    );
    const order = orderResult.rows[0];
    if (!order) throw new HttpError(404, 'Order not found', `Order ${orderId} does not exist`);
    if (order.status !== 'confirmed') {
      throw new HttpError(409, 'Order status conflict', `Driver assignment requires confirmed status; current status is ${order.status}`);
    }

    const driverResult = await client.query<{ id: string; distance_m: number }>(
      `SELECT d.id, ST_Distance(d.current_location, o.pickup_location) AS distance_m
       FROM drivers d CROSS JOIN orders o
       WHERE o.id = $1
         AND d.status = 'available'
         AND d.current_location IS NOT NULL
         AND ST_DWithin(d.current_location, o.pickup_location, $2)
         AND NOT EXISTS (
           SELECT 1 FROM orders active
           WHERE active.driver_id = d.id
             AND active.status IN ('driver_assigned', 'picked_up', 'in_transit')
         )
       ORDER BY distance_m, d.id
       LIMIT 1
       FOR UPDATE OF d SKIP LOCKED`,
      [orderId, radiusKm * 1000],
    );
    const driver = driverResult.rows[0];
    if (!driver) throw new HttpError(409, 'No driver available', `No available driver was found within ${radiusKm} km`);

    await client.query(
      `UPDATE orders SET driver_id = $1, status = 'driver_assigned', updated_at = now()
       WHERE id = $2`,
      [driver.id, orderId],
    );
    await client.query("UPDATE drivers SET status = 'en_route' WHERE id = $1", [driver.id]);
    const event = await writeOrderStatusChange(client, orderId, 'confirmed', 'driver_assigned', adminId);
    await client.query('COMMIT');
    return { order_id: orderId, driver_id: driver.id, distance_m: Number(driver.distance_m), event_id: event.id };
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new HttpError(409, 'Driver assignment conflict', 'The selected driver was assigned concurrently');
    }
    throw error;
  } finally {
    client.release();
  }
};

export const getOrderEta = async (orderId: string, actor: AuthContext) => {
  await getOrder(orderId, actor);
  const result = await db.query<{ distance_m: number | null; vehicle_type: string | null }>(
    `SELECT CASE WHEN d.current_location IS NULL THEN NULL
                 ELSE ST_Distance(d.current_location, o.dropoff_location) END AS distance_m,
            d.vehicle_type
     FROM orders o LEFT JOIN drivers d ON d.id = o.driver_id WHERE o.id = $1`,
    [orderId],
  );
  const row = result.rows[0];
  if (!row || row.distance_m === null || !row.vehicle_type) {
    throw new HttpError(409, 'ETA unavailable', 'A driver with a current location has not been assigned');
  }
  const speedKmh = { bike: 20, car: 30, van: 25 }[row.vehicle_type] ?? 25;
  const durationSeconds = Math.ceil((Number(row.distance_m) / 1000 / speedKmh) * 3600);
  return {
    distance_m: Number(row.distance_m),
    assumed_speed_kmh: speedKmh,
    duration_seconds: durationSeconds,
    estimated_arrival_at: new Date(Date.now() + durationSeconds * 1000),
  };
};

export const encodeOrderCursor = (createdAt: Date, id: string): string =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');

export const decodeOrderCursor = (cursor: string): { createdAt: Date; id: string } => {
  const [dateValue, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(dateValue ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) throw new HttpError(400, 'Invalid cursor', 'The pagination cursor is invalid');
  return { createdAt, id };
};

export const listCustomerOrders = async (customerId: string, limit: number, cursor?: string) => {
  const decoded = cursor ? decodeOrderCursor(cursor) : undefined;
  const result = await db.query<{ id: string; status: OrderStatus; merchant_id: string; created_at: Date }>(
    `SELECT id, status, merchant_id, created_at FROM orders
     WHERE customer_id = $1
       AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3::uuid))
     ORDER BY created_at DESC, id DESC LIMIT $4`,
    [customerId, decoded?.createdAt ?? null, decoded?.id ?? null, limit + 1],
  );
  const hasMore = result.rows.length > limit;
  const data = result.rows.slice(0, limit);
  const last = data.at(-1);
  return { data, next_cursor: hasMore && last ? encodeOrderCursor(last.created_at, last.id) : null };
};

