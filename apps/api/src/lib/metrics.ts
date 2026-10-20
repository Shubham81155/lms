import { createHash, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { config } from '../config';
import { basePrisma } from './prisma';
import { logger } from './logger';

// Prometheus metrics for GET /metrics (server.ts). Off (404) without METRICS_TOKEN. Names are what the alert rules
// in deploy/ are written against, so change them together:
//   http_request_duration_seconds{method,route,status}   route is the Express route pattern, never the raw path
//   lms_job_runs_total{job,result}                        result: ok | error | skipped (lock held elsewhere)
//   lms_job_last_success_timestamp_seconds{job}
//   lms_email_queue_depth, lms_webhook_retry_queue_depth, lms_db_up
// plus the default process metrics (CPU, memory, event loop lag, GC).

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds, by method, route pattern and status code.',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const jobRuns = new Counter({
  name: 'lms_job_runs_total',
  help: 'Background job runs: ok, error, or skipped because another process held the job lock.',
  labelNames: ['job', 'result'],
  registers: [registry],
});

const jobLastSuccess = new Gauge({
  name: 'lms_job_last_success_timestamp_seconds',
  help: 'Unix time of the last successful run of each background job in this process.',
  labelNames: ['job'],
  registers: [registry],
});

/** Called by lib/job-lock.ts for every run of every background job. */
export function jobRan(job: string, result: 'ok' | 'error' | 'skipped'): void {
  jobRuns.inc({ job, result });
  if (result === 'ok') jobLastSuccess.set({ job }, Date.now() / 1000);
}

// ---------------------------------------------------------------------------------- scrape-time gauges

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref())]);

/** Queue depths come from ops_queue_depths(), which counts across organisations (see its migration). Cached for a scrape. */
type Depths = { email_pending: bigint; webhook_retry: bigint };
let depths: { at: number; value: Promise<Depths> } | null = null;
const queueDepths = (): Promise<Depths> => {
  if (!depths || Date.now() - depths.at > 2_000) {
    const value = withTimeout(basePrisma.$queryRaw<Depths[]>`SELECT * FROM ops_queue_depths()`, 3_000).then((rows) => rows[0]);
    depths = { at: Date.now(), value };
  }
  return depths.value;
};

new Gauge({
  name: 'lms_db_up',
  help: '1 when the database answers, 0 when it does not.',
  registers: [registry],
  async collect() {
    try {
      await withTimeout(basePrisma.$queryRaw`SELECT 1`, 3_000);
      this.set(1);
    } catch {
      this.set(0);
    }
  },
});

new Gauge({
  name: 'lms_email_queue_depth',
  help: 'Notification e-mails waiting to be sent (all organisations).',
  registers: [registry],
  async collect() {
    try {
      this.set(Number((await queueDepths()).email_pending));
    } catch (err) {
      logger.warn({ err }, 'could not read the e-mail queue depth for metrics');
    }
  },
});

new Gauge({
  name: 'lms_webhook_retry_queue_depth',
  help: 'Webhook deliveries waiting for a retry (all organisations).',
  registers: [registry],
  async collect() {
    try {
      this.set(Number((await queueDepths()).webhook_retry));
    } catch (err) {
      logger.warn({ err }, 'could not read the webhook retry queue depth for metrics');
    }
  },
});

// ---------------------------------------------------------------------------------- HTTP

/** The route pattern a finished request matched ("/api/v1/courses/:id"), or "unmatched" (404s, scanners) to bound cardinality. */
function routeLabel(req: Request): string {
  const pattern = req.route?.path;
  if (typeof pattern !== 'string') return 'unmatched';
  return `${req.baseUrl}${pattern}`.replace(/\/+$/, '') || '/';
}

/** Times every request. Mounted first in server.ts so middleware time counts too. */
export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const end = httpDuration.startTimer();
  res.on('finish', () => end({ method: req.method, route: routeLabel(req), status: String(res.statusCode) }));
  next();
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/** GET /metrics: Prometheus text format for the holder of METRICS_TOKEN; 404 when no token is set. */
export async function metricsHandler(req: Request, res: Response): Promise<void> {
  const token = config.METRICS_TOKEN;
  if (!token) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const given = /^Bearer (.+)$/i.exec(req.get('authorization') ?? '')?.[1] ?? '';
  // Hash both sides so the comparison is constant-time whatever the length of what was sent.
  if (!timingSafeEqual(digest(given), digest(token))) {
    res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'Unauthorized' });
    return;
  }
  res.set('Content-Type', registry.contentType).send(await registry.metrics());
}
