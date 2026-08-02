import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { db } from './lib/postgres.js';
import { logger } from './lib/logger.js';
import { redis } from './lib/redis.js';

const server = createServer(createApp());

server.listen(config.PORT, () => logger.info({ port: config.PORT }, 'server listening'));

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'graceful shutdown started');
  server.close(async () => {
    await Promise.allSettled([db.end(), redis.quit()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

