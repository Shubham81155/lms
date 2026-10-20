import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma, prisma } from './prisma';
import { invalidateSessionCache } from './session';
import { logAuditEvent } from './audit';
import { logger } from './logger';

// Consented support access. An organisation's administrator grants the platform operator a time-limited support
// pass (READ_ONLY by default, or FULL). The operator enters through a one-time handoff link at the organisation's
// own address (routes/support.routes.ts), and works there as the organisation's "Platform support" account: one
// per organisation, an administrator that cannot sign in any other way. Its session carries the pass id (`sp`)
// and the operator's e-mail (`op`), and every request re-checks the pass, so revoking it or its expiry ends the
// session at once. Between sessions the account is SUSPENDED, so it takes no seat.

export const SUPPORT_SCOPES = ['READ_ONLY', 'FULL'] as const;
export type SupportScope = (typeof SUPPORT_SCOPES)[number];

/** Durations an administrator can choose, in hours. 72 hours is the longest a pass lasts. */
export const SUPPORT_DURATIONS_HOURS = [1, 4, 24, 72] as const;

/** How long the handoff link the operator's browser follows stays usable. */
export const HANDOFF_TTL_MS = 2 * 60 * 1000;

/** The organisation's support account. `.invalid` never delivers mail, so no message reaches anyone through it. */
export const SUPPORT_USER_EMAIL = 'platform-support@support.invalid';

/** Shown when a read-only support session tries to change something. */
export const SUPPORT_READ_ONLY_MESSAGE = 'Support access is read-only: changes are not allowed.';

export interface SupportSession {
  passId: string;
  scope: SupportScope;
  expiresAt: Date;
  operatorEmail: string;
}

declare global {
  namespace Express {
    interface Request {
      /** Set by authentication for a platform-operator support session (the session's pass is still in force). */
      support?: SupportSession;
    }
  }
}

type PassState = { revokedAt: Date | null; expiresAt: Date };

/** ACTIVE while the pass can be used; otherwise how it ended. */
export function passStatus(p: PassState, now = new Date()): 'ACTIVE' | 'REVOKED' | 'EXPIRED' {
  if (p.revokedAt) return 'REVOKED';
  return p.expiresAt > now ? 'ACTIVE' : 'EXPIRED';
}

/** True for the platform operator's own organisation, which cannot be the target of a support pass. */
export async function isOperatorTenant(tenantId: string): Promise<boolean> {
  if (!config.PLATFORM_OPERATOR_TENANT) return false;
  const t = await basePrisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
  return t?.slug === config.PLATFORM_OPERATOR_TENANT;
}

/**
 * The support session of a token's pass, or null when the pass was revoked or has expired. Not cached: support
 * sessions are rare, and a revocation must apply in every API process at once.
 */
export async function loadSupportSession(passId: string, tenantId: string, operatorEmail: string): Promise<SupportSession | null> {
  const pass = await runWithTenant(tenantId, () =>
    prisma.supportPass.findFirst({ where: { id: passId }, select: { scope: true, expiresAt: true, revokedAt: true } })
  );
  if (!pass) return null;
  const status = passStatus(pass);
  if (status !== 'ACTIVE') {
    // An expired pass leaves the support account active until something closes it; do that now.
    if (status === 'EXPIRED') closeIdleSupportAccount(tenantId).catch((err) => logger.warn({ err, tenantId }, 'could not close the support account'));
    return null;
  }
  return { passId, scope: pass.scope as SupportScope, expiresAt: pass.expiresAt, operatorEmail };
}

/** Signs a support session token: valid until the pass expires, stamped with the account's token version. */
export function generateSupportToken(user: { id: string; tenantId: string; tokenVersion: number }, session: SupportSession): string {
  const seconds = Math.max(1, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
  return jwt.sign(
    { id: user.id, role: 'TENANT_ADMIN', email: SUPPORT_USER_EMAIL, tenantId: user.tenantId, tv: user.tokenVersion, sp: session.passId, op: session.operatorEmail },
    config.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: seconds }
  );
}

type UserClient = { user: { findFirst: (args: any) => Promise<any>; create: (args: any) => Promise<any>; update: (args: any) => Promise<any> } };

/**
 * Makes the organisation's support account usable (creating it the first time) and returns it. Deliberately not
 * counted against the seat quota: it is active only during support sessions.
 */
