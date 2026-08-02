import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { AuthContext } from '../domain/auth.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { HttpError } from '../middleware/errors.js';
import { getOrder } from '../services/orders.js';

interface SubscriptionRequest {
  orderId: string;
  token: string;
}

type AuthorizeSubscription = (orderId: string, actor: AuthContext) => Promise<void>;

interface GatewayOptions {
  authorize?: AuthorizeSubscription;
  subscribeToRedis?: boolean;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const parseSubscriptionRequest = (request: IncomingMessage): SubscriptionRequest => {
  const url = new URL(request.url ?? '/', 'http://websocket.local');
  const match = /^\/ws\/orders\/([^/]+)$/.exec(url.pathname);
  const orderId = match?.[1];
  if (!orderId || !uuidPattern.test(orderId)) {
    throw new HttpError(404, 'Not Found', 'The WebSocket endpoint does not exist');
  }

  const [scheme, headerToken] = request.headers.authorization?.split(' ') ?? [];
  const token = scheme === 'Bearer' ? headerToken : url.searchParams.get('access_token');
  if (!token) throw new HttpError(401, 'Unauthorized', 'An access token is required for the WebSocket handshake');
  return { orderId, token };
};

const rejectUpgrade = (socket: Duplex, error: HttpError) => {
  const body = JSON.stringify({ type: error.type, title: error.title, status: error.status, detail: error.message });
  socket.write(
    `HTTP/1.1 ${error.status} ${error.title}\r\n`
    + 'Connection: close\r\n'
    + 'Content-Type: application/problem+json\r\n'
    + `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`
    + body,
  );
  socket.destroy();
};

const defaultAuthorize: AuthorizeSubscription = async (orderId, actor) => {
  await getOrder(orderId, actor);
};

export const attachOrderWebSockets = (server: Server, options: GatewayOptions = {}) => {
  const wss = new WebSocketServer({ noServer: true });
  const subscriptions = new Map<string, Set<WebSocket>>();
  const authorize = options.authorize ?? defaultAuthorize;
  const subscriber = redis.duplicate({ lazyConnect: true });

  const broadcast = (orderId: string, payload: string) => {
    const sockets = subscriptions.get(orderId);
    if (!sockets) return;
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  };

  subscriber.on('pmessage', (_pattern, channel, payload) => {
    const match = /^order:([^:]+):events$/.exec(channel);
    if (match?.[1]) broadcast(match[1], payload);
  });
  subscriber.on('error', (error) => logger.error({ err: error }, 'WebSocket Redis subscriber error'));

  if (options.subscribeToRedis !== false) {
    void subscriber.connect()
      .then(() => subscriber.psubscribe('order:*:events'))
      .catch((error: unknown) => logger.error({ err: error }, 'WebSocket Redis subscription failed'));
  }

  const onUpgrade = async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    try {
      const { orderId, token } = parseSubscriptionRequest(request);
      const claims = verifyAccessToken(token);
      const actor: AuthContext = { userId: claims.sub, role: claims.role };
      await authorize(orderId, actor);

      wss.handleUpgrade(request, socket, head, (websocket) => {
        const orderSockets = subscriptions.get(orderId) ?? new Set<WebSocket>();
        orderSockets.add(websocket);
        subscriptions.set(orderId, orderSockets);

        websocket.send(JSON.stringify({ type: 'subscribed', order_id: orderId }));
        websocket.on('close', () => {
          orderSockets.delete(websocket);
          if (orderSockets.size === 0) subscriptions.delete(orderId);
        });
      });
    } catch (error: unknown) {
      if (error instanceof HttpError) rejectUpgrade(socket, error);
      else rejectUpgrade(socket, new HttpError(401, 'Unauthorized', 'The WebSocket access token is invalid or expired'));
    }
  };

  const upgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    void onUpgrade(request, socket, head);
  };
  server.on('upgrade', upgradeListener);

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.readyState === WebSocket.OPEN) socket.ping();
    }
  }, 30_000);
  heartbeat.unref();

  return {
    broadcast,
    subscriptionCount: (orderId: string) => subscriptions.get(orderId)?.size ?? 0,
    close: async () => {
      clearInterval(heartbeat);
      server.off('upgrade', upgradeListener);
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      if (subscriber.status !== 'wait' && subscriber.status !== 'end') await subscriber.quit();
    },
  };
};
