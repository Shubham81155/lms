import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticateJWT, requireRole, tenantIdOf } from '../middleware/auth';
import { HttpError, route } from '../lib/http';
import { parseBody } from '../lib/validate';
import { logAuditEvent } from '../lib/audit';
import { verifyPassword } from '../lib/password';
import { buildUserExport, eraseUser, erasureBlocker } from '../lib/privacy';

// Mounted at /api/v1/privacy: personal-data export, FERPA directory opt-out and erasure.

const router = Router();

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

export default router;
