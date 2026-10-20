import crypto from 'crypto';
import express, { Router, Request, Response, NextFunction } from 'express';
import { runWithTenant } from '@enterprise-lms/database';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { invalidateSessionCache, tenantIsBlocked, TENANT_SUSPENDED_MESSAGE } from '../lib/session';
import { logAuditEvent } from '../lib/audit';
import { withSeat, tenantFeatures } from '../lib/features';
import { hashOneTimeToken } from '../lib/one-time-token';
import { HttpError } from '../lib/http';
import { dispatchWebhook } from '../lib/webhooks';

// SCIM 2.0 (RFC 7643/7644) user provisioning for IdPs (Okta, Entra ID). Authenticated with a
// per-tenant bearer token (admin mints it, see platform.routes.ts), not a user session.
// SCIM may create and (de)activate learners and staff; it can never create or touch admin roles.

const router = Router();
router.use(express.json({ type: ['application/json', 'application/scim+json'], limit: '1mb' }));

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const PROTECTED_ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN', 'AUDITOR'];
const SCIM_ROLES = ['STUDENT', 'INSTRUCTOR', 'TEACHING_ASSISTANT', 'PARENT_GUARDIAN'] as const;

class ScimError extends Error {
  constructor(public status: number, message: string, public scimType?: string) {
    super(message);
  }
}

const sendScim = (res: Response, status: number, body: unknown) =>
  res.status(status).type('application/scim+json').send(JSON.stringify(body));

const fail = (res: Response, e: ScimError) =>
  sendScim(res, e.status, { schemas: [ERROR_SCHEMA], status: String(e.status), detail: e.message, ...(e.scimType ? { scimType: e.scimType } : {}) });

/** Maps thrown values to SCIM error bodies. */
const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (err instanceof ScimError) return fail(res, err);
    if (err instanceof HttpError) return fail(res, new ScimError(err.status, err.message));
    if (err?.code === 'P2002') return fail(res, new ScimError(409, 'Resource already exists', 'uniqueness'));
    return fail(res, new ScimError(500, 'Internal error'));
  }
};

async function scimAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return fail(res, new ScimError(401, 'Bearer token required'));
  const row = await prisma.scimToken.findUnique({
    where: { tokenHash: hashOneTimeToken(token) },
    select: { tenantId: true, revokedAt: true, tenant: { select: { status: true } } },
  });
  if (!row || row.revokedAt) return fail(res, new ScimError(401, 'Invalid token'));
  if (tenantIsBlocked(row.tenant.status)) return fail(res, new ScimError(403, TENANT_SUSPENDED_MESSAGE));
  req.tenantId = row.tenantId;
  return runWithTenant(row.tenantId, async () => {
    if (!(await tenantFeatures(row.tenantId)).scim) return fail(res, new ScimError(403, 'SCIM is not enabled for this organisation'));
    return next();
  });
}
router.use(scimAuth);

const baseUrl = (req: Request) => `${req.protocol}://${req.get('host')}/api/v1/scim/v2`;

function toScim(u: any, req: Request) {
  return {
    schemas: [USER_SCHEMA],
    id: u.id,
    ...(u.idpSubjectId ? { externalId: u.idpSubjectId } : {}),
    userName: u.email,
    name: { givenName: u.firstName, familyName: u.lastName, formatted: `${u.firstName} ${u.lastName}` },
    emails: [{ value: u.email, primary: true }],
    active: u.status === 'ACTIVE',
    meta: { resourceType: 'User', created: u.createdAt, lastModified: u.updatedAt, location: `${baseUrl(req)}/Users/${u.id}` },
  };
}

export const userBody = z.object({
  userName: z.string().email().max(254),
  externalId: z.string().max(255).optional(),
  name: z.object({ givenName: z.string().max(100).optional(), familyName: z.string().max(100).optional() }).optional(),
  emails: z.array(z.object({ value: z.string().email(), primary: z.boolean().optional() })).optional(),
  active: z.boolean().optional(),
});

const SELECT = { id: true, email: true, firstName: true, lastName: true, status: true, role: true, idpSubjectId: true, createdAt: true, updatedAt: true } as const;

