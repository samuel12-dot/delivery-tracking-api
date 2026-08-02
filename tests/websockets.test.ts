import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { issueTokenPair } from '../src/lib/tokens.js';
import { HttpError } from '../src/middleware/errors.js';
import { attachOrderWebSockets } from '../src/realtime/order-websockets.js';

const orderId = 'f793db0e-8821-48d9-9645-571bffc8255f';
const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((item) => item.close()));
});

const startGateway = async (authorized: boolean) => {
  const server = createServer(createApp());
  const gateway = attachOrderWebSockets(server, {
    subscribeToRedis: false,
    authorize: async () => {
      if (!authorized) throw new HttpError(403, 'Forbidden', 'You cannot access this order');
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  servers.push({
    close: async () => {
      await gateway.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  });
  return { gateway, url: `ws://127.0.0.1:${address.port}/ws/orders/${orderId}` };
};

describe('order WebSocket gateway', () => {
  it('accepts an authenticated authorized subscriber and forwards order events', async () => {
    const { gateway, url } = await startGateway(true);
    const token = issueTokenPair('144693ae-f7ea-4ae8-8d95-c00519ee3434', 'customer').accessToken;
    const socket = new WebSocket(`${url}?access_token=${token}`);
    const [firstMessage] = await once(socket, 'message');
    expect(JSON.parse(firstMessage.toString())).toEqual({ type: 'subscribed', order_id: orderId });

    const eventPromise = once(socket, 'message');
    gateway.broadcast(orderId, JSON.stringify({ type: 'status_changed', to_status: 'confirmed' }));
    const [event] = await eventPromise;
    expect(JSON.parse(event.toString())).toMatchObject({ type: 'status_changed', to_status: 'confirmed' });
    socket.close();
  });

  it('rejects a valid token when order authorization fails', async () => {
    const { url } = await startGateway(false);
    const token = issueTokenPair('88108268-7eed-42e3-a15f-3b06ea10e34a', 'customer').accessToken;
    const socket = new WebSocket(`${url}?access_token=${token}`);
    const [error] = await once(socket, 'error');
    expect((error as Error).message).toContain('Unexpected server response: 403');
  });

  it('rejects a handshake without authentication', async () => {
    const { url } = await startGateway(true);
    const socket = new WebSocket(url);
    const [error] = await once(socket, 'error');
    expect((error as Error).message).toContain('Unexpected server response: 401');
  });
});
