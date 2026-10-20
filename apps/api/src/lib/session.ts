import { runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { prisma } from './prisma';

/**
 * Server-side view of a session. Session tokens are stateless JWTs, so on every request we
 * re-check the user's current status, role and token version. That makes suspension, demotion,
 * password changes and logout take effect immediately instead of when the JWT expires.
 */
export interface SessionState {
  role: string;
  status: string;
  tokenVersion: number;
  /** Status of the user's organisation; a suspended or archived one ends every session in it. */
  tenantStatus: string;
  /** When the organisation's trial ended (lib/trial.ts); while it is still a TRIAL, the organisation is read-only. */
  tenantTrialExpiredAt: Date | null;
  /** trialRemindersSent: its PAYMENT_LAPSED bit tells a read-only period caused by unpaid billing from an ended trial. */
  tenantTrialRemindersSent: number;
}

/** Shown when the organisation of a token (session, SCIM) has been suspended or archived. */
export const TENANT_SUSPENDED_MESSAGE = 'This organisation has been suspended. Contact the platform operator.';

export function tenantIsBlocked(status: string | null | undefined): boolean {
  return status === 'SUSPENDED' || status === 'ARCHIVED';
}

/** Shown when a change is refused because the organisation's trial has ended (read-only until it is suspended). */
export const TRIAL_ENDED_MESSAGE = 'Your trial has ended — contact us to continue.';

/** Set in Tenant.trialRemindersSent (with both reminder bits) when billing lapsed, so the read-only message names payment. */
export const PAYMENT_LAPSED = 4;

/** Shown instead of TRIAL_ENDED_MESSAGE when the read-only period follows a cancelled or unpaid subscription. */
export const PAYMENT_LAPSED_MESSAGE = 'Your subscription has lapsed — pay or renew it under Billing to continue.';

/** An expired trial in its grace period: people can still sign in and look, but not change anything. */
export function tenantIsReadOnly(state: Pick<SessionState, 'tenantStatus' | 'tenantTrialExpiredAt'> | null | undefined): boolean {
  return state?.tenantStatus === 'TRIAL' && !!state.tenantTrialExpiredAt;
}

const TTL_MS = config.NODE_ENV === 'test' ? 0 : 10_000;
const cache = new Map<string, { state: SessionState | null; tenantId: string; expires: number }>();

export function invalidateSessionCache(userId: string): void {
  cache.delete(userId);
}

/** Drops every cached session of an organisation, so a change of its status applies at once in this process. */
export function invalidateTenantSessions(tenantId: string): void {
  for (const [userId, entry] of cache) if (entry.tenantId === tenantId) cache.delete(userId);
}

/**
 * Current state of a user, or null if the user no longer exists. Cached briefly per process; a change of
 * organisation status clears that organisation's entries here (invalidateTenantSessions) and applies within
 * TTL_MS in other processes.
 */
export async function loadSession(userId: string, tenantId: string, fresh = false): Promise<SessionState | null> {
  const hit = fresh ? undefined : cache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.state;

  const row = await runWithTenant(tenantId, () =>
    prisma.user.findFirst({ where: { id: userId }, select: { role: true, status: true, tokenVersion: true, tenant: { select: { status: true, trialExpiredAt: true, trialRemindersSent: true } } } })
  );
  const state = row
    ? { role: String(row.role), status: String(row.status), tokenVersion: row.tokenVersion ?? 0, tenantStatus: String(row.tenant.status), tenantTrialExpiredAt: row.tenant.trialExpiredAt ?? null, tenantTrialRemindersSent: row.tenant.trialRemindersSent }
    : null;
  if (TTL_MS > 0) {
    if (cache.size > 10_000) cache.clear();
    cache.set(userId, { state, tenantId, expires: Date.now() + TTL_MS });
  }
  return state;
}

/**
 * Invalidates every token issued to the user so far. With a transaction client the caller keeps the
 * bump atomic with its own change; the cache entry is dropped either way.
 */
export async function revokeSessions(
  userId: string,
  client: { user: { update: (args: any) => Promise<unknown> } } = prisma as any
): Promise<void> {
  await client.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  invalidateSessionCache(userId);
}

/** True when a token's user may still use it. A blocked organisation is checked separately (it gets its own 403). */
export function sessionIsValid(state: SessionState | null, tokenVersion: number): state is SessionState {
  return !!state && state.status === 'ACTIVE' && state.tokenVersion === tokenVersion;
}
