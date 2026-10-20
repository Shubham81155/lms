import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { runWithTenant } from '@enterprise-lms/database';
import { basePrisma, prisma } from '../lib/prisma';
import { config } from '../config';
import { HttpError, handleError, route } from '../lib/http';
import { idSchema, pageMeta, paginationShape, parseBody, parseQuery } from '../lib/validate';
import { FEATURE_KEYS, resolveFeatures } from '../lib/features';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, requireRole, tenantIdOf } from '../middleware/auth';
import { createOrganization, mailApplicant, orgSlugSchema, requestedAddress } from '../lib/organizations';
import { logger } from '../lib/logger';
import { invalidateTenantSessions } from '../lib/session';
import { isUnderBaseDomain, platformHostnames } from '../lib/platform-hosts';

// Mounted at /api/v1/operator. The platform operator decides organisation registration requests, creates and
// suspends organisations, and manages every organisation's plan: tier, feature overrides and seat quota. Organisations' own administrators can read their plan but not change it.
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

export const view = async (t: { id: string; slug: string; name: string; tier: string; status: string; seatQuota: number | null; featureFlags: unknown; customDomain: string | null }) => ({
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

// --------------------------------------------------------------------------- creating and suspending organisations

const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Enter a domain such as learn.university.edu')
  // The base domain and its subdomains are the platform's and other organisations' addresses (the API looks a
  // host there up by its subdomain only), and the platform's own hosts are not an organisation's to take.
  .refine((d) => !isUnderBaseDomain(d), 'Use a domain of the organisation, not an address under the platform domain')
  .refine((d) => !platformHostnames().includes(d), 'That domain is one of the platform addresses');

export const createTenantSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: orgSlugSchema,
    tier: z.enum(TIERS).default('STARTER'),
    seatQuota: z.number().int().min(1).max(10_000_000).nullable().default(100),
    customDomain: hostname.optional(),
    adminFirstName: z.string().trim().min(1).max(100),
    adminLastName: z.string().trim().min(1).max(100),
    adminEmail: z.string().trim().toLowerCase().email().max(254),
  })
  .strict();

const actorOf = (req: Request) => ({ tenantId: tenantIdOf(req), userId: req.user!.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] });

/** POST /api/v1/operator/tenants: create an organisation directly; its first administrator gets an invitation. */
router.post(
  '/tenants',
  route('Failed to create the organisation', async (req, res) => {
    const input = parseBody(req, createTenantSchema);
    const { tenant, invitation } = await createOrganization(
      {
        name: input.name, slug: input.slug, tier: input.tier, seatQuota: input.seatQuota, customDomain: input.customDomain ?? null,
        admin: { email: input.adminEmail, firstName: input.adminFirstName, lastName: input.adminLastName },
      },
      actorOf(req),
      { via: 'OPERATOR' }
    );
    return res.status(201).json({ data: { organization: await view(tenant), invitation } });
  })
);

export const tenantStatusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }).strict();

/**
 * PATCH /api/v1/operator/tenants/:id/status: suspend an organisation (nobody can sign in to it) or make it
 * active again. The operator's own organisation cannot be suspended.
 */
router.patch(
  '/tenants/:id/status',
  route('Failed to change the organisation status', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { status } = parseBody(req, tenantStatusSchema);
    if (id === tenantIdOf(req)) throw new HttpError(409, 'The platform operator organisation cannot be suspended');
    const before = await prisma.tenant.findUnique({ where: { id }, select: tenantSelect });
    if (!before) throw new HttpError(404, 'Organisation not found');
    const updated = await prisma.tenant.update({ where: { id }, data: { status }, select: tenantSelect });
    invalidateTenantSessions(id);
    const entry = {
      userId: req.user!.id, action: status === 'SUSPENDED' ? 'TENANT_SUSPENDED' : 'TENANT_REACTIVATED', resourceType: 'TENANT', resourceId: id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], diffJson: { tenant: before.slug, before: before.status, after: status },
    };
    await logAuditEvent({ ...entry, tenantId: tenantIdOf(req) });
    await runWithTenant(id, () => logAuditEvent({ ...entry, tenantId: id, userId: undefined }));
    return res.json({ data: await view(updated) });
  })
);

// --------------------------------------------------------------------------- registration requests

// Only requests whose applicant confirmed their e-mail reach the operator (UNVERIFIED ones are never listed).
const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const requestListQuery = z.object({ status: z.enum(REQUEST_STATUSES).default('PENDING'), ...paginationShape, limit: paginationShape.limit.default(25) });

const requestSelect = {
  id: true, organizationName: true, slug: true, institutionType: true, country: true, website: true, expectedLearners: true,
  contactFirstName: true, contactLastName: true, contactEmail: true, contactPhone: true, message: true,
  status: true, decisionNote: true, decidedAt: true, decidedByEmail: true, createdTenantId: true, createdAt: true,
  verifiedAt: true, holdExpiresAt: true,
} as const;

type RequestRow = { status: string; holdExpiresAt: Date | null } & Record<string, unknown>;

/** `expired`: waiting longer than its hold on the address lasts, so it no longer keeps others from the address. */
const requestView = <T extends RequestRow>(r: T) => ({ ...r, expired: r.status === 'PENDING' && (!r.holdExpiresAt || r.holdExpiresAt <= new Date()) });