router.get('/ServiceProviderConfig', (_req, res) =>
  sendScim(res, 200, {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true },
    bulk: { supported: false },
    filter: { supported: true, maxResults: 100 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer token', description: 'Per-tenant SCIM token' }],
  })
);

/** Supports the filter IdPs actually use: `userName eq "x"` (and externalId eq). */
router.get('/Users', handle(async (req, res) => {
  const tenantId = req.tenantId!;
  const start = Math.max(1, parseInt(String(req.query.startIndex ?? '1'), 10) || 1);
  const count = Math.min(100, Math.max(0, parseInt(String(req.query.count ?? '50'), 10) || 50));
  let where: any = { tenantId };
  if (req.query.filter) {
    const m = /^(userName|externalId)\s+eq\s+"([^"]{1,254})"$/i.exec(String(req.query.filter).trim());
    if (!m) throw new ScimError(400, 'Only "userName eq" and "externalId eq" filters are supported', 'invalidFilter');
    where = m[1].toLowerCase() === 'username' ? { ...where, email: m[2].toLowerCase() } : { ...where, idpSubjectId: m[2] };
  }
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: 'asc' }, skip: start - 1, take: count, select: SELECT }),
    prisma.user.count({ where }),
  ]);
  return sendScim(res, 200, { schemas: [LIST_SCHEMA], totalResults: total, startIndex: start, itemsPerPage: rows.length, Resources: rows.map((r) => toScim(r, req)) });
}));

router.get('/Users/:id', handle(async (req, res) => {
  const u = await prisma.user.findFirst({ where: { id: String(req.params.id), tenantId: req.tenantId! }, select: SELECT });
  if (!u) throw new ScimError(404, 'User not found');
  return sendScim(res, 200, toScim(u, req));
}));

