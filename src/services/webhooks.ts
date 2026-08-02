import { createHmac, randomBytes } from 'node:crypto';
import { db } from '../lib/postgres.js';
import { HttpError } from '../middleware/errors.js';

export const webhookRetryDelaysMs = [1_000, 5_000, 30_000, 300_000, 1_800_000] as const;
export const webhookMaxAttempts = webhookRetryDelaysMs.length + 1;

export const signWebhookPayload = (payload: string, secret: string): string =>
  `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;

export const nextWebhookRetry = (attemptCount: number, now = Date.now()): Date | null => {
  if (attemptCount >= webhookMaxAttempts) return null;
  const delay = webhookRetryDelaysMs[attemptCount - 1];
  return delay === undefined ? null : new Date(now + delay);
};

export const registerWebhook = async (merchantUserId: string, url: string) => {
  const secret = randomBytes(32).toString('base64url');
  const result = await db.query<{ id: string; url: string; is_active: boolean; created_at: Date }>(
    `INSERT INTO webhooks (merchant_id, url, secret)
     SELECT id, $2, $3 FROM merchants WHERE user_id = $1
     RETURNING id, url, is_active, created_at`,
    [merchantUserId, url, secret],
  );
  const webhook = result.rows[0];
  if (!webhook) throw new HttpError(404, 'Merchant not found', 'No merchant profile exists for this user');
  return { ...webhook, secret };
};

export const listWebhooks = async (merchantUserId: string) => {
  const result = await db.query(
    `SELECT w.id, w.url, w.is_active, w.created_at
     FROM webhooks w JOIN merchants m ON m.id = w.merchant_id
     WHERE m.user_id = $1 ORDER BY w.created_at DESC, w.id DESC`,
    [merchantUserId],
  );
  return result.rows;
};

export const deactivateWebhook = async (merchantUserId: string, webhookId: string) => {
  const result = await db.query(
    `UPDATE webhooks w SET is_active = false
     FROM merchants m
     WHERE w.id = $1 AND w.merchant_id = m.id AND m.user_id = $2
     RETURNING w.id`,
    [webhookId, merchantUserId],
  );
  if (result.rowCount !== 1) throw new HttpError(404, 'Webhook not found', `Webhook ${webhookId} does not exist`);
};

export const listWebhookDeliveries = async (merchantUserId: string, webhookId: string, limit: number) => {
  const ownership = await db.query(
    `SELECT 1 FROM webhooks w JOIN merchants m ON m.id = w.merchant_id
     WHERE w.id = $1 AND m.user_id = $2`,
    [webhookId, merchantUserId],
  );
  if (ownership.rowCount !== 1) throw new HttpError(404, 'Webhook not found', `Webhook ${webhookId} does not exist`);

  const result = await db.query(
    `SELECT wd.id, wd.order_status_event_id AS event_id, wd.status,
            wd.attempt_count, wd.last_attempted_at, wd.next_retry_at,
            wd.response_status_code, wd.created_at
     FROM webhook_deliveries wd WHERE wd.webhook_id = $1
     ORDER BY wd.created_at DESC, wd.id DESC LIMIT $2`,
    [webhookId, limit],
  );
  return result.rows;
};

