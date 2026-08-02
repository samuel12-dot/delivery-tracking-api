import { Router } from 'express';
import { z } from 'zod';
import { orderStatuses } from '../domain/order-status.js';
import { authenticate } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { transitionOrder } from '../services/order-transitions.js';

const paramsSchema = z.object({ id: z.uuid() });
const transitionSchema = z.object({
  to_status: z.enum(orderStatuses),
  expected_status: z.enum(orderStatuses).optional(),
});

export const ordersRouter = Router();
ordersRouter.use(authenticate);

ordersRouter.post('/:id/transition', async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  const body = transitionSchema.parse(req.body);
  if (!req.auth) throw new HttpError(401, 'Unauthorized', 'Authentication is required');
  const result = await transitionOrder(id, body.to_status, req.auth, body.expected_status);
  res.send(result);
});

