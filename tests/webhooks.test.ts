import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/postgres.js';
import {
  nextWebhookRetry,
  signWebhookPayload,
  webhookMaxAttempts,
  webhookRetryDelaysMs,
} from '../src/services/webhooks.js';
import { processOneWebhookDelivery } from '../src/workers/events.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('webhook signing', () => {
  it('signs the exact serialized body using HMAC-SHA256', () => {
    const payload = JSON.stringify({ event_id: 'event-1', to_status: 'delivered' });
    const expected = createHmac('sha256', 'secret').update(payload).digest('hex');
    expect(signWebhookPayload(payload, 'secret')).toBe(`sha256=${expected}`);
    expect(signWebhookPayload(`${payload} `, 'secret')).not.toBe(`sha256=${expected}`);
  });
});

describe('webhook retry policy', () => {
  it('uses the documented exponential schedule and then exhausts', () => {
    const now = new Date('2026-08-02T12:00:00.000Z').getTime();
    expect(webhookRetryDelaysMs).toEqual([1_000, 5_000, 30_000, 300_000, 1_800_000]);
    for (let attempt = 1; attempt < webhookMaxAttempts; attempt += 1) {
      expect(nextWebhookRetry(attempt, now)?.getTime()).toBe(now + webhookRetryDelaysMs[attempt - 1]!);
    }
    expect(nextWebhookRetry(webhookMaxAttempts, now)).toBeNull();
  });

  const runFailedAttempt = async (previousAttempts: number) => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{
          id: 'delivery-id',
          attempt_count: previousAttempts,
          url: 'https://merchant.example/webhooks',
          secret: 'secret',
          event_id: 'event-id',
          order_id: 'order-id',
          from_status: 'confirmed',
          to_status: 'driver_assigned',
          occurred_at: new Date('2026-08-02T12:00:00.000Z'),
        }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    vi.spyOn(db, 'connect').mockResolvedValue(client as never);
    const persisted = vi.spyOn(db, 'query').mockResolvedValue(undefined as never);
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    await processOneWebhookDelivery(fetcher);
    return { persisted, fetcher };
  };

  it('persists a failed attempt with the next retry time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
    const { persisted, fetcher } = await runFailedAttempt(0);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ 'x-event-id': 'event-id' });
    expect(persisted.mock.calls[0]?.[1]).toEqual([
      'delivery-id',
      'failed',
      503,
      new Date('2026-08-02T12:00:01.000Z'),
    ]);
  });

  it('marks the delivery exhausted after the final failed attempt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
    const { persisted } = await runFailedAttempt(webhookMaxAttempts - 1);
    expect(persisted.mock.calls[0]?.[1]).toEqual(['delivery-id', 'exhausted', 503, null]);
  });
});
