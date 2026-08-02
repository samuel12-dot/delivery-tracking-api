import { Router } from 'express';
import { z } from 'zod';
import { login, logout, register, rotateRefreshToken } from '../services/auth.js';

const coordinates = z.object({
  name: z.string().trim().min(1).max(150),
  address: z.string().trim().min(1).max(500),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(12).max(128),
  full_name: z.string().trim().min(2).max(150),
  role: z.enum(['customer', 'driver', 'merchant']),
  vehicle_type: z.enum(['bike', 'car', 'van']).optional(),
  merchant: coordinates.optional(),
});
const loginSchema = z.object({ email: z.email(), password: z.string().min(1).max(128) });
const refreshSchema = z.object({ refresh_token: z.string().min(1) });

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const body = registerSchema.parse(req.body);
  const result = await register({
    email: body.email,
    password: body.password,
    fullName: body.full_name,
    role: body.role,
    ...(body.vehicle_type ? { vehicleType: body.vehicle_type } : {}),
    ...(body.merchant ? { merchant: body.merchant } : {}),
  });
  res.status(201).send(result);
});

authRouter.post('/login', async (req, res) => {
  const body = loginSchema.parse(req.body);
  res.send(await login(body.email, body.password));
});

authRouter.post('/refresh', async (req, res) => {
  const body = refreshSchema.parse(req.body);
  res.send({ tokens: await rotateRefreshToken(body.refresh_token) });
});

authRouter.post('/logout', async (req, res) => {
  const body = refreshSchema.parse(req.body);
  await logout(body.refresh_token);
  res.status(204).send();
});

