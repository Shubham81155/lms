import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { runWithTenant } from '@enterprise-lms/database';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { HttpError, handleError, route } from '../lib/http';
import { idSchema, parseBody } from '../lib/validate';
import { FEATURE_KEYS, resolveFeatures } from '../lib/features';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, requireRole, tenantIdOf } from '../middleware/auth';

// Mounted at /api/v1/operator. The platform operator manages every organisation's plan: tier, feature
// overrides and seat quota. Organisations' own administrators can read their plan but not change it.
// Operators are super administrators of the organisation named by PLATFORM_OPERATOR_TENANT; with that
// unset, plans can only be changed in the database.

const router = Router();

async function requireOperator(req: Request, res: Response, next: NextFunction) {
  try {
    if (!config.PLATFORM_OPERATOR_TENANT) throw new HttpError(403, 'No platform operator organisation is configured');
    const own = await prisma.tenant.findUnique({ where: { id: tenantIdOf(req) }, select: { slug: true } });
    if (own?.slug !== config.PLATFORM_OPERATOR_TENANT) throw new HttpError(403, 'Forbidden: platform operators only');
  } catch (err) {
    return handleError(req, res, err, 'Failed to check operator access');
  }
  next();
}

router.use(authenticateJWT, requireRole('SUPER_ADMIN'), requireOperator);

const TIERS = ['STARTER', 'PROFESSIONAL', 'ENTERPRISE'] as const;

/** Seats in use: active and invited accounts. Users are tenant-scoped, so count inside that tenant's context. */
const seatsUsed = (tenantId: string) => runWithTenant(tenantId, () => prisma.user.count({ where: { tenantId, status: { in: ['ACTIVE', 'INVITED'] } } }));

const view = async (t: { id: string; slug: string; name: string; tier: string; status: string; seatQuota: number | null; featureFlags: unknown; customDomain: string | null }) => ({
  id: t.id,
  slug: t.slug,
  name: t.name,
  customDomain: t.customDomain,
  tier: t.tier,
  status: t.status,
  seatQuota: t.seatQuota,
  seatsUsed: await seatsUsed(t.id),
  features: resolveFeatures(t.tier, t.featureFlags),
  /** Features set explicitly for this organisation, overriding the tier's defaults. */
  overrides: Object.fromEntries(FEATURE_KEYS.flatMap((k) => (typeof (t.featureFlags as any)?.[k] === 'boolean' ? [[k, (t.featureFlags as any)[k]]] : []))),
});

const tenantSelect = { id: true, slug: true, name: true, tier: true, status: true, seatQuota: true, featureFlags: true, customDomain: true } as const;

/** GET /api/v1/operator/tenants: every organisation with its plan and seat use. */
router.get(
  '/tenants',
  route('Failed to list organisations', async (_req, res) => {
    const tenants = await prisma.tenant.findMany({ orderBy: { name: 'asc' }, select: tenantSelect });
    return res.json({ data: await Promise.all(tenants.map(view)) });
  })
);

export const planSchema = z
  .object({
    tier: z.enum(TIERS).optional(),
    /** null removes the limit. */
    seatQuota: z.number().int().min(1).max(10_000_000).nullable().optional(),
    /** true/false overrides the tier's default; null goes back to the default. */
    features: z
      .object(Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean().nullable().optional()])) as Record<(typeof FEATURE_KEYS)[number], z.ZodOptional<z.ZodNullable<z.ZodBoolean>>>)
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

/** PATCH /api/v1/operator/tenants/:id: change an organisation's plan. Audited in both organisations. */
router.patch(
  '/tenants/:id',
  route('Failed to update the plan', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const input = parseBody(req, planSchema);
    const before = await prisma.tenant.findUnique({ where: { id }, select: tenantSelect });
    if (!before) throw new HttpError(404, 'Organisation not found');

    if (input.seatQuota != null) {
      const used = await seatsUsed(id);
      if (input.seatQuota < used) throw new HttpError(409, `The quota cannot be below the ${used} seats already in use`);
    }
    let featureFlags: Record<string, boolean> | undefined;
    if (input.features) {
      featureFlags = { ...((before.featureFlags as Record<string, boolean>) ?? {}) };
      for (const [k, v] of Object.entries(input.features)) {
        if (v === null) delete featureFlags[k];
        else if (v !== undefined) featureFlags[k] = v;
      }
    }
    const updated = await prisma.tenant.update({
      where: { id },
      data: { tier: input.tier, ...(input.seatQuota !== undefined ? { seatQuota: input.seatQuota } : {}), ...(featureFlags ? { featureFlags } : {}) },
      select: tenantSelect,
    });

    const diffJson = {
      tenant: before.slug,
      before: { tier: before.tier, seatQuota: before.seatQuota, featureFlags: before.featureFlags },
      after: { tier: updated.tier, seatQuota: updated.seatQuota, featureFlags: updated.featureFlags },
    };
    const entry = { userId: req.user!.id, action: 'TENANT_PLAN_UPDATED', resourceType: 'TENANT', resourceId: id, ipAddress: req.ip, userAgent: req.headers['user-agent'], diffJson };
    await logAuditEvent({ ...entry, tenantId: tenantIdOf(req) });
    // The organisation's own audit trail shows the change too; the operator's user id is not one of its users.
    if (id !== tenantIdOf(req)) await runWithTenant(id, () => logAuditEvent({ ...entry, tenantId: id, userId: undefined }));
    return res.json({ data: await view(updated) });
  })
);

export default router;
