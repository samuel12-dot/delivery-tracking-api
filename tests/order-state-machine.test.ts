import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, orderStatuses, orderTransitions } from '../src/domain/order-status.js';
import { actorCanTransition } from '../src/services/order-transitions.js';

const validPairs = new Set([
  'placed:confirmed',
  'placed:cancelled',
  'confirmed:driver_assigned',
  'confirmed:cancelled',
  'driver_assigned:picked_up',
  'driver_assigned:cancelled',
  'picked_up:in_transit',
  'in_transit:delivered',
  'in_transit:failed',
]);

describe('order state machine', () => {
  it('has an explicit entry for every status', () => {
    expect(Object.keys(orderTransitions).sort()).toEqual([...orderStatuses].sort());
  });

  for (const from of orderStatuses) {
    for (const to of orderStatuses) {
      const expected = validPairs.has(`${from}:${to}`);
      it(`${expected ? 'allows' : 'rejects'} ${from} -> ${to}`, () => {
        expect(canTransition(from, to)).toBe(expected);
        if (expected) expect(() => assertTransition(from, to)).not.toThrow();
        else expect(() => assertTransition(from, to)).toThrow(`${from} cannot transition to ${to}`);
      });
    }
  }
});

describe('transition authorization', () => {
  const order = {
    id: 'order-id',
    status: 'driver_assigned' as const,
    customer_id: 'customer-id',
    merchant_user_id: 'merchant-id',
    driver_user_id: 'driver-id',
  };

  it('limits customers and merchants to their own orders and role-specific targets', () => {
    expect(actorCanTransition({ userId: 'customer-id', role: 'customer' }, order, 'cancelled')).toBe(true);
    expect(actorCanTransition({ userId: 'other', role: 'customer' }, order, 'cancelled')).toBe(false);
    expect(actorCanTransition({ userId: 'merchant-id', role: 'merchant' }, order, 'confirmed')).toBe(true);
    expect(actorCanTransition({ userId: 'merchant-id', role: 'merchant' }, order, 'delivered')).toBe(false);
  });

  it('allows only the assigned driver to progress delivery statuses', () => {
    expect(actorCanTransition({ userId: 'driver-id', role: 'driver' }, order, 'picked_up')).toBe(true);
    expect(actorCanTransition({ userId: 'other-driver', role: 'driver' }, order, 'picked_up')).toBe(false);
    expect(actorCanTransition({ userId: 'driver-id', role: 'driver' }, order, 'confirmed')).toBe(false);
  });

  it('allows an admin to perform any non-terminal target transition', () => {
    expect(actorCanTransition({ userId: 'admin-id', role: 'admin' }, order, 'delivered')).toBe(true);
    expect(actorCanTransition({ userId: 'admin-id', role: 'admin' }, order, 'placed')).toBe(false);
  });
});
