import crypto from 'crypto';
import net from 'net';
import dns from 'dns/promises';
import { runWithTenant } from '@enterprise-lms/database';
import { prisma, basePrisma } from './prisma';
import { logger } from './logger';
import { config } from '../config';

export const WEBHOOK_EVENTS = [
  'enrollment.completed',
  'certificate.issued',
  'quiz.submitted',
  'user.provisioned',
  'webhook.test',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const PRIVATE_V4 = [
  /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // carrier-grade NAT 100.64.0.0/10
  /^192\.0\.0\./, /^198\.1[89]\./, /^2(2[4-9]|[3-5]\d)\./, // IETF protocol, benchmarking, multicast and reserved
];

/** True for an address no tenant-supplied URL may reach: loopback, private, link-local, unspecified, mapped forms of those. */
export function isBlockedIp(ip: string): boolean {
  const host = ip.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIPv4(host)) return PRIVATE_V4.some((r) => r.test(host));
  if (!net.isIPv6(host)) return false;
  // IPv4-mapped (::ffff:127.0.0.1, or ::ffff:7f00:1 as the URL parser writes it) is judged as the IPv4 address.
  const mapped = host.match(/^(?:0{0,4}:){2,5}ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
  if (mapped) {
    if (mapped[1]) return isBlockedIp(mapped[1]);
    const hi = parseInt(mapped[2], 16);
    const lo = parseInt(mapped[3], 16);
    return isBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const groups = host.split(':');
  const allZeroExceptLast = /^[0:]*$/.test(host.replace(/:[0-9a-f]{1,4}$/, '')) || host === '::';
  return host === '::' || host === '::1' || (allZeroExceptLast && groups.length > 2) || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('ff');
}

/**
 * Basic SSRF guard for tenant-supplied URLs: https only in production, and no literal loopback /
 * private / link-local addresses or localhost names. (DNS rebinding needs an egress proxy; this is
 * the application-level layer.) Tests may target loopback.
 */
export function assertSafeWebhookUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  const prod = config.NODE_ENV === 'production';
  if (config.NODE_ENV === 'test') {
    if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) URLs are allowed');
    return;
  }
  if (u.protocol !== 'https:' && (prod || u.protocol !== 'http:')) throw new Error('Webhook URLs must use https');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new Error('Webhook URL host is not allowed');
  }
  if (isBlockedIp(host)) throw new Error('Webhook URL host is not allowed');
}

/** The same guard plus DNS: every address the name resolves to must be allowed (not for tests, which target loopback). */
export async function assertSafeWebhookTarget(raw: string): Promise<void> {
  assertSafeWebhookUrl(raw);
  if (config.NODE_ENV === 'test') return;
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return;
  const found = await dns.lookup(host, { all: true }).catch(() => []);
  if (found.some((a) => isBlockedIp(a.address))) throw new Error('Webhook URL host is not allowed');
}

export const signPayload = (secret: string, timestamp: string, body: string) =>
  crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

/** Seconds to wait before attempt 2, 3, 4, 5. After that the delivery is given up on. */
export const RETRY_DELAYS_SECONDS = [30, 120, 600, 3600];
export const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1;

/** Network errors, timeouts, 5xx, 408 and 429 may succeed later; other 4xx mean the receiver refused it. */
const isRetryable = (statusCode: number | null) => statusCode === null || statusCode >= 500 || statusCode === 408 || statusCode === 429;

interface DeliverOptions {
  /** Which attempt this is (1 = first). */
  attempt?: number;
  /** Schedule a retry on a retryable failure. Off for the admin "send test event" button. */
  retry?: boolean;
}

