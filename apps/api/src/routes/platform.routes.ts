import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, requireRole, tenantIdOf } from '../middleware/auth';
import { HttpError, route } from '../lib/http';
import { logger } from '../lib/logger';
import { JsonObjectStream } from '../lib/json-stream';
import { idSchema, parseBody } from '../lib/validate';
import { FEATURE_KEYS, resolveFeatures, tenantFeatures } from '../lib/features';
import { assertSafeWebhookUrl, deliverWebhook, WEBHOOK_EVENTS } from '../lib/webhooks';
import { hashOneTimeToken } from '../lib/one-time-token';
import { newScimToken } from './scim.routes';
import { discover } from '../lib/oidc';
import { encryptSecret } from '../lib/mfa';
import { allowedOrigins, redirectUrisFor } from '../lib/sso-origin';
import { SamlError, acsUrl, parseIdpKey, spEntityId } from '../lib/saml';

// Mounted at /api/v1/admin (after admin.routes): feature flags, usage metering, tenant data
// export, webhooks and SCIM token management. Administrators only.

const router = Router();
router.use(authenticateJWT, requireRole('SUPER_ADMIN', 'TENANT_ADMIN'));

const audit = (req: any, action: string, resourceType: string, resourceId?: string, diffJson?: unknown) =>
  logAuditEvent({
    tenantId: tenantIdOf(req), userId: req.user!.id, action, resourceType, resourceId, diffJson,
    ipAddress: req.ip, userAgent: req.headers['user-agent'],
  });

// --------------------------------------------------------------------------- feature flags

export const featuresSchema = z
  .object(Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean().optional()])) as Record<(typeof FEATURE_KEYS)[number], z.ZodOptional<z.ZodBoolean>>)
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

router.get(
  '/features',
  route('Failed to load features', async (req, res) => res.json({ data: await tenantFeatures(tenantIdOf(req)) }))
);

/** PUT /api/v1/admin/features: toggles features for this tenant (overrides the plan's defaults). */
router.put(
  '/features',
  route('Failed to update features', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const patch = parseBody(req, featuresSchema);
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { tier: true, featureFlags: true } });
    if (!tenant) throw new HttpError(404, 'Tenant not found');
    const merged = { ...((tenant.featureFlags as object) ?? {}), ...patch };
    await prisma.tenant.update({ where: { id: tenantId }, data: { featureFlags: merged } });
    await audit(req, 'TENANT_FEATURES_UPDATED', 'TENANT', tenantId, patch);
    return res.json({ data: resolveFeatures(tenant.tier, merged) });
  })
);

// --------------------------------------------------------------------------- usage metering

export const quotaSchema = z.object({ seatQuota: z.number().int().min(1).max(10_000_000).nullable() });

/** GET /api/v1/admin/usage: seats, activity and volume for billing and capacity planning. */
router.get(
  '/usage',
  route('Failed to load usage', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [tenant, byRole, byStatus, active, courses, enrollments, statements, submissions, certificates] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { tier: true, seatQuota: true } }),
      prisma.user.groupBy({ by: ['role'], where: { tenantId }, _count: true }),
      prisma.user.groupBy({ by: ['status'], where: { tenantId }, _count: true }),
      prisma.user.count({ where: { tenantId, lastLoginAt: { gte: since } } }),
      prisma.course.count({ where: { tenantId } }),
      prisma.enrollment.count({ where: { tenantId } }),
      prisma.xapiStatement.count({ where: { tenantId, timestamp: { gte: since } } }),
      prisma.assignmentSubmission.count({ where: { assignment: { tenantId }, submittedAt: { gte: since } } }),
      prisma.certificate.count({ where: { enrollment: { tenantId } } }),
    ]);
    const statusCount = Object.fromEntries(byStatus.map((s) => [s.status, s._count]));
    const seatsUsed = (statusCount.ACTIVE ?? 0) + (statusCount.INVITED ?? 0);
    return res.json({
      data: {
        tier: tenant?.tier,
        seats: {
          used: seatsUsed,
          quota: tenant?.seatQuota ?? null,
          remaining: tenant?.seatQuota == null ? null : Math.max(0, tenant.seatQuota - seatsUsed),
          byRole: Object.fromEntries(byRole.map((r) => [r.role, r._count])),
          byStatus: statusCount,
        },
        last30Days: { activeUsers: active, xapiStatements: statements, assignmentSubmissions: submissions },
        totals: { courses, enrollments, certificates },
      },
    });
  })
);