/** GET /api/v1/operator/requests?status=&page=&limit=: organisation registration requests, newest first, a page at a time. */
router.get(
  '/requests',
  route('Failed to list requests', async (req, res) => {
    const { status, page, limit } = parseQuery(req, requestListQuery);
    const where = { status };
    const [rows, total] = await Promise.all([
      basePrisma.organizationRequest.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit, select: requestSelect }),
      basePrisma.organizationRequest.count({ where }),
    ]);
    return res.json({ data: rows.map(requestView), pagination: pageMeta(page, limit, total) });
  })
);

export const approveSchema = z
  .object({
    tier: z.enum(TIERS).default('STARTER'),
    seatQuota: z.number().int().min(1).max(10_000_000).nullable().default(100),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

const deciderEmail = async (req: Request) => (await prisma.user.findFirst({ where: { id: req.user!.id }, select: { email: true } }))?.email ?? null;

/**
 * POST /api/v1/operator/requests/:id/approve: creates the organisation from the request, with the contact as
 * its first administrator (invited to choose a password). A request is decided once. Other open requests for
 * the same address are closed.
 */
router.post(
  '/requests/:id/approve',
  route('Failed to approve the request', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const input = parseBody(req, approveSchema);
    const request = await basePrisma.organizationRequest.findUnique({ where: { id } });
    if (!request || request.status === 'UNVERIFIED') throw new HttpError(404, 'Request not found');

    // Claim it first, so two operators approving at once cannot both create an organisation.
    const claimed = await basePrisma.organizationRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'APPROVED', decidedAt: new Date(), decidedByEmail: await deciderEmail(req), decisionNote: input.note ?? null },
    });
    if (claimed.count !== 1) throw new HttpError(409, 'This request has already been decided');

    let created;
    try {
      // Links the request to the new organisation in the same transaction, and does not throw once that committed.
      created = await createOrganization(
        {
          name: request.organizationName, slug: request.slug, tier: input.tier, seatQuota: input.seatQuota,
          admin: { email: request.contactEmail, firstName: request.contactFirstName, lastName: request.contactLastName },
        },
        actorOf(req),
        { via: 'REQUEST', requestId: id }
      );
    } catch (err) {
      // Nothing was created: put the request back so it can be decided again. A failure here must not hide
      // why the approval failed.
      try {
        await basePrisma.organizationRequest.updateMany({
          where: { id, status: 'APPROVED', createdTenantId: null },
          data: { status: 'PENDING', decidedAt: null, decidedByEmail: null, decisionNote: null },
        });
      } catch (rollbackErr) {
        logger.error({ err: rollbackErr, requestId: id }, 'could not put a failed approval back to pending');
      }
      throw err;
    }
    try {
      await logAuditEvent({
        tenantId: tenantIdOf(req), userId: req.user!.id, action: 'ORGANIZATION_REQUEST_APPROVED', resourceType: 'ORGANIZATION_REQUEST', resourceId: id,
        ipAddress: req.ip, userAgent: req.headers['user-agent'], diffJson: { slug: request.slug, tier: input.tier, seatQuota: input.seatQuota, tenantId: created.tenant.id },
      });
    } catch (err) {
      logger.error({ err, requestId: id }, 'request approved, but the audit entry failed');
    }
    const saved = await basePrisma.organizationRequest.findUniqueOrThrow({ where: { id }, select: requestSelect });
    return res.json({ data: { request: requestView(saved), organization: await view(created.tenant), invitation: created.invitation } });
  })
);

export const rejectSchema = z.object({ reason: z.string().trim().min(5).max(1000) }).strict();

/** POST /api/v1/operator/requests/:id/reject: declines the request, frees its address and e-mails the applicant the reason. */
router.post(
  '/requests/:id/reject',
  route('Failed to reject the request', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { reason } = parseBody(req, rejectSchema);
    const request = await basePrisma.organizationRequest.findUnique({ where: { id } });
    if (!request || request.status === 'UNVERIFIED') throw new HttpError(404, 'Request not found');
    const decided = await basePrisma.organizationRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', holdsSlug: false, decidedAt: new Date(), decidedByEmail: await deciderEmail(req), decisionNote: reason },
    });
    if (decided.count !== 1) throw new HttpError(409, 'This request has already been decided');

    await mailApplicant(
      request.contactEmail,
      'Your organisation request',
      `Hello ${request.contactFirstName},\n\nThank you for your interest. We are not able to set up ${request.organizationName} on the learning platform at this time.\n\nRequested address: ${requestedAddress(request.slug)}\n\nReason: ${reason}\n\nIf you have questions, reply to this email.`
    );
    await logAuditEvent({
      tenantId: tenantIdOf(req), userId: req.user!.id, action: 'ORGANIZATION_REQUEST_REJECTED', resourceType: 'ORGANIZATION_REQUEST', resourceId: id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], diffJson: { slug: request.slug, reason },
    });
    return res.json({ data: requestView(await basePrisma.organizationRequest.findUniqueOrThrow({ where: { id }, select: requestSelect })) });
  })
);

export default router;
