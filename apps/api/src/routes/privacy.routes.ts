import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticateJWT, requireRole, tenantIdOf } from '../middleware/auth';
import { HttpError, route } from '../lib/http';
import { idSchema, pageMeta, paginationShape, parseBody, parseQuery } from '../lib/validate';
import { logAuditEvent } from '../lib/audit';
import { verifyPassword } from '../lib/password';
import { buildUserExport, eraseUser, erasureBlocker } from '../lib/privacy';
import { cancelRequest, fileRequest, fulfilRequest, listRequests, myRequests, rejectRequest, REQUEST_KINDS, REQUEST_STATUSES, requestView, updateRequest } from '../lib/data-requests';
import { loadPolicy, policyView, retentionPolicySchema, runRetention, savePolicy } from '../lib/retention';

// Mounted at /api/v1/privacy: personal-data export, FERPA directory opt-out, erasure, the data-subject request queue
// (/requests) and the organisation's data-retention policy (/retention).

const router = Router();

export const fileRequestSchema = z.object({
  kind: z.enum(REQUEST_KINDS),
  /** What the person asks for, in their own words. */
  details: z.string().trim().max(2000).optional(),
});
export const requestsQuerySchema = z.object({
  /** "open" (OPEN and IN_PROGRESS) or one status. */
  status: z.enum(['open', ...REQUEST_STATUSES]).optional(),
  kind: z.enum(REQUEST_KINDS).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  assignedToId: idSchema.optional(),
  ...paginationShape,
});
export const updateRequestSchema = z
  .object({
    /** An active administrator to hand the request to; null puts it back in the queue. */
    assignedToId: idSchema.nullable().optional(),
    /** Internal notes, never shown to the person. */
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .refine((b) => b.assignedToId !== undefined || b.notes !== undefined, { message: 'Nothing to change' });
export const fulfilRequestSchema = z.object({
  /** The answer the person receives; required for "OTHER" requests. */
  resolution: z.string().trim().max(4000).optional(),
  /** ACCESS requests: attach the person's data for download (default true). */
  attachExport: z.boolean().optional(),
});
export const rejectRequestSchema = z.object({ reason: z.string().trim().min(3).max(4000) });
export const retentionRunSchema = z.object({ dryRun: z.boolean().optional() });

export const directorySchema = z.object({ optOut: z.boolean() });
export const selfEraseSchema = z.object({
  /** Required when the account has a password. */
  password: z.string().max(128).optional(),
  /** Must equal the account's e-mail address: the guard for SSO-only accounts and against stray clicks. */
  confirmEmail: z.string().max(320),
});

async function sendExport(req: any, res: any, userId: string, actorId: string) {
  const tenantId = tenantIdOf(req);
  const data = await buildUserExport(userId, tenantId);
  if (!data) throw new HttpError(404, 'User not found');
  await logAuditEvent({
    tenantId, userId: actorId, action: 'PERSONAL_DATA_EXPORTED', resourceType: 'USER', resourceId: userId,
    ipAddress: req.ip, userAgent: req.headers['user-agent'],
  });
  res.setHeader('Content-Disposition', `attachment; filename="personal-data-${userId}.json"`);
  return res.status(200).json(data);
}

/** GET /api/v1/privacy/me/export - everything held about the caller, as a JSON download */
router.get('/me/export', authenticateJWT, route('Failed to export personal data', (req, res) => sendExport(req, res, req.user!.id, req.user!.id)));

/** GET /api/v1/privacy/users/:id/export - the same for any person in the tenant (administrators answering a request) */
router.get(
  '/users/:id/export',
  authenticateJWT,
  requireRole('SUPER_ADMIN', 'TENANT_ADMIN'),
  route('Failed to export personal data', (req, res) => sendExport(req, res, String(req.params.id), req.user!.id))
);

/** GET /api/v1/privacy/me/directory */
router.get(
  '/me/directory',
  authenticateJWT,
  route('Failed to load privacy settings', async (req, res) => {
    const u = await prisma.user.findFirst({ where: { id: req.user!.id, tenantId: tenantIdOf(req) }, select: { directoryOptOut: true } });
    return res.json({ data: { optOut: u?.directoryOptOut ?? false } });
  })
);

/** PUT /api/v1/privacy/me/directory - hide your name from classmates (leaderboards, forums); staff still see it */
router.put(
  '/me/directory',
  authenticateJWT,
  route('Failed to update privacy settings', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { optOut } = parseBody(req, directorySchema);
    await prisma.user.update({ where: { id: req.user!.id }, data: { directoryOptOut: optOut } });
    await logAuditEvent({
      tenantId, userId: req.user!.id, action: 'DIRECTORY_OPT_OUT_CHANGED', resourceType: 'USER', resourceId: req.user!.id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], diffJson: { optOut },
    });
    return res.json({ data: { optOut } });
  })
);

