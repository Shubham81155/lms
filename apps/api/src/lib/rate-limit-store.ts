import Redis from 'ioredis';
import { RedisStore } from 'rate-limit-redis';
import type { Store } from 'express-rate-limit';
import { config } from '../config';
import { logger } from './logger';

let client: Redis | null = null;

function redis(): Redis | null {
  if (!config.REDIS_URL || config.NODE_ENV === 'test') return null;
  if (!client) {
    client = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
    client.on('error', (err) => logger.warn({ err }, 'redis error (rate limiting falls back to allowing requests)'));
  }
  return client;
}

/**
 * Counter store for express-rate-limit. With REDIS_URL set, counters are shared across API
 * instances; without it this returns undefined and the limiter keeps its own in-memory counters.
 * `prefix` keeps each limiter's keys apart.
 */
export function rateLimitStore(prefix: string): Store | undefined {
  const r = redis();
  if (!r) return undefined;
  return new RedisStore({
    prefix: `lms:rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) => r.call(command, ...args) as Promise<any>,
  });
}
