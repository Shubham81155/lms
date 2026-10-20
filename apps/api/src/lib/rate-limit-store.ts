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

/** Whether Redis answers a PING: null when no Redis is configured (or in tests), so a check can be skipped. */
export async function redisHealthy(): Promise<boolean | null> {
  const r = redis();
  if (!r) return null;
  try {
    return (await r.ping()) === 'PONG';
  } catch {
    return false;
  }
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
  const store = new RedisStore({
    prefix: `lms:rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) => r.call(command, ...args) as Promise<any>,
  });
  // The store loads its scripts at once, which can time out while the process is still starting (or Redis is
  // down). It loads them again on first use, so a failed early load must not end the process as an unhandled
  // rejection.
  for (const loading of [store.incrementScriptSha, store.getScriptSha]) loading.catch(() => {});
  return store;
}
