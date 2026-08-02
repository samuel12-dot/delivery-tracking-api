import { db } from '../lib/postgres.js';
import type { AuthContext, UserRole } from '../domain/auth.js';
import { assertTransition, type OrderStatus } from '../domain/order-status.js';
import { HttpError } from '../middleware/errors.js';
import { writeOrderStatusChange } from './order-events.js';

interface LockedOrder {
  id: string;
  status: OrderStatus;
  customer_id: string;
  merchant_user_id: string;
  driver_user_id: string | null;
}

const allowedTargets: Readonly<Record<UserRole, readonly OrderStatus[]>> = {
  admin: ['confirmed', 'driver_assigned', 'picked_up', 'in_transit', 'delivered', 'cancelled', 'failed'],
  customer: ['cancelled'],
  merchant: ['confirmed', 'cancelled'],
  driver: ['picked_up', 'in_transit', 'delivered', 'failed'],
};

export const actorCanTransition = (actor: AuthContext, order: LockedOrder, target: OrderStatus): boolean => {
  if (!allowedTargets[actor.role].includes(target)) return false;
  if (actor.role === 'admin') return true;
  if (actor.role === 'customer') return order.customer_id === actor.userId;
  if (actor.role === 'merchant') return order.merchant_user_id === actor.userId;
  return order.driver_user_id === actor.userId;
};

export const transitionOrder = async (
  orderId: string,
  toStatus: OrderStatus,
  actor: AuthContext,
  expectedStatus?: OrderStatus,
) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<LockedOrder>(
      `SELECT o.id, o.status, o.customer_id, m.user_id AS merchant_user_id,
              du.id AS driver_user_id
       FROM orders o
       JOIN merchants m ON m.id = o.merchant_id
       LEFT JOIN drivers d ON d.id = o.driver_id
       LEFT JOIN users du ON du.id = d.user_id
       WHERE o.id = $1
       FOR UPDATE OF o`,
      [orderId],
    );
    const order = result.rows[0];
    if (!order) throw new HttpError(404, 'Order not found', `Order ${orderId} does not exist`);

    if (expectedStatus && order.status !== expectedStatus) {
      throw new HttpError(
        409,
        'Order status conflict',
        `Expected ${expectedStatus}, but the current status is ${order.status}`,
      );
    }
    if (!actorCanTransition(actor, order, toStatus)) {
      throw new HttpError(403, 'Forbidden', 'You cannot perform this order transition');
    }
    assertTransition(order.status, toStatus);

    await client.query(
      'UPDATE orders SET status = $1, updated_at = now() WHERE id = $2',
      [toStatus, orderId],
    );
    const event = await writeOrderStatusChange(client, orderId, order.status, toStatus, actor.userId);
    await client.query('COMMIT');

    return {
      order_id: orderId,
      from_status: order.status,
      to_status: toStatus,
      event_id: event.id,
      occurred_at: event.occurred_at,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