/** POST /api/v1/privacy/me/erase - erase your own account (right to be forgotten) */
router.post(
  '/me/erase',
  authenticateJWT,
  route('Failed to erase account', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const input = parseBody(req, selfEraseSchema);
    const me = await prisma.user.findFirst({ where: { id: req.user!.id, tenantId }, select: { id: true, email: true, passwordHash: true } });
    if (!me) throw new HttpError(404, 'User not found');
    if (input.confirmEmail.trim().toLowerCase() !== me.email.toLowerCase()) throw new HttpError(400, 'confirmEmail does not match this account');
    if (me.passwordHash) {
      if (!input.password || !(await verifyPassword(input.password, me.passwordHash)).valid) throw new HttpError(403, 'Password is incorrect');
    }
    const blocker = await erasureBlocker(me.id, tenantId);
    if (blocker) throw new HttpError(409, blocker);

    await eraseUser(me.id, tenantId);
    await logAuditEvent({
      tenantId, userId: me.id, action: 'USER_ERASED', resourceType: 'USER', resourceId: me.id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], diffJson: { requestedBy: 'self' },
    });
    return res.json({ status: 'erased', userId: me.id });
  })
);

/** POST /api/v1/privacy/users/:id/erase - an administrator erasing someone else's data on request */
router.post(
  '/users/:id/erase',
  authenticateJWT,
  requireRole('SUPER_ADMIN', 'TENANT_ADMIN'),
  route('Failed to erase account', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const id = String(req.params.id);
    if (id === req.user!.id) throw new HttpError(400, 'Use POST /privacy/me/erase to erase your own account');
    const target = await prisma.user.findFirst({ where: { id, tenantId }, select: { role: true } });
    if (!target) throw new HttpError(404, 'User not found');
    if (target.role === 'SUPER_ADMIN' && req.user!.role !== 'SUPER_ADMIN') throw new HttpError(403, 'Only a super administrator can erase a super administrator');
    const blocker = await erasureBlocker(id, tenantId);
    if (blocker) throw new HttpError(409, blocker);

    await eraseUser(id, tenantId);
    await logAuditEvent({
      tenantId, userId: req.user!.id, action: 'USER_ERASED', resourceType: 'USER', resourceId: id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], diffJson: { requestedBy: 'administrator' },
    });
    return res.json({ status: 'erased', userId: id });
  })
);

// ---------------------------------------------------------------------------- data-subject requests

const ctxOf = (req: any) => ({ ipAddress: req.ip as string | undefined, userAgent: req.headers['user-agent'] as string | undefined });
const adminOnly = [authenticateJWT, requireRole('SUPER_ADMIN', 'TENANT_ADMIN')] as const;

/** POST /api/v1/privacy/requests - file a request about your own data (access, erasure, correction, ...); it is due in DSAR_DUE_DAYS */
router.post(
  '/requests',
  authenticateJWT,
  route('Failed to file the request', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const input = parseBody(req, fileRequestSchema);
    const me = await prisma.user.findFirst({ where: { id: req.user!.id, tenantId, erasedAt: null }, select: { id: true, email: true, firstName: true } });
    if (!me) throw new HttpError(404, 'User not found');
    const r = await fileRequest(tenantId, me, input, ctxOf(req));
    return res.status(201).json({ data: requestView(r) });
  })
);

/** GET /api/v1/privacy/requests/mine - the requests you filed, newest first */
router.get(
  '/requests/mine',
  authenticateJWT,
  route('Failed to load your requests', async (req, res) => {
    const rows = await myRequests(tenantIdOf(req), req.user!.id);
    return res.json({ data: rows.map((r) => requestView(r)) });
  })
);

