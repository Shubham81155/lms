import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { basePrisma } from '../lib/prisma';
import { HttpError, handleError, route } from '../lib/http';
import { idSchema, parseBody } from '../lib/validate';
import { authenticateJWT, requireRole, tenantIdOf } from '../middleware/auth';
import { contentDisposition, storage } from '../lib/storage';
import {
  OffboardingActor, auditDownload, cancelDeletion, downloadableExport, offboardingOverview, offboardingState, requestExport, scheduleDeletion,
} from '../lib/offboarding';

// Organisation offboarding (lib/offboarding.ts): full exports and scheduled deletion.
// The default router is mounted at /api/v1/admin (the organisation's administrators, for their own organisation);
// operatorOffboardingRoutes at /api/v1/operator (the platform operator, for any organisation, and the deleted ones).

export const deletionSchema = z.object({
  /** The organisation's address (slug), typed by the person to confirm. */
  confirmSlug: z.string().trim().min(1).max(64),
}).strict();

const actorOf = (req: Request, operator: boolean): OffboardingActor => ({
  tenantId: tenantIdOf(req), userId: req.user!.id, email: req.user!.email, operator, ipAddress: req.ip, userAgent: req.headers['user-agent'],
});

/** Streams the ZIP (or redirects to a short-lived storage link), after auditing the download. */
async function sendExport(req: Request, res: Response, operator: boolean) {
  const e = await downloadableExport(idSchema.parse(req.params.exportId ?? req.params.id), { tenantId: tenantIdOf(req), operator });
  const slug = (await basePrisma.tenant.findUnique({ where: { id: e.tenantId }, select: { slug: true } }))?.slug
    ?? (await basePrisma.tenantDeletion.findUnique({ where: { tenantId: e.tenantId }, select: { slug: true } }))?.slug
    ?? 'organisation';
  const filename = `${slug}-export-${e.createdAt.toISOString().slice(0, 10)}${e.isFinal ? '-final' : ''}.zip`;
  await auditDownload(e, actorOf(req, operator));

  res.setHeader('cache-control', 'private, no-store');
  const signed = await storage().signedDownloadUrl(e.storageKey!, { filename, contentType: 'application/zip', inline: false });
  if (signed) return res.redirect(302, signed);
  const stream = await storage().open(e.storageKey!);
  res.setHeader('content-type', 'application/zip');
  if (e.sizeBytes !== null) res.setHeader('content-length', String(e.sizeBytes));
  res.setHeader('content-disposition', contentDisposition(filename, false));
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

// --------------------------------------------------------------------------- administrators

const router = Router();
router.use('/offboarding', authenticateJWT, requireRole('SUPER_ADMIN', 'TENANT_ADMIN'));

/** GET /api/v1/admin/offboarding: the scheduled deletion (if any) and the recent exports. */
router.get(
  '/offboarding',
  route('Failed to load offboarding', async (req, res) => res.json({ data: await offboardingState(tenantIdOf(req), { operator: false }) }))
);

/** POST /api/v1/admin/offboarding/export: queue a full export (ZIP). */
router.post(
  '/offboarding/export',
  route('Failed to request the export', async (req, res) => res.status(202).json({ data: await requestExport(tenantIdOf(req), actorOf(req, false)) }))
);

/** GET /api/v1/admin/offboarding/export/:id/download: the ZIP of a ready export. */
router.get(
  '/offboarding/export/:id/download',
  route('Failed to download the export', (req, res) => sendExport(req, res, false))
);

/** POST /api/v1/admin/offboarding/deletion: schedule the organisation's deletion. */
router.post(
  '/offboarding/deletion',
  route('Failed to schedule the deletion', async (req, res) => {
    const { confirmSlug } = parseBody(req, deletionSchema);
    return res.json({ data: await scheduleDeletion(tenantIdOf(req), confirmSlug, actorOf(req, false)) });
  })
);

/** DELETE /api/v1/admin/offboarding/deletion: cancel it. */
router.delete(
  '/offboarding/deletion',
  route('Failed to cancel the deletion', async (req, res) => res.json({ data: await cancelDeletion(tenantIdOf(req), actorOf(req, false)) }))
);

export default router;

// --------------------------------------------------------------------------- platform operator

async function requireOperator(req: Request, res: Response, next: NextFunction) {
  try {
    if (!config.PLATFORM_OPERATOR_TENANT) throw new HttpError(403, 'No platform operator organisation is configured');
    const own = await basePrisma.tenant.findUnique({ where: { id: tenantIdOf(req) }, select: { slug: true } });
    if (own?.slug !== config.PLATFORM_OPERATOR_TENANT) throw new HttpError(403, 'Forbidden: platform operators only');
  } catch (err) {
    return handleError(req, res, err, 'Failed to check operator access');
  }
  next();
}

export const operatorOffboardingRoutes = Router();
operatorOffboardingRoutes.use(['/offboarding', '/exports', '/tenants/:id/offboarding', '/tenants/:id/export', '/tenants/:id/deletion'], authenticateJWT, requireRole('SUPER_ADMIN'), requireOperator);

/** GET /api/v1/operator/offboarding: scheduled deletions and deleted organisations. */
operatorOffboardingRoutes.get(
  '/offboarding',
  route('Failed to load offboarding', async (_req, res) => res.json({ data: await offboardingOverview() }))
);

operatorOffboardingRoutes.get(
  '/tenants/:id/offboarding',
  route('Failed to load offboarding', async (req, res) => res.json({ data: await offboardingState(idSchema.parse(req.params.id), { operator: true }) }))
);

operatorOffboardingRoutes.post(
  '/tenants/:id/export',
  route('Failed to request the export', async (req, res) => res.status(202).json({ data: await requestExport(idSchema.parse(req.params.id), actorOf(req, true)) }))
);

operatorOffboardingRoutes.post(
  '/tenants/:id/deletion',
  route('Failed to schedule the deletion', async (req, res) => {
    const { confirmSlug } = parseBody(req, deletionSchema);
    return res.json({ data: await scheduleDeletion(idSchema.parse(req.params.id), confirmSlug, actorOf(req, true)) });
  })
);

operatorOffboardingRoutes.delete(
  '/tenants/:id/deletion',
  route('Failed to cancel the deletion', async (req, res) => res.json({ data: await cancelDeletion(idSchema.parse(req.params.id), actorOf(req, true)) }))
);

/** Any export, including the final export of a deleted organisation. */
operatorOffboardingRoutes.get(
  '/exports/:exportId/download',
  route('Failed to download the export', (req, res) => sendExport(req, res, true))
);
