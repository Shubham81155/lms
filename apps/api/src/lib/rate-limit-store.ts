import Redis from 'ioredis';
import { RedisStore } from 'rate-limit-redis';
import type { Store } from 'express-rate-limit';
import { config } from '../config';
import { logger } from './logger';

let client: Redis | null = null;

function redis(): Redis | null {
  if (!config.REDIS_URL || config.NODE_ENV === 'test') return null;
  client ??= newRedisClient(config.REDIS_URL);
  return client;
}

/**
 * The offline queue must stay on: the rate-limit store loads its Lua script as soon as it is created,
 * which is before the connection is up. A command that cannot get through within `commandTimeout`
 * fails fast instead of holding the request, and the limiter then lets the request pass.
 */
export function newRedisClient(url: string): Redis {
  const r = new Redis(url, { maxRetriesPerRequest: 1, commandTimeout: 500 });
  r.on('error', (err) => logger.warn({ err }, 'redis error (rate limiting falls back to allowing requests)'));
  return r;
}

/**
 * Counter store for express-rate-limit. With REDIS_URL set, counters are shared across API
 * instances; without it this returns undefined and the limiter keeps its own in-memory counters.
 * `prefix` keeps each limiter's keys apart.
 */
export function rateLimitStore(prefix: string): Store | undefined {
  const r = redis();
  return r ? redisRateLimitStore(r, prefix) : undefined;
}

/** The store itself, for a given client (also what the Redis integration test uses). */
export function redisRateLimitStore(r: Redis, prefix: string): Store {
  return new RedisStore({
    prefix: `lms:rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) => r.call(command, ...args) as Promise<any>,
  });
}