/** POST /api/v1/privacy/requests/:id/cancel - withdraw one of your requests while it is open */
router.post(
  '/requests/:id/cancel',
  authenticateJWT,
  route('Failed to cancel the request', async (req, res) => {
    const r = await cancelRequest(tenantIdOf(req), String(req.params.id), req.user!.id, ctxOf(req));
    return res.json({ data: requestView(r) });
  })
);

/** GET /api/v1/privacy/requests/:id/export - download your data once an access request of yours was fulfilled with it attached */
router.get(
  '/requests/:id/export',
  authenticateJWT,
  route('Failed to export personal data', async (req, res) => {
    const r = await prisma.dataRequest.findFirst({ where: { id: String(req.params.id), tenantId: tenantIdOf(req), requesterId: req.user!.id } });
    if (!r) throw new HttpError(404, 'Request not found');
    if (r.kind !== 'ACCESS' || r.status !== 'FULFILLED' || !r.exportAttached) throw new HttpError(409, 'No data is attached to this request');
    return sendExport(req, res, req.user!.id, req.user!.id);
  })
);

/** GET /api/v1/privacy/requests - the organisation's request queue, most urgent first (administrators) */
router.get(
  '/requests',
  ...adminOnly,
  route('Failed to load the requests', async (req, res) => {
    const q = parseQuery(req, requestsQuerySchema);
    const out = await listRequests(tenantIdOf(req), { ...q, overdue: q.overdue === 'true' });
    return res.json({ data: out.rows, pagination: pageMeta(q.page, q.limit, out.total), summary: { open: out.open, overdue: out.overdue } });
  })
);

/** PATCH /api/v1/privacy/requests/:id - assign a request (starting the work) or edit its internal notes (administrators) */
router.patch(
  '/requests/:id',
  ...adminOnly,
  route('Failed to update the request', async (req, res) => {
    const input = parseBody(req, updateRequestSchema);
    const r = await updateRequest(tenantIdOf(req), String(req.params.id), req.user!, input, ctxOf(req));
    return res.json({ data: requestView(r, { admin: true }) });
  })
);

/** POST /api/v1/privacy/requests/:id/fulfil - close a request as done, carrying out what its kind calls for (administrators) */
router.post(
  '/requests/:id/fulfil',
  ...adminOnly,
  route('Failed to fulfil the request', async (req, res) => {
    const input = parseBody(req, fulfilRequestSchema);
    const r = await fulfilRequest(tenantIdOf(req), String(req.params.id), req.user!, input, ctxOf(req));
    return res.json({ data: requestView(r, { admin: true }) });
  })
);

/** POST /api/v1/privacy/requests/:id/reject - decline a request with a reason the person is told (administrators) */
router.post(
  '/requests/:id/reject',
  ...adminOnly,
  route('Failed to reject the request', async (req, res) => {
    const { reason } = parseBody(req, rejectRequestSchema);
    const r = await rejectRequest(tenantIdOf(req), String(req.params.id), req.user!, reason, ctxOf(req));
    return res.json({ data: requestView(r, { admin: true }) });
  })
);

// ---------------------------------------------------------------------------- data retention

/** GET /api/v1/privacy/retention - the organisation's retention policy and what the last run did (administrators) */
router.get(
  '/retention',
  ...adminOnly,
  route('Failed to load the retention policy', async (req, res) => res.json({ data: policyView(await loadPolicy(tenantIdOf(req))) }))
);

/** PUT /api/v1/privacy/retention - set the retention policy: how long each class of data is kept (administrators) */
router.put(
  '/retention',
  ...adminOnly,
  route('Failed to save the retention policy', async (req, res) => {
    const input = parseBody(req, retentionPolicySchema);
    return res.json({ data: policyView(await savePolicy(tenantIdOf(req), input, req.user!.id, ctxOf(req))) });
  })
);

/** POST /api/v1/privacy/retention/run - run the policy now; with dryRun (or a policy that is not enabled) it only counts (administrators) */
router.post(
  '/retention/run',
  ...adminOnly,
  route('Failed to run the retention policy', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { dryRun } = parseBody(req, retentionRunSchema);
    if (!(await loadPolicy(tenantId))) throw new HttpError(409, 'Save a retention policy first');
    const summary = await runRetention(tenantId, { dryRun, userId: req.user!.id, ctx: ctxOf(req) });
    return res.json({ data: summary });
  })
);

export default router;
