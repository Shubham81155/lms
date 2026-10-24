import type { Request, Response } from 'express';
import { PAYMENT_LAPSED_MESSAGE, TRIAL_ENDED_MESSAGE } from './session';

// Once an organisation's trial has ended (lib/trial.ts) it is read-only until it is suspended: everyone can still
// sign in, look and take their data out, but nothing can be changed. Checked in authenticateJWT, from the
// session state it already loaded, so it costs no query.

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Changes still allowed while read-only: signing out, taking data out, privacy requests (people keep those
 * rights), scheduling or cancelling the organisation's own deletion, and billing (paying is how it ends).
 */
const ALLOWED = [
  /^\/api\/v1\/auth\/logout$/,
  /\/export(\/|$)/,
  /^\/api\/v1\/privacy\//,
  /^\/api\/v1\/admin\/offboarding\/deletion$/,
  /^\/api\/v1\/billing\//,
];

/** Answers 402 and returns true when the request is a change the organisation's ended trial does not allow. */
export function refuseTrialWrite(req: Request, res: Response): boolean {
  if (!req.tenantReadOnly || SAFE_METHODS.includes(req.method)) return false;
  const path = req.originalUrl.split('?')[0];
  if (ALLOWED.some((re) => re.test(path))) return false;
  if (req.tenantPaymentLapsed) res.status(402).json({ error: PAYMENT_LAPSED_MESSAGE, code: 'PAYMENT_LAPSED' });
  else res.status(402).json({ error: TRIAL_ENDED_MESSAGE, code: 'TRIAL_ENDED' });
  return true;
}
