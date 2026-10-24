import { Router, Request } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { runWithTenant } from '@enterprise-lms/database';
import { basePrisma, prisma, runInTenantTransaction } from '../lib/prisma';
import { config } from '../config';
import { HttpError, route } from '../lib/http';
import { idSchema, parseBody } from '../lib/validate';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, clearAuthCookie, requireRole, setAuthCookie, tenantIdOf } from '../middleware/auth';
import { requireOperator } from './operator.routes';
import { tenantIsBlocked, TENANT_SUSPENDED_MESSAGE } from '../lib/session';
import { generateOneTimeToken, hashOneTimeToken } from '../lib/one-time-token';
import { rateLimitStore } from '../lib/rate-limit-store';
import { tenantUrl } from '../lib/tenant-url';
import { lookupTenant } from '../lib/tenant';
import {
  activateSupportAccount,
  closeIdleSupportAccount,
  endSupportSession,
  endSupportSessions,
  generateSupportToken,
  HANDOFF_TTL_MS,
  isOperatorTenant,
  passStatus,
  SUPPORT_DURATIONS_HOURS,
  SUPPORT_SCOPES,
  SupportScope,
} from '../lib/support-access';

// Consented support access (lib/support-access.ts).
//   /api/v1/support                   the organisation's side: administrators grant and revoke passes; the
//                                     handoff link is exchanged for a support session; the session can be ended.
//   /api/v1/operator/support-passes   the platform operator's side: passes in force, and entering one.
// Every grant, revocation, entry and exit is in the organisation's audit trail.

const router = Router();
export const operatorSupportRouter = Router();

const ADMIN_ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN'] as const;

const passSelect = {
  id: true,
  scope: true,
  reason: true,
  grantedByEmail: true,
  createdAt: true,
  expiresAt: true,
  revokedAt: true,
  revokedByEmail: true,
  lastEnteredAt: true,
  lastEnteredByEmail: true,
} as const;

const passView = <T extends { revokedAt: Date | null; expiresAt: Date }>(p: T) => ({ ...p, status: passStatus(p) });

const actor = (req: Request) => ({ ipAddress: req.ip, userAgent: req.headers['user-agent'] });

/** A support session cannot hand out or withdraw support access, not even under a FULL pass. */
const refuseSupportSession = (req: Request) => {
  if (req.support) throw new HttpError(403, 'A support session cannot manage support access');
};

// --------------------------------------------------------------------------- the organisation's administrators

export const grantSchema = z
  .object({
    scope: z.enum(SUPPORT_SCOPES).default('READ_ONLY'),
    /** How long the pass lasts: 1, 4, 24 or 72 hours. */
    hours: z.union(
      SUPPORT_DURATIONS_HOURS.map((h) => z.literal(h)) as unknown as [z.ZodLiteral<1>, z.ZodLiteral<4>, z.ZodLiteral<24>, z.ZodLiteral<72>]
    ),
    /** Why support is needed; the operator sees it. */
    reason: z.string().trim().min(5).max(500),
  })
  .strict();

/** GET /api/v1/support/passes: this organisation's support passes, newest first (the last 50). */
router.get(
  '/passes',
  authenticateJWT,
  requireRole(...ADMIN_ROLES),
  route('Failed to list support passes', async (req, res) => {
    const tenantId = tenantIdOf(req);
    await closeIdleSupportAccount(tenantId);
    const rows = await prisma.supportPass.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 50, select: passSelect });
    return res.json({ data: rows.map(passView) });
  })
);

/**
 * POST /api/v1/support/passes: grant the platform operator a support pass. One pass is in force at a time; the
 * operator's own organisation cannot grant one.
 */
