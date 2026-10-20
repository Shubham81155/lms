import { Request, RequestHandler } from 'express';
import { config } from '../config';
import { HttpError, handleError } from './http';
import { logger } from './logger';

// CAPTCHA for public forms that anyone can send (organisation registration, and the like), with Cloudflare
// Turnstile: free, and it sets no tracking cookies. Off while TURNSTILE_SECRET_KEY is unset (development,
// tests); server.ts warns about that in production.
//
// When Cloudflare cannot be reached the request is refused (503), not let through. A check that passes
// whenever siteverify is slow or blocked would be skipped by anyone able to make it so, and on these forms a
// short wait costs little: nobody is locked out of their work, they try again in a minute.

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5_000;
/** Turnstile tokens are at most 2048 characters. */
const MAX_TOKEN_LENGTH = 2048;

/**
 * Cloudflare's published dummy secrets (always pass / always fail / token already spent). They answer for any
 * token with a placeholder hostname and no action, so those two checks are skipped with them.
 */
const TEST_SECRETS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);

export const CAPTCHA_REQUIRED_MESSAGE = 'Complete the security check (CAPTCHA) and try again.';
export const CAPTCHA_FAILED_MESSAGE = 'The security check (CAPTCHA) did not pass or has expired. Complete it again and resend.';
export const CAPTCHA_UNAVAILABLE_MESSAGE = 'The security check (CAPTCHA) could not be verified right now. Please try again in a minute.';

/** Whether forms must carry a CAPTCHA token: TURNSTILE_SECRET_KEY is set. */
export const captchaEnabled = () => !!config.TURNSTILE_SECRET_KEY;

/** The public site key for the web app's widget, or null while the CAPTCHA is off. */
export const captchaSiteKey = (): string | null => (captchaEnabled() ? config.TURNSTILE_SITE_KEY ?? null : null);

export interface CaptchaOptions {
  /** The widget's `action`; a token made for another form is refused. */
  action?: string;
  /** Host names the widget may have been solved on. Unset: any the site key allows (set in Cloudflare). */
  hostnames?: string[];
}

export type CaptchaResult = { ok: true } | { ok: false; reason: 'missing' | 'rejected' | 'unavailable'; errorCodes?: string[] };

/**
 * Checks a Turnstile token with Cloudflare. `ok` when the CAPTCHA is off. A token can be checked once only,
 * so a form that is refused afterwards needs a fresh one.
 */
export async function verifyCaptcha(token: unknown, remoteIp?: string | null, options: CaptchaOptions = {}): Promise<CaptchaResult> {
  const secret = config.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true };
  if (typeof token !== 'string' || !token.trim() || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'missing' };

  const form = new URLSearchParams({ secret, response: token.trim() });
  if (remoteIp) form.set('remoteip', remoteIp);
  let body: { success?: unknown; 'error-codes'?: unknown; action?: unknown; hostname?: unknown };
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`siteverify answered ${res.status}`);
    body = (await res.json()) as typeof body;
  } catch (err) {
    logger.warn({ err }, 'could not check a CAPTCHA token with Cloudflare Turnstile');
    return { ok: false, reason: 'unavailable' };
  }

  const errorCodes = Array.isArray(body['error-codes']) ? body['error-codes'].map(String) : [];
  // Our own secret refused: a configuration problem, not the visitor's fault.
  if (errorCodes.some((c) => c === 'missing-input-secret' || c === 'invalid-input-secret')) {
    logger.error({ errorCodes }, 'Cloudflare Turnstile refused TURNSTILE_SECRET_KEY');
    return { ok: false, reason: 'unavailable', errorCodes };
  }
  if (body.success !== true) return { ok: false, reason: 'rejected', errorCodes };
  if (!TEST_SECRETS.has(secret)) {
    if (options.action && body.action !== options.action) return { ok: false, reason: 'rejected', errorCodes: ['action-mismatch'] };
    if (options.hostnames?.length && !options.hostnames.includes(String(body.hostname ?? '').toLowerCase())) {
      return { ok: false, reason: 'rejected', errorCodes: ['hostname-mismatch'] };
    }
  }
  return { ok: true };
}

/** The token a form sent: the JSON body's `captchaToken`, else the `cf-turnstile-response` header. */
export function captchaToken(req: Request): unknown {
  const fromBody = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).captchaToken : undefined;
  return fromBody ?? req.headers['cf-turnstile-response'];
}

/** Throws the HttpError a failed check answers with: 400 missing or refused, 503 Cloudflare unreachable. */
export async function assertCaptcha(req: Request, options: CaptchaOptions = {}): Promise<void> {
  const result = await verifyCaptcha(captchaToken(req), req.ip, options);
  if (result.ok) return;
  if (result.reason === 'missing') throw new HttpError(400, CAPTCHA_REQUIRED_MESSAGE);
  if (result.reason === 'unavailable') throw new HttpError(503, CAPTCHA_UNAVAILABLE_MESSAGE);
  throw new HttpError(400, CAPTCHA_FAILED_MESSAGE, { errorCodes: result.errorCodes });
}

/**
 * Middleware: the request must carry a passing Turnstile token (see captchaToken). Place it after rate limits
 * and cheap validation and before anything that writes or sends mail. Does nothing while the CAPTCHA is off.
 */
export const requireCaptcha =
  (action?: string, options: Omit<CaptchaOptions, 'action'> = {}): RequestHandler =>
  async (req, res, next) => {
    try {
      await assertCaptcha(req, { ...options, action });
    } catch (err) {
      return handleError(req, res, err, 'Failed to check the CAPTCHA');
    }
    next();
  };