router.post('/Users', handle(async (req, res) => {
  const tenantId = req.tenantId!;
  const parsed = userBody.safeParse(req.body);
  if (!parsed.success) throw new ScimError(400, 'Invalid user resource', 'invalidValue');
  const b = parsed.data;
  const email = (b.emails?.find((e) => e.primary)?.value ?? b.userName).toLowerCase();
  if (email !== b.userName.toLowerCase()) throw new ScimError(400, 'userName must equal the primary email', 'invalidValue');
  if (await prisma.user.findFirst({ where: { tenantId, email } })) throw new ScimError(409, 'User already exists', 'uniqueness');

  const u = await withSeat(tenantId, (tx) => tx.user.create({
    data: {
      tenantId,
      email,
      firstName: b.name?.givenName?.trim() || email.split('@')[0],
      lastName: b.name?.familyName?.trim() || '-',
      role: 'STUDENT', // SCIM-created accounts are learners; promote them in the admin UI
      status: b.active === false ? 'SUSPENDED' : 'ACTIVE',
      passwordHash: null, // sign in through the IdP
      emailVerified: true,
      idpProvider: 'SCIM',
      idpSubjectId: b.externalId ?? null,
    },
    select: SELECT,
  }));
  await logAuditEvent({ tenantId, action: 'SCIM_USER_CREATED', resourceType: 'USER', resourceId: u.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  void dispatchWebhook(tenantId, 'user.provisioned', { userId: u.id, email: u.email });
  return sendScim(res, 201, toScim(u, req));
}));

async function mutableUser(req: Request) {
  const u = await prisma.user.findFirst({ where: { id: String(req.params.id), tenantId: req.tenantId! }, select: SELECT });
  if (!u) throw new ScimError(404, 'User not found');
  if (PROTECTED_ROLES.includes(u.role)) throw new ScimError(403, 'Administrator accounts cannot be changed through SCIM', 'mutability');
  return u;
}

const statusOf = (active: boolean) => (active ? 'ACTIVE' : 'SUSPENDED');

router.put('/Users/:id', handle(async (req, res) => {
  const u = await mutableUser(req);
  const parsed = userBody.safeParse(req.body);
  if (!parsed.success) throw new ScimError(400, 'Invalid user resource', 'invalidValue');
  const b = parsed.data;
  if (b.userName.toLowerCase() !== u.email) throw new ScimError(400, 'userName cannot be changed', 'mutability');
  const updated = await prisma.user.update({
    where: { id: u.id },
    data: {
      ...(b.name?.givenName ? { firstName: b.name.givenName.trim() } : {}),
      ...(b.name?.familyName ? { lastName: b.name.familyName.trim() } : {}),
      ...(b.externalId !== undefined ? { idpSubjectId: b.externalId } : {}),
      ...(b.active !== undefined ? { status: statusOf(b.active) as any, tokenVersion: { increment: 1 } } : {}),
    },
    select: SELECT,
  });
  invalidateSessionCache(u.id);
  await logAuditEvent({ tenantId: req.tenantId!, action: 'SCIM_USER_UPDATED', resourceType: 'USER', resourceId: u.id });
  return sendScim(res, 200, toScim(updated, req));
}));

export const patchBody = z.object({
  schemas: z.array(z.string()).optional(),
  Operations: z.array(z.object({ op: z.string(), path: z.string().optional(), value: z.any().optional() })).min(1).max(20),
});

router.patch('/Users/:id', handle(async (req, res) => {
  const u = await mutableUser(req);
  const parsed = patchBody.safeParse(req.body);
  if (!parsed.success || (parsed.data.schemas && !parsed.data.schemas.includes(PATCH_SCHEMA))) {
    throw new ScimError(400, 'Invalid PatchOp request', 'invalidSyntax');
  }
  const data: any = {};
  for (const op of parsed.data.Operations) {
    const kind = op.op.toLowerCase();
    if (kind !== 'replace' && kind !== 'add') throw new ScimError(400, `Operation "${op.op}" is not supported`, 'invalidSyntax');
    // Okta sends {op, path:"active", value:false}; Entra sends {op, value:{active:false}} (and string "False").
    const entries: [string, any][] = op.path ? [[op.path, op.value]] : Object.entries(op.value ?? {});
    for (const [path, raw] of entries) {
      const v = typeof raw === 'string' && /^(true|false)$/i.test(raw) ? raw.toLowerCase() === 'true' : raw;
      if (path === 'active' && typeof v === 'boolean') { data.status = statusOf(v); data.tokenVersion = { increment: 1 }; }
      else if (path === 'name.givenName' && typeof v === 'string') data.firstName = v.trim();
      else if (path === 'name.familyName' && typeof v === 'string') data.lastName = v.trim();
      else if (path === 'externalId' && typeof v === 'string') data.idpSubjectId = v;
      else if (path === 'name' && v && typeof v === 'object') {
        if (typeof v.givenName === 'string') data.firstName = v.givenName.trim();
        if (typeof v.familyName === 'string') data.lastName = v.familyName.trim();
      } else throw new ScimError(400, `Attribute "${path}" cannot be modified`, 'mutability');
    }
  }
  const updated = Object.keys(data).length ? await prisma.user.update({ where: { id: u.id }, data, select: SELECT }) : u;
  invalidateSessionCache(u.id);
  await logAuditEvent({ tenantId: req.tenantId!, action: 'SCIM_USER_UPDATED', resourceType: 'USER', resourceId: u.id, diffJson: { fields: Object.keys(data) } });
  return sendScim(res, 200, toScim(updated, req));
}));

/** DELETE deprovisions: the account is suspended and keeps its history (grades, certificates, audit). */
router.delete('/Users/:id', handle(async (req, res) => {
  const u = await mutableUser(req);
  await prisma.user.update({ where: { id: u.id }, data: { status: 'SUSPENDED', tokenVersion: { increment: 1 } } });
  invalidateSessionCache(u.id);
  await logAuditEvent({ tenantId: req.tenantId!, action: 'SCIM_USER_DEPROVISIONED', resourceType: 'USER', resourceId: u.id });
  return res.status(204).end();
}));

router.use((_req, res) => fail(res, new ScimError(404, 'Not found')));

export const newScimToken = () => crypto.randomBytes(32).toString('base64url');
export { SCIM_ROLES };
export default router;
