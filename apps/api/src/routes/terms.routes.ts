import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { HttpError, route } from '../lib/http';
import { idSchema, parseBody } from '../lib/validate';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, requireRole, tenantIdOf } from '../middleware/auth';

// Mounted at /api/v1/terms. Academic terms courses are grouped by ("Fall 2026"). Everyone in the
// organisation can list them (to filter the catalogue); administrators create and change them.

const router = Router();
router.use(authenticateJWT);

const termShape = {
  name: z.string().trim().min(2).max(80),
  startsOn: z.coerce.date(),
  endsOn: z.coerce.date(),
};
export const termSchema = z.object(termShape).refine((t) => t.endsOn > t.startsOn, { message: 'endsOn must be after startsOn' });
export const termUpdateSchema = z.object(termShape).partial();

const view = (t: { id: string; name: string; startsOn: Date; endsOn: Date; _count?: { courses: number } }) => ({
  id: t.id,
  name: t.name,
  startsOn: t.startsOn,
  endsOn: t.endsOn,
  courseCount: t._count?.courses ?? 0,
});

const audit = (req: Parameters<typeof tenantIdOf>[0], action: string, id: string, diffJson: unknown) =>
  logAuditEvent({
    tenantId: tenantIdOf(req),
    userId: req.user!.id,
    action,
    resourceType: 'TERM',
    resourceId: id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    diffJson,
  });

const nameTaken = (e: unknown) => (e as { code?: string })?.code === 'P2002';

/** GET /api/v1/terms: newest first, with how many courses each has. */
router.get(
  '/',
  route('Failed to load terms', async (req, res) => {
    const terms = await prisma.term.findMany({
      where: { tenantId: tenantIdOf(req) },
      orderBy: { startsOn: 'desc' },
      include: { _count: { select: { courses: true } } },
    });
    return res.json({ data: terms.map(view) });
  })
);

/** POST /api/v1/terms (administrators) */
router.post(
  '/',
  requireRole('TENANT_ADMIN', 'SUPER_ADMIN'),
  route('Failed to create the term', async (req, res) => {
    const body = parseBody(req, termSchema);
    try {
      const term = await prisma.term.create({ data: { tenantId: tenantIdOf(req), ...body } });
      await audit(req, 'TERM_CREATED', term.id, body);
      return res.status(201).json({ data: view(term) });
    } catch (e) {
      if (nameTaken(e)) throw new HttpError(409, 'A term with that name already exists');
      throw e;
    }
  })
);

/** PATCH /api/v1/terms/:id (administrators) */
router.patch(
  '/:id',
  requireRole('TENANT_ADMIN', 'SUPER_ADMIN'),
  route('Failed to update the term', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const patch = parseBody(req, termUpdateSchema);
    const term = await prisma.term.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
    if (!term) throw new HttpError(404, 'Term not found');
    if ((patch.endsOn ?? term.endsOn) <= (patch.startsOn ?? term.startsOn)) throw new HttpError(400, 'endsOn must be after startsOn');
    try {
      const updated = await prisma.term.update({ where: { id }, data: patch, include: { _count: { select: { courses: true } } } });
      await audit(req, 'TERM_UPDATED', id, patch);
      return res.json({ data: view(updated) });
    } catch (e) {
      if (nameTaken(e)) throw new HttpError(409, 'A term with that name already exists');
      throw e;
    }
  })
);

/** DELETE /api/v1/terms/:id (administrators): only a term no course belongs to. */
router.delete(
  '/:id',
  requireRole('TENANT_ADMIN', 'SUPER_ADMIN'),
  route('Failed to delete the term', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const term = await prisma.term.findFirst({
      where: { id, tenantId: tenantIdOf(req) },
      include: { _count: { select: { courses: true } } },
    });
    if (!term) throw new HttpError(404, 'Term not found');
    if (term._count.courses > 0) throw new HttpError(409, 'Courses still belong to this term; move them to another term first');
    await prisma.term.delete({ where: { id } });
    await audit(req, 'TERM_DELETED', id, { name: term.name });
    return res.status(204).end();
  })
);

export default router;