export async function activateSupportAccount(client: UserClient, tenantId: string): Promise<{ id: string; tokenVersion: number }> {
  const existing = await client.user.findFirst({ where: { tenantId, email: SUPPORT_USER_EMAIL }, select: { id: true } });
  const select = { id: true, tokenVersion: true };
  if (existing) return client.user.update({ where: { id: existing.id }, data: { status: 'ACTIVE', role: 'TENANT_ADMIN' }, select });
  return client.user.create({
    data: { tenantId, email: SUPPORT_USER_EMAIL, firstName: 'Platform', lastName: 'support', role: 'TENANT_ADMIN', status: 'ACTIVE', emailVerified: true, idpProvider: 'SUPPORT' },
    select,
  });
}

/** Ends every support session in the organisation: the account is suspended and its tokens revoked. */
export async function endSupportSessions(tenantId: string): Promise<string | null> {
  const user = await runWithTenant(tenantId, async () => {
    const u = await prisma.user.findFirst({ where: { tenantId, email: SUPPORT_USER_EMAIL }, select: { id: true } });
    if (u) await prisma.user.update({ where: { id: u.id }, data: { status: 'SUSPENDED', tokenVersion: { increment: 1 } } });
    return u;
  });
  if (user) invalidateSessionCache(user.id);
  return user?.id ?? null;
}

/** Suspends the support account when no pass is in force any more (after one expired without being revoked). */
export async function closeIdleSupportAccount(tenantId: string): Promise<void> {
  const active = await runWithTenant(tenantId, () =>
    prisma.supportPass.count({ where: { tenantId, revokedAt: null, expiresAt: { gt: new Date() } } })
  );
  if (active > 0) return;
  const open = await runWithTenant(tenantId, () =>
    prisma.user.count({ where: { tenantId, email: SUPPORT_USER_EMAIL, status: 'ACTIVE' } })
  );
  if (open > 0) await endSupportSessions(tenantId);
}

// --------------------------------------------------------------------------- the guard

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

const auditedWrites = new WeakSet<Request>();

/** Changes a read-only support session may still make: leaving. */
const ALLOWED = [/^\/api\/v1\/auth\/logout$/, /^\/api\/v1\/support\/exit$/];

/**
 * Called by authenticateJWT for support sessions (like lib/trial-guard.ts). A READ_ONLY session gets 403 for any
 * change; a FULL session's changes are let through and each is audit-logged in the organisation's trail once
 * answered. Returns true when it answered the request.
 */
export function refuseSupportWrite(req: Request, res: Response): boolean {
  const support = req.support;
  if (!support || SAFE_METHODS.includes(req.method)) return false;
  const path = req.originalUrl.split('?')[0];
  if (ALLOWED.some((re) => re.test(path))) return false;
  if (support.scope !== 'FULL') {
    res.status(403).json({ error: SUPPORT_READ_ONLY_MESSAGE, code: 'SUPPORT_READ_ONLY' });
    return true;
  }
  // Authentication can run more than once for a request (a router's guard and the route's own): audit it once.
  if (auditedWrites.has(req)) return false;
  auditedWrites.add(req);
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  res.on('finish', () => {
    runWithTenant(tenantId, () =>
      logAuditEvent({
        tenantId, userId, action: 'SUPPORT_WRITE', resourceType: 'SUPPORT_PASS', resourceId: support.passId,
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
        diffJson: { operatorEmail: support.operatorEmail, method: req.method, path, status: res.statusCode },
      })
    ).catch(() => undefined);
  });
  return false;
}

/**
 * Ends the request's support session, if it is one: the support account is suspended and its tokens revoked, and
 * the end is audited. Used by POST /support/exit and by ordinary sign-out (POST /auth/logout).
 */
export async function endSupportSession(req: Request, via: 'exit' | 'logout'): Promise<boolean> {
  const support = req.support;
  if (!support || !req.user) return false;
  const tenantId = req.user.tenantId;
  await endSupportSessions(tenantId);
  await runWithTenant(tenantId, () =>
    logAuditEvent({
      tenantId, userId: req.user!.id, action: 'SUPPORT_SESSION_ENDED', resourceType: 'SUPPORT_PASS', resourceId: support.passId,
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
      diffJson: { operatorEmail: support.operatorEmail, scope: support.scope, via },
    })
  );
  return true;
}
