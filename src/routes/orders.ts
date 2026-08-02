import { Router } from 'express';
import { z } from 'zod';
import { orderStatuses } from '../domain/order-status.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { transitionOrder } from '../services/order-transitions.js';
import {
  assignNearestDriver,
  createOrder,
  getOrder,
  getOrderEta,
  getOrderEvents,
} from '../services/orders.js';

const paramsSchema = z.object({ id: z.uuid() });
const transitionSchema = z.object({
  to_status: z.enum(orderStatuses),
  expected_status: z.enum(orderStatuses).optional(),
});

export const ordersRouter = Router();
ordersRouter.use(authenticate);

const createSchema = z.object({
  merchant_id: z.uuid(),
  dropoff: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
});

ordersRouter.post('/', authorize('customer'), async (req, res) => {
  const body = createSchema.parse(req.body);
  if (!req.auth) throw new HttpError(401, 'Unauthorized', 'Authentication is required');
  res.status(201).send(await createOrder(req.auth.userId, body.merchant_id, body.dropoff));
});

ordersRouter.get('/:id', async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  if (!req.auth) throw new HttpError(401, 'Unauthorized', 'Authentication is required');
  res.send(await getOrder(id, req.auth));
});

ordersRouter.post('/:id/assign-driver', authorize('admin'), async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  if (!req.auth) throw new HttpError(401, 'Unauthorized', 'Authentication is required');
  res.send(await assignNearestDriver(id, req.auth.userId));
});

ordersRouter.get('/:id/events', async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  if (!req.auth) throw new HttpError(401, 'Unauthorized', 'Authentication is required');
  res.send({ data: await getOrderEvents(id, req.auth) });
});

ordersRouter.get('/:id/eta', async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  if (!req.auth) throw new HttpError(401, 'Unauthorized', 'Authentication is required');
  res.send(await getOrderEta(id, req.auth));
});

ordersRouter.post('/:id/transition', async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  const body = transitionSchema.parse(req.body);
  if (!req.auth) throw new HttpError(401, 'Unauthorized', 'Authentication is required');
  const result = await transitionOrder(id, body.to_status, req.auth, body.expected_status);
  res.send(result);
});