router.post(
  '/passes',
  authenticateJWT,
  requireRole(...ADMIN_ROLES),
  route('Failed to grant support access', async (req, res) => {
    refuseSupportSession(req);
    const tenantId = tenantIdOf(req);
    const input = parseBody(req, grantSchema);
    if (await isOperatorTenant(tenantId))
      throw new HttpError(409, 'The platform operator organisation cannot grant support access to itself');
    const me = await prisma.user.findFirst({ where: { id: req.user!.id }, select: { email: true } });

    const pass = await runInTenantTransaction(tenantId, async (tx) => {
      // Serialises grants of one organisation, so two at once cannot both find no pass in force.
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
      const active = await tx.supportPass.count({ where: { tenantId, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (active > 0) throw new HttpError(409, 'Support access is already granted; revoke it first to grant it again');
      return tx.supportPass.create({
        data: {
          tenantId,
          scope: input.scope,
          reason: input.reason,
          grantedById: req.user!.id,
          grantedByEmail: me?.email ?? req.user!.email,
          expiresAt: new Date(Date.now() + input.hours * 3600_000),
        },
        select: passSelect,
      });
    });
    await logAuditEvent({
      tenantId,
      userId: req.user!.id,
      action: 'SUPPORT_ACCESS_GRANTED',
      resourceType: 'SUPPORT_PASS',
      resourceId: pass.id,
      ...actor(req),
      diffJson: { scope: pass.scope, hours: input.hours, expiresAt: pass.expiresAt.toISOString(), reason: pass.reason },
    });
    return res.status(201).json({ data: passView(pass) });
  })
);

/** POST /api/v1/support/passes/:id/revoke: withdraw a pass. Any support session under it ends at once. */
router.post(
  '/passes/:id/revoke',
  authenticateJWT,
  requireRole(...ADMIN_ROLES),
  route('Failed to revoke support access', async (req, res) => {
    refuseSupportSession(req);
    const tenantId = tenantIdOf(req);
    const id = idSchema.parse(req.params.id);
    const pass = await prisma.supportPass.findFirst({ where: { id, tenantId }, select: passSelect });
    if (!pass) throw new HttpError(404, 'Support pass not found');
    if (passStatus(pass) !== 'ACTIVE') throw new HttpError(409, 'This support pass is no longer in force');
    const me = await prisma.user.findFirst({ where: { id: req.user!.id }, select: { email: true } });
    const claimed = await prisma.supportPass.updateMany({
      where: { id, tenantId, revokedAt: null },
      data: { revokedAt: new Date(), revokedByEmail: me?.email ?? req.user!.email },
    });
    if (claimed.count !== 1) throw new HttpError(409, 'This support pass is no longer in force');
    // The pass check alone already refuses the session; this also signs the support account out and frees it.
    await endSupportSessions(tenantId);
    await logAuditEvent({
      tenantId,
      userId: req.user!.id,
      action: 'SUPPORT_ACCESS_REVOKED',
      resourceType: 'SUPPORT_PASS',
      resourceId: id,
      ...actor(req),
      diffJson: { scope: pass.scope, expiresAt: pass.expiresAt.toISOString() },
    });
    const saved = await prisma.supportPass.findFirstOrThrow({ where: { id }, select: passSelect });
    return res.json({ data: passView(saved) });
  })
);

// --------------------------------------------------------------------------- the support session

export const enterSchema = z.object({ token: z.string().min(20).max(200) }).strict();

const enterLimiter = rateLimit({
  store: rateLimitStore('support-enter'),
  passOnStoreError: true,
  windowMs: 15 * 60 * 1000,
  limit: config.TOKEN_FLOW_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again later.' },
});

/**
 * Whether the request's host resolves to the organisation, by the same hints the tenant resolver in server.ts
 * builds, minus the x-tenant-id header (the first hint when sent), which the client chooses.
 */
async function hostNamesTenant(req: Request, tenantId: string): Promise<boolean> {
  const header = req.headers['x-tenant-id'];
  const hints = (req.tenantHints ?? []).slice(typeof header === 'string' && header.trim() ? 1 : 0);
  return (await lookupTenant(hints))?.id === tenantId;
}

const INVALID_LINK = 'This support link is invalid, already used or expired. Enter again from the platform console.';

/**
 * POST /api/v1/support/enter: exchange the one-time handoff token (from /support/enter?token=) for a support
 * session in the pass's organisation. The token works once, for two minutes.
 */
router.post(
  '/enter',
  enterLimiter,
  route('Failed to start the support session', async (req, res) => {
    const { token } = parseBody(req, enterSchema);
    const now = new Date();
    const handoff = await basePrisma.supportHandoff.findUnique({ where: { tokenHash: hashOneTimeToken(token) } });
    if (!handoff || handoff.usedAt || handoff.expiresAt <= now) throw new HttpError(410, INVALID_LINK);
    const claimed = await basePrisma.supportHandoff.updateMany({ where: { id: handoff.id, usedAt: null }, data: { usedAt: now } });
    if (claimed.count !== 1) throw new HttpError(410, INVALID_LINK);
    // Under TENANT_BASE_DOMAIN the session must start at the organisation's own address (its subdomain or custom
    // domain), so its cookie lands there. The link is spent either way; the operator enters again.
    if (config.TENANT_BASE_DOMAIN && !(await hostNamesTenant(req, handoff.tenantId))) throw new HttpError(400, 'Invalid request');

    const tenantId = handoff.tenantId;
    const tenant = await basePrisma.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
    if (!tenant) throw new HttpError(410, INVALID_LINK);
    if (tenantIsBlocked(tenant.status)) throw new HttpError(403, TENANT_SUSPENDED_MESSAGE);

    const { pass, user } = await runInTenantTransaction(tenantId, async (tx) => {
      const pass = await tx.supportPass.findFirst({
        where: { id: handoff.passId },
        select: { id: true, scope: true, expiresAt: true, revokedAt: true },
      });
      if (!pass || passStatus(pass) !== 'ACTIVE') throw new HttpError(410, 'This support pass is no longer in force');
      const user = await activateSupportAccount(tx as any, tenantId);
      await tx.supportPass.update({ where: { id: pass.id }, data: { lastEnteredAt: now, lastEnteredByEmail: handoff.operatorEmail } });
      return { pass, user };
    });
    const session = { passId: pass.id, scope: pass.scope as SupportScope, expiresAt: pass.expiresAt, operatorEmail: handoff.operatorEmail };
    setAuthCookie(res, generateSupportToken({ id: user.id, tenantId, tokenVersion: user.tokenVersion }, session));
    await runWithTenant(tenantId, () =>
      logAuditEvent({
        tenantId,
        userId: user.id,
        action: 'SUPPORT_SESSION_STARTED',
        resourceType: 'SUPPORT_PASS',
        resourceId: pass.id,
        ...actor(req),
        diffJson: { operatorEmail: handoff.operatorEmail, scope: pass.scope, expiresAt: pass.expiresAt.toISOString() },
      })
    );
    return res.json({ data: session });
  })
);

/** GET /api/v1/support/session: the current support session (for the banner), or null for an ordinary session. */
router.get(
  '/session',
  authenticateJWT,
  route('Failed to load the support session', async (req, res) => res.json({ data: req.support ?? null }))
);

/**
 * POST /api/v1/support/exit: end the support session (the pass stays in force until it expires or is revoked).
 * Answers where to go next: the platform console.
 */
router.post(
  '/exit',
  authenticateJWT,
  route('Failed to end the support session', async (req, res) => {
    if (!(await endSupportSession(req, 'exit'))) throw new HttpError(409, 'This is not a support session');
    clearAuthCookie(res);
    const operator = config.PLATFORM_OPERATOR_TENANT
      ? await basePrisma.tenant.findUnique({ where: { slug: config.PLATFORM_OPERATOR_TENANT }, select: { slug: true, customDomain: true } })
      : null;
    return res.json({ data: { redirect: operator ? `${tenantUrl(operator)}/platform` : '/login' } });
  })
);

// --------------------------------------------------------------------------- the platform operator

// Scoped to its own paths: this router is mounted ahead of operator.routes.ts, whose guards cover the rest.
operatorSupportRouter.use('/support-passes', authenticateJWT, requireRole('SUPER_ADMIN'), requireOperator);

interface ActivePassRow {
  id: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  tenant_status: string;
  scope: string;
  reason: string;
  granted_by_email: string;
  created_at: Date;
  expires_at: Date;
  last_entered_at: Date | null;
  last_entered_by_email: string | null;
}

/** Passes in force across organisations (the database function sees past row-level security; see the migration). */
const activePasses = async () =>
  (await basePrisma.$queryRaw<ActivePassRow[]>`SELECT * FROM active_support_passes()`).map((r) => ({
    id: r.id,
    organization: { id: r.tenant_id, slug: r.tenant_slug, name: r.tenant_name, status: r.tenant_status },
    scope: r.scope,
    reason: r.reason,
    grantedByEmail: r.granted_by_email,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    lastEnteredAt: r.last_entered_at,
    lastEnteredByEmail: r.last_entered_by_email,
  }));

/** GET /api/v1/operator/support-passes: support passes in force, soonest to expire first. */
operatorSupportRouter.get(
  '/support-passes',
  route('Failed to list support passes', async (req, res) => {
    const own = tenantIdOf(req);
    return res.json({ data: (await activePasses()).filter((p) => p.organization.id !== own) });
  })
);

/**
 * POST /api/v1/operator/support-passes/:id/enter: a one-time link (valid two minutes) that opens a support session
 * at the organisation's own address.
 */
operatorSupportRouter.post(
  '/support-passes/:id/enter',
  route('Failed to enter the organisation', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const pass = (await activePasses()).find((p) => p.id === id);
    if (!pass) throw new HttpError(404, 'Support pass not found, or no longer in force');
    if (pass.organization.id === tenantIdOf(req))
      throw new HttpError(409, 'The platform operator organisation cannot be entered with a support pass');
    if (tenantIsBlocked(pass.organization.status)) throw new HttpError(409, 'This organisation is suspended');
    const tenant = await basePrisma.tenant.findUniqueOrThrow({
      where: { id: pass.organization.id },
      select: { slug: true, customDomain: true },
    });
    const me = await prisma.user.findFirst({ where: { id: req.user!.id }, select: { email: true } });
    const operatorEmail = me?.email ?? req.user!.email;

    const { token, tokenHash } = generateOneTimeToken();
    const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS);
    await basePrisma.supportHandoff.create({
      data: { tenantId: pass.organization.id, passId: id, tokenHash, operatorUserId: req.user!.id, operatorEmail, expiresAt },
    });
    await logAuditEvent({
      tenantId: tenantIdOf(req),
      userId: req.user!.id,
      action: 'SUPPORT_HANDOFF_ISSUED',
      resourceType: 'SUPPORT_PASS',
      resourceId: id,
      ...actor(req),
      diffJson: { tenant: pass.organization.slug, scope: pass.scope },
    });
    return res.json({ data: { url: `${tenantUrl(tenant)}/support/enter?token=${token}`, expiresAt } });
  })
);

export default router;
