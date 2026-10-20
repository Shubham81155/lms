import crypto from 'crypto';
import { config } from '../config';
import { logger } from './logger';

// Copyleaks as the similarity provider (API v3). The sweeper in plagiarism-submit.ts sends each queued text
// as a scan; Copyleaks reports back to POST /api/v1/integrations/copyleaks/:tenantSlug/:submissionId/:status.
// Copyleaks does not sign its webhooks, so every scan carries a header with an HMAC of the scan, which the
// callback checks.

const REQUEST_TIMEOUT_MS = 10_000;
/** Header Copyleaks is asked to send back with every status webhook of a scan. */
export const COPYLEAKS_TOKEN_HEADER = 'x-lms-token';

export const copyleaksConfigured = () => !!(config.COPYLEAKS_EMAIL && config.COPYLEAKS_API_KEY);

/**
 * A scan id is unique across the whole Copyleaks account and at most 36 characters, so it is the submission
 * id plus the time it was first sent. It is kept across retries (see plagiarismScanId).
 */
export const newScanId = (submissionId: string, now = new Date()) =>
  `${submissionId.slice(0, 27).toLowerCase()}-${now.getTime().toString(36)}`;

export function copyleaksWebhookToken(tenantSlug: string, submissionId: string, scanId: string): string {
  return crypto
    .createHmac('sha256', config.PLAGIARISM_WEBHOOK_SECRET!)
    .update(`copyleaks.${tenantSlug}.${submissionId}.${scanId}`)
    .digest('hex');
}

export function validCopyleaksToken(tenantSlug: string, submissionId: string, scanId: string, given: string): boolean {
  const expected = Buffer.from(copyleaksWebhookToken(tenantSlug, submissionId, scanId), 'hex');
  const actual = Buffer.from(given, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// The access token is valid for 48 hours; it is shared by every request of this process.
let cached: { token: string; expiresAt: number } | null = null;

export function resetCopyleaksToken(): void {
  cached = null;
}

async function accessToken(): Promise<string | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  try {
    const res = await fetch(`${config.COPYLEAKS_ID_URL.replace(/\/+$/, '')}/v3/account/login/api`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: config.COPYLEAKS_EMAIL, key: config.COPYLEAKS_API_KEY }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, 'Copyleaks login refused; check COPYLEAKS_EMAIL and COPYLEAKS_API_KEY');
      return null;
    }
    const body = (await res.json()) as { access_token?: string; '.expires'?: string };
    if (!body.access_token) return null;
    const expires = Date.parse(body['.expires'] ?? '') || Date.now() + 48 * 3600_000;
    // Renewed an hour early, so a token never expires between being read here and being used.
    cached = { token: body.access_token, expiresAt: expires - 3600_000 };
    return cached.token;
  } catch (err) {
    logger.warn({ err }, 'Copyleaks login request failed');
    return null;
  }
}

/**
 * Starts a scan of the text. Returns the HTTP status to treat the attempt as (null when it should be retried
 * without one): a scan id that already exists means an earlier attempt arrived, which counts as success.
 */
export async function submitCopyleaksScan(s: { scanId: string; submissionId: string; tenantSlug: string; text: string }): Promise<number | null> {
  const token = await accessToken();
  if (!token) return null;
  const callbackBase = `${config.API_PUBLIC_URL!.replace(/\/+$/, '')}/api/v1/integrations/copyleaks/${encodeURIComponent(s.tenantSlug)}/${encodeURIComponent(s.submissionId)}`;
  const body = JSON.stringify({
    base64: Buffer.from(s.text, 'utf8').toString('base64'),
    filename: 'submission.txt',
    properties: {
      sandbox: config.COPYLEAKS_SANDBOX,
      developerPayload: s.submissionId,
      webhooks: {
        status: `${callbackBase}/{STATUS}`,
        statusHeaders: [[COPYLEAKS_TOKEN_HEADER, copyleaksWebhookToken(s.tenantSlug, s.submissionId, s.scanId)]],
      },
    },
  });
  try {
    const res = await fetch(`${config.COPYLEAKS_API_URL.replace(/\/+$/, '')}/v3/scans/submit/file/${encodeURIComponent(s.scanId)}`, {
      method: 'PUT',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 409) return 201;
    if (res.status === 401) {
      // Revoked or expired early: log in again on the next attempt.
      resetCopyleaksToken();
      return null;
    }
    if (!res.ok) logger.warn({ status: res.status, scanId: s.scanId, body: (await res.text()).slice(0, 500) }, 'Copyleaks refused a scan');
    return res.status;
  } catch (err) {
    logger.warn({ err, scanId: s.scanId }, 'Copyleaks scan request failed');
    return null;
  }
}
