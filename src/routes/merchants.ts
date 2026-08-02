import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { deactivateWebhook, listWebhookDeliveries, listWebhooks, registerWebhook } from '../services/webhooks.js';

const webhookParams = z.object({ id: z.uuid() });
const registerSchema = z.object({
  url: z.url().refine((value) => value.startsWith('https://'), 'Webhook URL must use HTTPS'),
});
const deliveryQuery = z.object({ limit: z.coerce.number().int().positive().max(100).default(50) });

export const merchantsRouter = Router();
merchantsRouter.use(authenticate, authorize('merchant'));

merchantsRouter.post('/me/webhooks', async (req, res) => {
  const body = registerSchema.parse(req.body);
  if (!req.auth) throw new HttpError(401, 'Unauthorized', 'Authentication is required');
  res.status(201).send(await registerWebhook(req.auth.userId, body.url));
});

merchantsRouter.get('/me/webhooks', async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Unauthorized', 'Authentication is required');
  res.send({ data: await listWebhooks(req.auth.userId) });
});

merchantsRouter.delete('/me/webhooks/:id', async (req, res) => {
  const { id } = webhookParams.parse(req.params);
  if (!req.auth) throw new HttpError(401, 'Unauthorized', 'Authentication is required');
  await deactivateWebhook(req.auth.userId, id);
  res.status(204).send();
});

merchantsRouter.get('/me/webhooks/:id/deliveries', async (req, res) => {
  const { id } = webhookParams.parse(req.params);
  const query = deliveryQuery.parse(req.query);
  if (!req.auth) throw new HttpError(401, 'Unauthorized', 'Authentication is required');
  res.send({ data: await listWebhookDeliveries(req.auth.userId, id, query.limit) });
});