router.put(
  '/usage/quota',
  route('Failed to update seat quota', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { seatQuota } = parseBody(req, quotaSchema);
    if (seatQuota !== null) {
      const used = await prisma.user.count({ where: { tenantId, status: { in: ['ACTIVE', 'INVITED'] } } });
      if (seatQuota < used) throw new HttpError(409, `Quota cannot be below the ${used} seats already in use`);
    }
    await prisma.tenant.update({ where: { id: tenantId }, data: { seatQuota } });
    await audit(req, 'TENANT_SEAT_QUOTA_UPDATED', 'TENANT', tenantId, { seatQuota });
    return res.json({ data: { seatQuota } });
  })
);

// --------------------------------------------------------------------------- data export

/**
 * GET /api/v1/admin/export: portable JSON of the tenant's records (no credentials or secrets).
 * Streamed in pages of 1000 rows so a large tenant does not have to fit in memory.
 */
const EXPORT_PAGE = 1000;
const pageArgs = (cursor: string | undefined) => ({ orderBy: { id: 'asc' as const }, take: EXPORT_PAGE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });

router.get(
  '/export',
  route('Failed to export tenant data', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, slug: true, name: true, tier: true, customDomain: true, dataRegion: true, createdAt: true } });
    res.status(200);
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="tenant-export-${tenant?.slug ?? 'data'}.json"`);

    const out = new JsonObjectStream(res);
    try {
      await out.start();
      await out.value('exportedAt', new Date().toISOString());
      await out.value('tenant', tenant);
      const users = await out.array('users', (c) =>
        prisma.user.findMany({ where: { tenantId }, select: { id: true, email: true, firstName: true, lastName: true, role: true, status: true, createdAt: true, lastLoginAt: true }, ...pageArgs(c) }), EXPORT_PAGE);
      await out.array('campuses', (c) => prisma.campus.findMany({ where: { tenantId }, include: { departments: true }, ...pageArgs(c) }), EXPORT_PAGE);
      const courses = await out.array('courses', (c) =>
        prisma.course.findMany({ where: { tenantId }, include: { modules: { include: { lessons: true } }, instructors: { select: { userId: true, isPrimary: true } } }, ...pageArgs(c) }), EXPORT_PAGE);
      await out.array('enrollments', (c) => prisma.enrollment.findMany({ where: { tenantId }, ...pageArgs(c) }), EXPORT_PAGE);
      await out.array('certificates', (c) => prisma.certificate.findMany({ where: { enrollment: { tenantId } }, ...pageArgs(c) }), EXPORT_PAGE);
      // Recorded before the response ends, so a client that has the whole file can already find the audit entry.
      await audit(req, 'TENANT_DATA_EXPORTED', 'TENANT', tenantId, { users, courses });
      await out.end();
    } catch (err) {
      // Headers are already sent, so a status code can no longer be changed: cut the connection so the
      // client sees a truncated (invalid) download instead of a file that looks complete.
      if (!res.headersSent) throw err;
      logger.error({ err, requestId: req.id, tenantId }, 'tenant export failed mid-stream');
      res.destroy();
    }
  })
);

// --------------------------------------------------------------------------- webhooks

export const endpointSchema = z.object({
  url: z.string().url().max(2048),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
  isActive: z.boolean().optional(),
});

const safeUrl = (url: string) => {
  try {
    assertSafeWebhookUrl(url);
  } catch (e: any) {
    throw new HttpError(400, e.message);
  }
};
const endpointView = (e: any) => ({ id: e.id, url: e.url, events: e.events, isActive: e.isActive, createdAt: e.createdAt });

router.get(
  '/webhooks',
  route('Failed to list webhooks', async (req, res) => {
    const rows = await prisma.webhookEndpoint.findMany({ where: { tenantId: tenantIdOf(req) }, orderBy: { createdAt: 'desc' } });
    return res.json({ data: rows.map(endpointView) });
  })
);

/** POST /api/v1/admin/webhooks: the signing secret is returned once, here only. */
router.post(
  '/webhooks',
  route('Failed to create webhook', async (req, res) => {
    const tenantId = tenantIdOf(req);
    if (!(await tenantFeatures(tenantId)).webhooks) throw new HttpError(403, 'Webhooks are not enabled for this organisation');
    const body = parseBody(req, endpointSchema);
    safeUrl(body.url);
    const secret = `whsec_${crypto.randomBytes(24).toString('base64url')}`;
    const row = await prisma.webhookEndpoint.create({ data: { tenantId, url: body.url, events: [...new Set(body.events)], isActive: body.isActive ?? true, secret } });
    await audit(req, 'WEBHOOK_CREATED', 'WEBHOOK', row.id, { url: body.url, events: body.events });
    return res.status(201).json({ data: { ...endpointView(row), secret } });
  })
);

router.patch(
  '/webhooks/:id',
  route('Failed to update webhook', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const body = parseBody(req, endpointSchema.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to change'));
    if (body.url) safeUrl(body.url);
    const r = await prisma.webhookEndpoint.updateMany({ where: { id, tenantId: tenantIdOf(req) }, data: body });
    if (r.count === 0) throw new HttpError(404, 'Webhook not found');
    await audit(req, 'WEBHOOK_UPDATED', 'WEBHOOK', id, body);
    return res.json({ data: endpointView(await prisma.webhookEndpoint.findUnique({ where: { id } })) });
  })
);

router.delete(
  '/webhooks/:id',
  route('Failed to delete webhook', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const r = await prisma.webhookEndpoint.deleteMany({ where: { id, tenantId: tenantIdOf(req) } });
    if (r.count === 0) throw new HttpError(404, 'Webhook not found');
    await audit(req, 'WEBHOOK_DELETED', 'WEBHOOK', id);
    return res.status(204).end();
  })
);

router.get(
  '/webhooks/:id/deliveries',
  route('Failed to load deliveries', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const ep = await prisma.webhookEndpoint.findFirst({ where: { id, tenantId: tenantIdOf(req) }, select: { id: true } });
    if (!ep) throw new HttpError(404, 'Webhook not found');
    // Explicit fields: `payload` is the queued request body of a pending retry and stays internal.
    const rows = await prisma.webhookDelivery.findMany({
      where: { endpointId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, tenantId: true, endpointId: true, event: true, statusCode: true, success: true, error: true, createdAt: true, attempt: true, nextAttemptAt: true },
    });
    return res.json({ data: rows });
  })
);

/** POST /api/v1/admin/webhooks/:id/test: sends a signed `webhook.test` event and reports the result. */
router.post(
  '/webhooks/:id/test',
  route('Failed to send test event', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const tenantId = tenantIdOf(req);
    const ep = await prisma.webhookEndpoint.findFirst({ where: { id, tenantId } });
    if (!ep) throw new HttpError(404, 'Webhook not found');
    safeUrl(ep.url);
    const body = JSON.stringify({ id: crypto.randomUUID(), event: 'webhook.test', tenantId, createdAt: new Date().toISOString(), data: { ping: true } });
    return res.json({ data: await deliverWebhook(ep, tenantId, 'webhook.test', body) });
  })
);

// --------------------------------------------------------------------------- SCIM tokens

export const tokenSchema = z.object({ label: z.string().trim().min(1).max(100) });

router.get(
  '/scim-tokens',
  route('Failed to list SCIM tokens', async (req, res) => {
    const rows = await prisma.scimToken.findMany({ where: { tenantId: tenantIdOf(req) }, orderBy: { createdAt: 'desc' }, select: { id: true, label: true, createdAt: true, revokedAt: true } });
    return res.json({ data: rows });
  })
);

/** POST /api/v1/admin/scim-tokens: the bearer token is shown once; only its hash is stored. */
router.post(
  '/scim-tokens',
  route('Failed to create SCIM token', async (req, res) => {
    const tenantId = tenantIdOf(req);
    if (!(await tenantFeatures(tenantId)).scim) throw new HttpError(403, 'SCIM is not enabled for this organisation');
    const { label } = parseBody(req, tokenSchema);
    const token = newScimToken();
    const row = await prisma.scimToken.create({ data: { tenantId, label, tokenHash: hashOneTimeToken(token) } });
    await audit(req, 'SCIM_TOKEN_CREATED', 'SCIM_TOKEN', row.id, { label });
    return res.status(201).json({ data: { id: row.id, label, token } });
  })
);

router.delete(
  '/scim-tokens/:id',
  route('Failed to revoke SCIM token', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const r = await prisma.scimToken.updateMany({ where: { id, tenantId: tenantIdOf(req), revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count === 0) throw new HttpError(404, 'Token not found or already revoked');
    await audit(req, 'SCIM_TOKEN_REVOKED', 'SCIM_TOKEN', id);
    return res.status(204).end();
  })
);

// --------------------------------------------------------------------------- OIDC single sign-on

const domain = z.string().trim().toLowerCase().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, 'Invalid domain');
export const ssoSchema = z.object({
  issuer: z.string().url().max(2048),
  clientId: z.string().trim().min(1).max(256),
  /** Required the first time; omit it later to keep the stored secret. */
  clientSecret: z.string().min(8).max(2048).optional(),
  enabled: z.boolean(),
  allowedDomains: z.array(domain).max(50).default([]),
});

const ssoView = (c: any, customDomain: string | null) => ({
  issuer: c.issuer, clientId: c.clientId, enabled: c.enabled, allowedDomains: c.allowedDomains, hasSecret: true,
  redirectUris: redirectUrisFor({ customDomain }),
});

router.get(
  '/sso',
  route('Failed to load SSO settings', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const [c, tenant] = await Promise.all([
      prisma.ssoConnection.findUnique({ where: { tenantId } }),
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { customDomain: true } }),
    ]);
    // Always listed, even before a connection exists, so the administrator can register them first.
    return res.json({ data: c ? ssoView(c, tenant?.customDomain ?? null) : null, redirectUris: redirectUrisFor({ customDomain: tenant?.customDomain ?? null }) });
  })
);

/**
 * PUT /api/v1/admin/sso: configures the tenant's OpenID Connect provider. Enabling it first reads
 * the provider's discovery document, so a typo is reported here rather than at the first sign-in.
 * The secret is stored encrypted and is never returned.
 */
router.put(
  '/sso',
  route('Failed to save SSO settings', async (req, res) => {
    const tenantId = tenantIdOf(req);
    if (!(await tenantFeatures(tenantId)).sso) throw new HttpError(403, 'Single sign-on is not enabled for this organisation');
    const body = parseBody(req, ssoSchema);
    const existing = await prisma.ssoConnection.findUnique({ where: { tenantId } });
    if (!existing && !body.clientSecret) throw new HttpError(400, 'A client secret is required');

    if (body.enabled) {
      try {
        await discover(body.issuer);
      } catch {
        throw new HttpError(400, "Could not read the provider's configuration. Check the issuer URL.");
      }
    }
    const data = {
      issuer: body.issuer.replace(/\/+$/, ''),
      clientId: body.clientId,
      enabled: body.enabled,
      allowedDomains: [...new Set(body.allowedDomains)],
      ...(body.clientSecret ? { clientSecretEnc: encryptSecret(body.clientSecret) } : {}),
    };
    const saved = existing
      ? await prisma.ssoConnection.update({ where: { tenantId }, data })
      : await prisma.ssoConnection.create({ data: { tenantId, ...data, clientSecretEnc: encryptSecret(body.clientSecret!) } });
    await audit(req, 'SSO_CONFIG_UPDATED', 'SSO', saved.id, { issuer: data.issuer, clientId: data.clientId, enabled: data.enabled, allowedDomains: data.allowedDomains, secretChanged: !!body.clientSecret });
    const owner = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { customDomain: true } });
    return res.json({ data: ssoView(saved, owner?.customDomain ?? null) });
  })
);

router.delete(
  '/sso',
  route('Failed to remove SSO settings', async (req, res) => {
    const r = await prisma.ssoConnection.deleteMany({ where: { tenantId: tenantIdOf(req) } });
    if (r.count === 0) throw new HttpError(404, 'No SSO connection is configured');
    await audit(req, 'SSO_CONFIG_DELETED', 'SSO');
    return res.status(204).end();
  })
);

// --------------------------------------------------------------------------- SAML 2.0 single sign-on

export const samlSchema = z.object({
  entryPoint: z.string().url().max(2048),
  idpIssuer: z.string().trim().min(1).max(1024),
  /** Required the first time; omit it later to keep the pinned key. */
  idpCert: z.string().trim().min(20).max(20_000).optional(),
  emailAttribute: z.string().trim().min(1).max(200).default('email'),
  enabled: z.boolean(),
  allowedDomains: z.array(domain).max(50).default([]),
});

/** What the administrator hands to the IdP: one entity id and ACS URL per origin the tenant can sign in from. */
const samlSp = (tenant: { slug: string; customDomain: string | null }) => {
  const origins = allowedOrigins(tenant);
  return { entityIds: origins.map((o) => spEntityId(o, tenant.slug)), acsUrls: origins.map(acsUrl), metadataUrls: origins.map((o) => spEntityId(o, tenant.slug)) };
};

const samlView = (c: any) => {
  let key: ReturnType<typeof parseIdpKey> | null = null;
  try {
    key = parseIdpKey(c.idpCert);
  } catch {
    /* an expired pinned certificate is still shown, without details */
  }
  return {
    entryPoint: c.entryPoint, idpIssuer: c.idpIssuer, emailAttribute: c.emailAttribute, enabled: c.enabled, allowedDomains: c.allowedDomains,
    keyKind: key?.kind ?? null, keyFingerprint: key?.fingerprint ?? null, keyExpires: key?.notAfter ?? null,
  };
};

router.get(
  '/saml',
  route('Failed to load SAML settings', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const [c, tenant] = await Promise.all([
      prisma.samlConnection.findUnique({ where: { tenantId } }),
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true, customDomain: true } }),
    ]);
    return res.json({ data: c ? samlView(c) : null, sp: samlSp(tenant!) });
  })
);

/**
 * PUT /api/v1/admin/saml: configures the tenant's SAML identity provider. The IdP's signing
 * certificate (or public key) is validated and pinned; a private key is refused. Only public
 * material is stored.
 */
router.put(
  '/saml',
  route('Failed to save SAML settings', async (req, res) => {
    const tenantId = tenantIdOf(req);
    if (!(await tenantFeatures(tenantId)).sso) throw new HttpError(403, 'Single sign-on is not enabled for this organisation');
    const body = parseBody(req, samlSchema);
    const existing = await prisma.samlConnection.findUnique({ where: { tenantId } });
    if (!existing && !body.idpCert) throw new HttpError(400, 'The identity provider\'s signing certificate is required');
    try {
      assertSafeWebhookUrl(body.entryPoint);
    } catch (e: any) {
      throw new HttpError(400, `Sign-in URL: ${e.message}`);
    }
    let pem: string | undefined;
    let fingerprint: string | undefined;
    if (body.idpCert) {
      try {
        const k = parseIdpKey(body.idpCert);
        pem = k.pem;
        fingerprint = k.fingerprint;
      } catch (e) {
        if (e instanceof SamlError) throw new HttpError(400, e.message);
        throw e;
      }
    }
    const data = {
      entryPoint: body.entryPoint, idpIssuer: body.idpIssuer, emailAttribute: body.emailAttribute, enabled: body.enabled,
      allowedDomains: [...new Set(body.allowedDomains)], ...(pem ? { idpCert: pem } : {}),
    };
    const saved = existing
      ? await prisma.samlConnection.update({ where: { tenantId }, data })
      : await prisma.samlConnection.create({ data: { tenantId, ...data, idpCert: pem! } });
    await audit(req, 'SAML_CONFIG_UPDATED', 'SSO', saved.id, { entryPoint: data.entryPoint, idpIssuer: data.idpIssuer, enabled: data.enabled, allowedDomains: data.allowedDomains, keyFingerprint: fingerprint ?? 'unchanged' });
    return res.json({ data: samlView(saved) });
  })
);

router.delete(
  '/saml',
  route('Failed to remove SAML settings', async (req, res) => {
    const r = await prisma.samlConnection.deleteMany({ where: { tenantId: tenantIdOf(req) } });
    if (r.count === 0) throw new HttpError(404, 'No SAML connection is configured');
    await audit(req, 'SAML_CONFIG_DELETED', 'SSO');
    return res.status(204).end();
  })
);

export default router;
