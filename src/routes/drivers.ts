import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { findNearbyDrivers, recordDriverLocation, updateDriverStatus } from '../services/drivers.js';
import { createRateLimit } from '../middleware/rate-limit.js';

const statusSchema = z.object({ status: z.enum(['offline', 'available', 'unavailable']) });
const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  recorded_at: z.iso.datetime({ offset: true }),
});
const nearbySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius_km: z.coerce.number().positive().max(100),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export const driversRouter = Router();
driversRouter.use(authenticate);
const locationRateLimit = createRateLimit({ keyPrefix: 'driver_location', capacity: 30, refillPerSecond: 1 });

driversRouter.patch('/me/status', authorize('driver'), async (req, res) => {
  const body = statusSchema.parse(req.body);
  if (!req.auth) throw new HttpError(401, 'Unauthorized', 'Authentication is required');
  res.send(await updateDriverStatus(req.auth.userId, body.status));
});

driversRouter.post('/me/location', authorize('driver'), locationRateLimit, async (req, res) => {
  const body = locationSchema.parse(req.body);
  if (!req.auth) throw new HttpError(401, 'Unauthorized', 'Authentication is required');
  const result = await recordDriverLocation(req.auth.userId, {
    lat: body.lat,
    lng: body.lng,
    recordedAt: new Date(body.recorded_at),
  });
  res.status(202).send(result);
});

driversRouter.get('/nearby', async (req, res) => {
  const query = nearbySchema.parse(req.query);
  const drivers = await findNearbyDrivers(query.lat, query.lng, query.radius_km, query.limit);
  res.send({ data: drivers });
});