async function deliver(
  endpoint: { id: string; url: string; secret: string },
  tenantId: string,
  event: string,
  body: string,
  opts: DeliverOptions = {}
) {
  const attempt = opts.attempt ?? 1;
  const ts = String(Math.floor(Date.now() / 1000));
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    await assertSafeWebhookTarget(endpoint.url);
    const res = await fetch(endpoint.url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        'x-lms-event': event,
        'x-lms-timestamp': ts,
        'x-lms-signature': `sha256=${signPayload(endpoint.secret, ts, body)}`,
        'x-lms-attempt': String(attempt),
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
    statusCode = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err: any) {
    error = String(err?.message ?? err).slice(0, 300);
  }
  const success = error === null;
  const willRetry = !success && !!opts.retry && attempt < MAX_ATTEMPTS && isRetryable(statusCode);
  await prisma.webhookDelivery.create({
    data: {
      tenantId,
      endpointId: endpoint.id,
      event,
      statusCode,
      success,
      error,
      attempt,
      ...(willRetry ? { payload: body, nextAttemptAt: new Date(Date.now() + RETRY_DELAYS_SECONDS[attempt - 1] * 1000) } : {}),
    },
  });
  return { success, statusCode, error };
}

/**
 * Sends `event` to every active endpoint of the tenant subscribed to it. Fire-and-forget from the
 * caller's point of view (never throws); each attempt is recorded in WebhookDelivery and failed
 * attempts are retried with backoff by retryDueWebhooks(). The returned promise resolves when the
 * first attempts finished, which tests use to await delivery.
 * Must be called inside the tenant context.
 */
export function dispatchWebhook(tenantId: string, event: WebhookEvent, data: unknown): Promise<void> {
  const body = JSON.stringify({ id: crypto.randomUUID(), event, tenantId, createdAt: new Date().toISOString(), data });
  return (async () => {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { tenantId, isActive: true, events: { has: event } },
      select: { id: true, url: true, secret: true },
    });
    await Promise.all(endpoints.map((e) => deliver(e, tenantId, event, body, { retry: true })));
  })().catch((err) => logger.warn({ err, event }, 'webhook dispatch failed'));
}

/** Retries deliveries that are due. Safe to run on several instances: each row is claimed once. */
export async function retryDueWebhooks(opts: { now?: Date; batch?: number } = {}): Promise<{ retried: number; dropped: number }> {
  const now = opts.now ?? new Date();
  const totals = { retried: 0, dropped: 0 };
  const tenants = await basePrisma.tenant.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL'] } }, select: { id: true } });
  for (const { id: tenantId } of tenants) {
    try {
      await runWithTenant(tenantId, async () => {
        const due = await prisma.webhookDelivery.findMany({
          where: { tenantId, nextAttemptAt: { lte: now } },
          orderBy: { nextAttemptAt: 'asc' },
          take: opts.batch ?? 50,
        });
        for (const d of due) {
          // Claim: only the instance that clears nextAttemptAt proceeds.
          const claimed = await prisma.webhookDelivery.updateMany({
            where: { id: d.id, nextAttemptAt: d.nextAttemptAt },
            data: { nextAttemptAt: null, payload: null },
          });
          if (claimed.count !== 1 || !d.payload) continue;
          const endpoint = await prisma.webhookEndpoint.findFirst({
            where: { id: d.endpointId, tenantId, isActive: true, events: { has: d.event } },
            select: { id: true, url: true, secret: true },
          });
          if (!endpoint) {
            totals.dropped++;
            continue;
          }
          await deliver(endpoint, tenantId, d.event, d.payload, { attempt: d.attempt + 1, retry: true });
          totals.retried++;
        }
      });
    } catch (err) {
      logger.error({ err, tenantId }, 'webhook retry failed for tenant');
    }
  }
  return totals;
}

let timer: NodeJS.Timeout | null = null;

/** Starts the background retry worker; a tick is skipped while the previous one is still running. */
export function startWebhookRetryWorker(): void {
  const seconds = config.WEBHOOK_RETRY_INTERVAL_SECONDS;
  if (seconds <= 0 || timer) return;
  let running = false;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await retryDueWebhooks();
      if (r.retried || r.dropped) logger.info(r, 'webhook retries processed');
    } finally {
      running = false;
    }
  }, seconds * 1000);
  timer.unref();
}

export { deliver as deliverWebhook };
