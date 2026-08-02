import { describe, expect, it } from 'vitest';
import { canViewOrder, decodeOrderCursor, encodeOrderCursor } from '../src/services/orders.js';

describe('order access rules', () => {
  const order = { customer_id: 'customer', merchant_user_id: 'merchant', driver_user_id: 'driver' };

  it('allows only participants or administrators', () => {
    expect(canViewOrder({ userId: 'customer', role: 'customer' }, order)).toBe(true);
    expect(canViewOrder({ userId: 'merchant', role: 'merchant' }, order)).toBe(true);
    expect(canViewOrder({ userId: 'driver', role: 'driver' }, order)).toBe(true);
    expect(canViewOrder({ userId: 'admin', role: 'admin' }, order)).toBe(true);
    expect(canViewOrder({ userId: 'stranger', role: 'customer' }, order)).toBe(false);
  });
});

describe('order pagination cursor', () => {
  it('round-trips the stable timestamp and UUID tuple', () => {
    const createdAt = new Date('2026-08-02T12:34:56.000Z');
    const id = '0cc17566-9efc-4f89-b04a-9af8b31c1d7d';
    expect(decodeOrderCursor(encodeOrderCursor(createdAt, id))).toEqual({ createdAt, id });
  });

  it('rejects malformed cursors', () => {
    expect(() => decodeOrderCursor('not-a-valid-cursor')).toThrow('pagination cursor is invalid');
  });
});
