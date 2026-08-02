import { HttpError } from '../middleware/errors.js';

export const orderStatuses = [
  'placed',
  'confirmed',
  'driver_assigned',
  'picked_up',
  'in_transit',
  'delivered',
  'cancelled',
  'failed',
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

export const orderTransitions: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  placed: ['confirmed', 'cancelled'],
  confirmed: ['driver_assigned', 'cancelled'],
  driver_assigned: ['picked_up', 'cancelled'],
  picked_up: ['in_transit'],
  in_transit: ['delivered', 'failed'],
  delivered: [],
  cancelled: [],
  failed: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  orderTransitions[from].includes(to);

export const assertTransition = (from: OrderStatus, to: OrderStatus): void => {
  if (!canTransition(from, to)) {
    throw new HttpError(422, 'Invalid order transition', `${from} cannot transition to ${to}`);
  }
};

