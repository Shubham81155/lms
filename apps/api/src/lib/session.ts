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
}

const TTL_MS = config.NODE_ENV === 'test' ? 0 : 10_000;
const cache = new Map<string, { state: SessionState | null; expires: number }>();

export function invalidateSessionCache(userId: string): void {
  cache.delete(userId);
}

/** Current state of a user, or null if the user no longer exists. Cached briefly per process. */
export async function loadSession(userId: string, tenantId: string, fresh = false): Promise<SessionState | null> {
  const hit = fresh ? undefined : cache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.state;

  const row = await runWithTenant(tenantId, () =>
    prisma.user.findFirst({ where: { id: userId }, select: { role: true, status: true, tokenVersion: true } })
  );
  const state = row ? { role: String(row.role), status: String(row.status), tokenVersion: row.tokenVersion ?? 0 } : null;
  if (TTL_MS > 0) {
    if (cache.size > 10_000) cache.clear();
    cache.set(userId, { state, expires: Date.now() + TTL_MS });
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

/** True when a token's user may still use it. */
export function sessionIsValid(state: SessionState | null, tokenVersion: number): state is SessionState {
  return !!state && state.status === 'ACTIVE' && state.tokenVersion === tokenVersion;
}
