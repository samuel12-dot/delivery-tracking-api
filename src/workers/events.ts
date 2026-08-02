import type { PoolClient } from 'pg';
import { db } from '../lib/postgres.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { nextWebhookRetry, signWebhookPayload, webhookMaxAttempts } from '../services/webhooks.js';

interface ClaimedDelivery {
  id: string;
  attempt_count: number;
  url: string;
  secret: string;
  event_id: string;
  order_id: string;
  from_status: string | null;
  to_status: string;
  occurred_at: Date;
}

const claimWebhookDelivery = async (client: PoolClient): Promise<ClaimedDelivery | undefined> => {
  await client.query('BEGIN');
  try {
    const result = await client.query<ClaimedDelivery>(
      `SELECT wd.id, wd.attempt_count, w.url, w.secret,
              ose.id AS event_id, ose.order_id, ose.from_status,
              ose.to_status, ose.occurred_at
       FROM webhook_deliveries wd
       JOIN webhooks w ON w.id = wd.webhook_id
       JOIN order_status_events ose ON ose.id = wd.order_status_event_id
       WHERE wd.status IN ('pending', 'failed')
         AND (wd.next_retry_at IS NULL OR wd.next_retry_at <= now())
         AND w.is_active = true
       ORDER BY COALESCE(wd.next_retry_at, wd.created_at), wd.id
       FOR UPDATE OF wd SKIP LOCKED LIMIT 1`,
    );
    const delivery = result.rows[0];
    if (!delivery) {
      await client.query('COMMIT');
      return undefined;
    }
    delivery.attempt_count += 1;
    await client.query(
      `UPDATE webhook_deliveries
       SET attempt_count = $2, last_attempted_at = now(), next_retry_at = now() + interval '30 seconds'
       WHERE id = $1`,
      [delivery.id, delivery.attempt_count],
    );
    await client.query('COMMIT');
    return delivery;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
};

export const processOneWebhookDelivery = async (
  fetcher: typeof fetch = fetch,
): Promise<boolean> => {
  const client = await db.connect();
  let delivery: ClaimedDelivery | undefined;
  try {
    delivery = await claimWebhookDelivery(client);
  } finally {
    client.release();
  }
  if (!delivery) return false;

  const payload = JSON.stringify({
    event_id: delivery.event_id,
    type: 'order.status_changed',
    order_id: delivery.order_id,
    from_status: delivery.from_status,
    to_status: delivery.to_status,
    occurred_at: delivery.occurred_at,
  });
  let responseStatus: number | null = null;
  let succeeded = false;
  try {
    const response = await fetcher(delivery.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': signWebhookPayload(payload, delivery.secret),
        'x-event-id': delivery.event_id,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });
    responseStatus = response.status;
    succeeded = response.ok;
  } catch (error: unknown) {
    logger.warn({ err: error, deliveryId: delivery.id }, 'webhook request failed');
  }

  if (succeeded) {
    await db.query(
      `UPDATE webhook_deliveries
       SET status = 'succeeded', response_status_code = $2, next_retry_at = NULL
       WHERE id = $1`,
      [delivery.id, responseStatus],
    );
  } else {
    const retryAt = nextWebhookRetry(delivery.attempt_count);
    await db.query(
      `UPDATE webhook_deliveries
       SET status = $2, response_status_code = $3, next_retry_at = $4
       WHERE id = $1`,
      [delivery.id, delivery.attempt_count >= webhookMaxAttempts ? 'exhausted' : 'failed', responseStatus, retryAt],
    );
  }
  return true;
};

export const processOutboxBatch = async (limit = 50): Promise<number> => {
  const client = await db.connect();
  let published = 0;
  try {
    await client.query('BEGIN');
    const result = await client.query<{ id: string; aggregate_id: string; payload: Record<string, unknown>; attempt_count: number }>(
      `SELECT id, aggregate_id, payload, attempt_count FROM outbox_events
       WHERE status IN ('pending', 'failed') AND available_at <= now()
       ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT $1`,
      [limit],
    );
    for (const event of result.rows) {
      try {
        await redis.publish(
          `order:${event.aggregate_id}:events`,
          JSON.stringify({ type: 'status_changed', ...event.payload }),
        );
        await client.query(
          "UPDATE outbox_events SET status = 'published', published_at = now(), attempt_count = attempt_count + 1 WHERE id = $1",
          [event.id],
        );
        published += 1;
      } catch (error: unknown) {
        await client.query(
          `UPDATE outbox_events SET status = 'failed', attempt_count = attempt_count + 1,
             available_at = now() + make_interval(secs => LEAST(300, power(2, $2)::integer)), last_error = $3
           WHERE id = $1`,
          [event.id, event.attempt_count, error instanceof Error ? error.message : 'Redis publish failed'],
        );
      }
    }
    await client.query('COMMIT');
    return published;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const startEventWorkers = () => {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await processOutboxBatch();
      for (let index = 0; index < 20; index += 1) {
        if (!(await processOneWebhookDelivery())) break;
      }
    } catch (error: unknown) {
      logger.error({ err: error }, 'background event worker tick failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 1_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
};

