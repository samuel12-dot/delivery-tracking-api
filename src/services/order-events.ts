import type { PoolClient } from 'pg';
import type { OrderStatus } from '../domain/order-status.js';

export const writeOrderStatusChange = async (
  client: PoolClient,
  orderId: string,
  fromStatus: OrderStatus | null,
  toStatus: OrderStatus,
  changedBy: string | null,
) => {
  const eventResult = await client.query<{ id: string; occurred_at: Date }>(
    `INSERT INTO order_status_events
       (order_id, from_status, to_status, changed_by, changed_by_system)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, occurred_at`,
    [orderId, fromStatus, toStatus, changedBy, changedBy === null],
  );
  const event = eventResult.rows[0];
  if (!event) throw new Error('Status event insert returned no row');

  await client.query(
    `INSERT INTO webhook_deliveries (webhook_id, order_status_event_id)
     SELECT w.id, $1
     FROM webhooks w
     JOIN orders o ON o.merchant_id = w.merchant_id
     WHERE o.id = $2 AND w.is_active = true
     ON CONFLICT (webhook_id, order_status_event_id) DO NOTHING`,
    [event.id, orderId],
  );
  await client.query(
    `INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload)
     VALUES ('order.status_changed', 'order', $1,
       jsonb_build_object(
         'event_id', $2::text,
         'order_id', $1::text,
         'from_status', $3::text,
         'to_status', $4::text,
         'occurred_at', $5::timestamptz
       ))`,
    [orderId, event.id, fromStatus, toStatus, event.occurred_at],
  );
  return event;
};

