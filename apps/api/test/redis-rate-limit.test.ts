import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import type Redis from 'ioredis';
import { newRedisClient, redisRateLimitStore } from '../src/lib/rate-limit-store';

// Runs against a real Redis when REDIS_TEST_URL is set (e.g. redis://127.0.0.1:6390); skipped otherwise.
const url = process.env.REDIS_TEST_URL;

describe.skipIf(!url)('rate limiting with a shared Redis store', () => {
  let redis: Redis;
  const prefix = `test-${Date.now()}`;

  /** One "API instance": its own Express app and limiter, sharing only the Redis store. */
  const instance = (limit: number, name = prefix) => {
    const app = express();
    app.use(
      rateLimit({
        windowMs: 60_000,
        limit,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        store: redisRateLimitStore(redis, name),
        message: { error: 'slow down' },
      })
    );
    app.get('/ping', (_req, res) => res.json({ ok: true }));
    return app;
  };

  beforeAll(async () => {
    redis = newRedisClient(url!); // the same client the API uses
    await redis.ping();
  });
  afterAll(async () => {
    const keys = await redis.keys('lms:rl:test-*');
    if (keys.length) await redis.del(...keys);
    redis.disconnect();
  });

  it('works when the store is created before the connection is up (no unhandled rejection)', async () => {
    const rejections: unknown[] = [];
    const onRejection = (e: unknown) => rejections.push(e);
    process.on('unhandledRejection', onRejection);
    const fresh = newRedisClient(url!); // not connected yet
    const store = redisRateLimitStore(fresh, `${prefix}-early`);
    store.init!({ windowMs: 60_000 } as never); // express-rate-limit does this when it adopts a store
    await new Promise((r) => setTimeout(r, 300));
    expect((await store.increment!('k')).totalHits).toBe(1);
    expect((await store.increment!('k')).totalHits).toBe(2);
    process.off('unhandledRejection', onRejection);
    fresh.disconnect();
    expect(rejections).toEqual([]);
  });

  it('limits a client and stores its counter in Redis', async () => {
    const app = instance(3, `${prefix}-single`);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await request(app).get('/ping')).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    expect((await redis.keys(`lms:rl:${prefix}-single:*`)).length).toBeGreaterThan(0);
  });

  it('shares the count between two API instances', async () => {
    const a = instance(4, `${prefix}-shared`);
    const b = instance(4, `${prefix}-shared`);
    const codes = [
      (await request(a).get('/ping')).status,
      (await request(b).get('/ping')).status,
      (await request(a).get('/ping')).status,
      (await request(b).get('/ping')).status,
      (await request(a).get('/ping')).status, // 5th request overall, over the limit of 4
      (await request(b).get('/ping')).status,
    ];
    expect(codes).toEqual([200, 200, 200, 200, 429, 429]);
  });

  it('keeps separate limiters apart by prefix', async () => {
    const x = instance(1, `${prefix}-x`);
    const y = instance(1, `${prefix}-y`);
    expect((await request(x).get('/ping')).status).toBe(200);
    expect((await request(y).get('/ping')).status).toBe(200);
    expect((await request(x).get('/ping')).status).toBe(429);
  });

  it('counters expire with the window (TTL is set)', async () => {
    const app = instance(2, `${prefix}-ttl`);
    await request(app).get('/ping');
    const [key] = await redis.keys(`lms:rl:${prefix}-ttl:*`);
    const ttl = await redis.pttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });
});
