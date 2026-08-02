import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { listCustomerOrders } from '../services/orders.js';

const paginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export const customersRouter = Router();
customersRouter.use(authenticate, authorize('customer'));

customersRouter.get('/me/orders', async (req, res) => {
  const query = paginationSchema.parse(req.query);
  if (!req.auth) throw new HttpError(401, 'Unauthorized', 'Authentication is required');
  res.send(await listCustomerOrders(req.auth.userId, query.limit, query.cursor));
});

