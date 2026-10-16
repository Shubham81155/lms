import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { HttpError, route } from '../lib/http';
import { idSchema, pageMeta, paginationShape, parseBody, parseQuery } from '../lib/validate';
import { requireContentAccess, requireCourseStaff } from '../lib/access';
import { logAuditEvent } from '../lib/audit';
import { notifyMany } from '../lib/notify';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';

// Mounted at /api/v1. Course announcements: posted by course staff, read by everyone in the course, and
// sent to every active learner as a notification (and e-mail, by their notification settings).

const router = Router();

const ACTIVE = ['ENROLLED', 'IN_PROGRESS', 'COMPLETED'] as const;

const authorSelect = { author: { select: { id: true, firstName: true, lastName: true } } } as const;
const view = (a: { id: string; courseId: string; title: string; body: string; pinned: boolean; createdAt: Date; updatedAt: Date; author: { id: string; firstName: string; lastName: string } | null }) => ({
  id: a.id,
  courseId: a.courseId,
  title: a.title,
  body: a.body,
  pinned: a.pinned,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
  author: a.author ? { id: a.author.id, name: `${a.author.firstName} ${a.author.lastName}` } : null,
});

export const announcementSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
  pinned: z.boolean().default(false),
  /** Send it as a notification (and e-mail) to the course's learners. */
  notify: z.boolean().default(true),
});
export const announcementUpdateSchema = z
  .object({ title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(20_000), pinned: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

export const announcementListQuery = z.object({ ...paginationShape, limit: paginationShape.limit.default(20) });

/** GET /api/v1/courses/:courseId/announcements: newest first, pinned ones on top. */
router.get(
  '/courses/:courseId/announcements',
  authenticateJWT,
  route('Failed to load announcements', async (req, res) => {
    const access = await requireContentAccess(req, idSchema.parse(req.params.courseId));
    const { page, limit } = parseQuery(req, announcementListQuery);
    const where = { tenantId: tenantIdOf(req), courseId: access.course.id };
    const [total, rows] = await Promise.all([
      prisma.announcement.count({ where }),
      prisma.announcement.findMany({ where, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * limit, take: limit, include: authorSelect }),
    ]);
    return res.json({ data: rows.map(view), pagination: pageMeta(page, limit, total) });
  })
);

export const recentQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });

/** GET /api/v1/announcements/recent: the latest announcements across the courses the caller is enrolled in. */
router.get(
  '/announcements/recent',
  authenticateJWT,
  route('Failed to load announcements', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { limit } = parseQuery(req, recentQuery);
    const enrolments = await prisma.enrollment.findMany({
      where: { tenantId, userId: req.user!.id, status: { in: [...ACTIVE] }, course: { status: 'PUBLISHED' } },
      select: { course: { select: { id: true, code: true, title: true } } },
    });
    const courses = new Map(enrolments.map((e) => [e.course.id, e.course]));
    if (courses.size === 0) return res.json({ data: [] });
    const rows = await prisma.announcement.findMany({
      where: { tenantId, courseId: { in: [...courses.keys()] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: authorSelect,
    });
    return res.json({ data: rows.map((a) => ({ ...view(a), course: courses.get(a.courseId)! })) });
  })
);

/** POST /api/v1/courses/:courseId/announcements: course staff post; learners are notified unless notify is false. */
router.post(
  '/courses/:courseId/announcements',
  authenticateJWT,
  route('Failed to post the announcement', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const access = await requireCourseStaff(req, idSchema.parse(req.params.courseId));
    const input = parseBody(req, announcementSchema);
    const created = await prisma.announcement.create({
      data: { tenantId, courseId: access.course.id, authorId: req.user!.id, title: input.title, body: input.body, pinned: input.pinned },
      include: authorSelect,
    });

    let notified = 0;
    if (input.notify && access.course.status === 'PUBLISHED') {
      const learners = await prisma.enrollment.findMany({
        where: { tenantId, courseId: access.course.id, status: { in: [...ACTIVE] }, user: { status: 'ACTIVE' } },
        select: { userId: true },
      });
      const course = await prisma.course.findUnique({ where: { id: access.course.id }, select: { code: true } });
      const preview = input.body.length > 280 ? `${input.body.slice(0, 277)}…` : input.body;
      const results = await notifyMany(
        learners.map((l) => ({
          tenantId,
          userId: l.userId,
          category: 'COURSE',
          title: `${course?.code ?? 'Course'}: ${input.title}`,
          body: preview,
          link: `/courses/${access.course.id}/announcements`,
        }))
      );
      notified = results.filter(Boolean).length;
    }

    await logAuditEvent({
      tenantId,
      userId: req.user!.id,
      action: 'ANNOUNCEMENT_POSTED',
      resourceType: 'ANNOUNCEMENT',
      resourceId: created.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { courseId: access.course.id, title: input.title, notified },
    });
    return res.status(201).json({ data: view(created), notified });
  })
);

async function loadOwnAnnouncement(req: Parameters<typeof tenantIdOf>[0]) {
  const row = await prisma.announcement.findFirst({ where: { id: idSchema.parse(req.params.id), tenantId: tenantIdOf(req) } });
  if (!row) throw new HttpError(404, 'Announcement not found');
  await requireCourseStaff(req, row.courseId);
  return row;
}

/** PATCH /api/v1/announcements/:id: course staff correct or pin an announcement (no new notification). */
router.patch(
  '/announcements/:id',
  authenticateJWT,
  route('Failed to update the announcement', async (req, res) => {
    const row = await loadOwnAnnouncement(req);
    const input = parseBody(req, announcementUpdateSchema);
    const updated = await prisma.announcement.update({ where: { id: row.id }, data: input, include: authorSelect });
    return res.json({ data: view(updated) });
  })
);

/** DELETE /api/v1/announcements/:id */
router.delete(
  '/announcements/:id',
  authenticateJWT,
  route('Failed to delete the announcement', async (req, res) => {
    const row = await loadOwnAnnouncement(req);
    await prisma.announcement.delete({ where: { id: row.id } });
    await logAuditEvent({
      tenantId: tenantIdOf(req),
      userId: req.user!.id,
      action: 'ANNOUNCEMENT_DELETED',
      resourceType: 'ANNOUNCEMENT',
      resourceId: row.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { courseId: row.courseId, title: row.title },
    });
    return res.status(204).end();
  })
);

export default router;
