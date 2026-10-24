import crypto from 'crypto';
import { config } from '../config';
import { HttpError } from './http';

// A thin client for the parts of the Razorpay API billing uses (https://razorpay.com/docs/api/payments/subscriptions/),
// behind an interface so tests (and a deployment without keys) can swap it.

export interface RazorpayClient {
  /** Registers a price as a Razorpay plan; returns its id. `amountPaise` is per seat per interval. */
  createPlan(input: { name: string; interval: 'MONTH' | 'YEAR'; amountPaise: number }): Promise<{ id: string }>;
  /** Starts a subscription of `quantity` seats; `shortUrl` is the hosted page where the customer pays. */
  createSubscription(input: {
    planId: string;
    quantity: number;
    totalCount: number;
    notes: Record<string, string>;
  }): Promise<{ id: string; shortUrl: string }>;
  /** Stops renewals at the end of the paid period (atCycleEnd) or at once. */
  cancelSubscription(id: string, atCycleEnd: boolean): Promise<void>;
  /** Undoes a cancellation scheduled for the end of the period. */
  cancelScheduledChanges(id: string): Promise<void>;
}

export const razorpayConfigured = () => !!(config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET);

async function call<T>(method: 'POST', path: string, body: unknown): Promise<T> {
  const auth = Buffer.from(`${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `The payment provider refused the request: ${json?.error?.description ?? res.status}`);
  return json as T;
}

export const httpRazorpayClient: RazorpayClient = {
  async createPlan({ name, interval, amountPaise }) {
    const plan = await call<{ id: string }>('POST', '/plans', {
      period: interval === 'MONTH' ? 'monthly' : 'yearly',
      interval: 1,
      item: { name, amount: amountPaise, currency: 'INR' },
    });
    return { id: plan.id };
  },
  async createSubscription({ planId, quantity, totalCount, notes }) {
    const sub = await call<{ id: string; short_url: string }>('POST', '/subscriptions', {
      plan_id: planId,
      quantity,
      total_count: totalCount,
      customer_notify: 1,
      notes,
    });
    return { id: sub.id, shortUrl: sub.short_url };
  },
  async cancelSubscription(id, atCycleEnd) {
    await call('POST', `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });
  },
  async cancelScheduledChanges(id) {
    await call('POST', `/subscriptions/${encodeURIComponent(id)}/cancel_scheduled_changes`, {});
  },
};

let client: RazorpayClient = httpRazorpayClient;
/** The client billing uses; tests replace it. */
export const razorpay = () => client;
export function setRazorpayClient(c: RazorpayClient): void {
  client = c;
}

/** The HMAC-SHA256 Razorpay sends in X-Razorpay-Signature: of the exact raw body, with the webhook secret. */
export const signWebhook = (secret: string, rawBody: string) => crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

export function validWebhookSignature(secret: string, rawBody: string, header: string | undefined): boolean {
  if (!header || !/^[0-9a-f]{64}$/i.test(header)) return false;
  return crypto.timingSafeEqual(Buffer.from(signWebhook(secret, rawBody), 'hex'), Buffer.from(header, 'hex'));
}
