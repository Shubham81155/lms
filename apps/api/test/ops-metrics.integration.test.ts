import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// GET /metrics (bearer token, 404 when off, bounded route labels, job metrics, queue depths counted across
// organisations as the unprivileged runtime role) and GET /ready.

const TOKEN = 'metrics-token-0123456789';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let config: typeof import('../src/config.js').config;
let jobLock: typeof import('../src/lib/job-lock.js');

const scrape = (token: string | null = TOKEN) => {
  const r = request(app).get('/metrics');
  return token === null ? r : r.set('Authorization', `Bearer ${token}`);
};

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  process.env.DATABASE_URL = db.appUrl;
  process.env.METRICS_TOKEN = TOKEN;
  config = (await import('../src/config.js')).config;
  app = (await import('../src/server.js')).app;
  jobLock = await import('../src/lib/job-lock.js');

  // Two organisations, each with queued work: the counts must add them up although row-level security hides
  // each organisation's rows from the other.
  for (const [id, slug] of [
    ['t-a', 'acme'],
    ['t-b', 'beta'],
  ]) {
    await admin.tenant.create({ data: { id, slug, name: slug } });
    await admin.user.create({
      data: {
        id: `u-${id}`,
        tenantId: id,
        email: `${id}@x.edu`,
        firstName: 'A',
        lastName: 'B',
        role: 'STUDENT',
        passwordHash: 'x',
        emailVerified: true,
      },
    });
    await admin.notification.createMany({
      data: [
        { tenantId: id, userId: `u-${id}`, category: 'SYSTEM', title: 'one', emailStatus: 'PENDING' },
        { tenantId: id, userId: `u-${id}`, category: 'SYSTEM', title: 'two', emailStatus: 'SENT' },
      ],
    });
    const endpoint = await admin.webhookEndpoint.create({
      data: { tenantId: id, url: 'https://hooks.example/x', secret: 's', events: ['*'] },
    });
    await admin.webhookDelivery.createMany({
      data: [
        { tenantId: id, endpointId: endpoint.id, event: 'e', nextAttemptAt: new Date(Date.now() + 60_000) },
        { tenantId: id, endpointId: endpoint.id, event: 'e', success: true },
      ],
    });
  }
}, 120_000);

afterAll(async () => {
  jobLock?.stopPeriodicJobs();
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

describe('GET /metrics', () => {
  it('needs the bearer token', async () => {
    expect((await scrape(null)).status).toBe(401);
    expect((await scrape('wrong-token-0123456789')).status).toBe(401);
    expect((await scrape('')).status).toBe(401);
    const query = await request(app).get(`/metrics?token=${TOKEN}`);
    expect(query.status).toBe(401); // never accepted in the URL
    const ok = await scrape();
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toMatch(/^text\/plain/);
    expect(ok.text).toContain('process_cpu_user_seconds_total');
  });

  it('answers 404 to everything while METRICS_TOKEN is unset', async () => {
    config.METRICS_TOKEN = undefined;
    try {
      expect((await scrape()).status).toBe(404);
      expect((await scrape(null)).status).toBe(404);
    } finally {
      config.METRICS_TOKEN = TOKEN;
    }
  });

  it('labels requests by route pattern, so ids and scanner paths cannot blow up the series', async () => {
    await request(app).get('/api/v1/organizations/lookup?slug=x');
    for (let i = 0; i < 5; i++) await request(app).get(`/api/v1/courses/00000000-0000-0000-0000-00000000000${i}`);
    for (let i = 0; i < 5; i++) await request(app).get(`/wp-admin/scanner-${i}.php`);
    const text = (await scrape()).text;
    const routes = new Set([...text.matchAll(/http_request_duration_seconds_count\{[^}]*route="([^"]*)"/g)].map((m) => m[1]));
    expect(routes).toContain('/api/v1/courses/:id');
    expect(routes).toContain('unmatched');
    expect([...routes].filter((r) => /scanner|0000/.test(r))).toEqual([]);
    expect(text).toMatch(/http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/courses\/:id",status="401"\} 5/);
  });

  it('reports every background job through the job lock: ok, error and skipped', async () => {
    await jobLock.withJobLock('metrics-test-ok', async () => 1);
    await expect(jobLock.withJobLock('metrics-test-bad', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    // While another run holds the lock, this one is skipped.
    let release!: () => void;
    const held = jobLock.withJobLock('metrics-test-busy', () => new Promise<void>((resolve) => (release = resolve)));
    await new Promise((r) => setTimeout(r, 200));
    expect(await jobLock.withJobLock('metrics-test-busy', async () => 1)).toBeNull();
    release();
    await held;

    const text = (await scrape()).text;
    expect(text).toMatch(/lms_job_runs_total\{job="metrics-test-ok",result="ok"\} 1/);
    expect(text).toMatch(/lms_job_runs_total\{job="metrics-test-bad",result="error"\} 1/);
    expect(text).toMatch(/lms_job_runs_total\{job="metrics-test-busy",result="skipped"\} 1/);
    expect(text).toMatch(/lms_job_runs_total\{job="metrics-test-busy",result="ok"\} 1/);
    const last = Number(/lms_job_last_success_timestamp_seconds\{job="metrics-test-ok"\} (\S+)/.exec(text)?.[1]);
    expect(Math.abs(last - Date.now() / 1000)).toBeLessThan(30);
    expect(text).not.toMatch(/lms_job_last_success_timestamp_seconds\{job="metrics-test-bad"\}/);
  });

  it('counts queued e-mails and webhook retries across organisations, and the database as up', async () => {
    const text = (await scrape()).text;
    expect(text).toMatch(/^lms_email_queue_depth 2$/m);
    expect(text).toMatch(/^lms_webhook_retry_queue_depth 2$/m);
    expect(text).toMatch(/^lms_db_up 1$/m);
  });

  it('exposes no organisation data in the series', async () => {
    const text = (await scrape()).text;
    expect(text).not.toMatch(/acme|beta|t-a@x\.edu/);
  });
});

describe('GET /ready', () => {
  it('says which checks passed', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ready', checks: { database: 'ok', redis: 'skipped' } });
  });
});
