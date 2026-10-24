import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { HttpError, route } from '../lib/http';
import { idSchema, parseBody, parseQuery } from '../lib/validate';
import { requireCourseStaff } from '../lib/access';
import { logAuditEvent } from '../lib/audit';
import { notify } from '../lib/notify';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';

// Mounted at /api/v1. Per-learner deadline extensions on assignments and quizzes, managed by course staff.

const router = Router();

const itemType = z.enum(['ASSIGNMENT', 'QUIZ']);

/** The item, its course, and the course-wide due date; 404 outside the caller's tenant. */
async function loadItem(req: Request, type: z.infer<typeof itemType>, id: string) {
  const tenantId = tenantIdOf(req);
  const item =
    type === 'ASSIGNMENT'
      ? await prisma.assignment
          .findFirst({ where: { id, tenantId }, select: { id: true, title: true, courseId: true, dueDate: true } })
          .then((a) => a && { ...a, due: a.dueDate })
      : await prisma.quiz
          .findFirst({ where: { id, tenantId }, select: { id: true, title: true, courseId: true, dueAt: true } })
          .then((q) => q && { ...q, due: q.dueAt });
  if (!item) throw new HttpError(404, type === 'ASSIGNMENT' ? 'Assignment not found' : 'Quiz not found');
  await requireCourseStaff(req, item.courseId);
  return item;
}

const view = (e: {
  id: string;
  userId: string;
  dueAt: Date;
  reason: string | null;
  createdAt: Date;
  user: { firstName: string; lastName: string; email: string };
}) => ({
  id: e.id,
  userId: e.userId,
  name: `${e.user.firstName} ${e.user.lastName}`,
  email: e.user.email,
  dueAt: e.dueAt,
  reason: e.reason,
  createdAt: e.createdAt,
});
const userSelect = { user: { select: { firstName: true, lastName: true, email: true } } } as const;

export const extensionListQuery = z.object({ itemType, itemId: idSchema });

/** GET /api/v1/extensions?itemType=&itemId=: the extensions granted on one assignment or quiz. */
router.get(
  '/extensions',
  authenticateJWT,
  route('Failed to load extensions', async (req, res) => {
    const q = parseQuery(req, extensionListQuery);
    const item = await loadItem(req, q.itemType, q.itemId);
    const rows = await prisma.deadlineExtension.findMany({
      where: q.itemType === 'ASSIGNMENT' ? { assignmentId: item.id } : { quizId: item.id },
      orderBy: { dueAt: 'asc' },
      include: userSelect,
    });
    return res.json({ data: rows.map(view) });
  })
);

export const extensionSchema = z.object({
  itemType,
  itemId: idSchema,
  userId: idSchema,
  dueAt: z.coerce.date(),
  reason: z.string().trim().max(1000).optional(),
});

/**
 * PUT /api/v1/extensions: grant (or change) one learner's extension. It must be later than the course-wide
 * due date and in the future. The learner is notified.
 */
router.put(
  '/extensions',
  authenticateJWT,
  route('Failed to grant the extension', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const input = parseBody(req, extensionSchema);
    const item = await loadItem(req, input.itemType, input.itemId);
    if (input.dueAt <= new Date()) throw new HttpError(400, 'An extension must end in the future');
    if (item.due && input.dueAt <= item.due) throw new HttpError(400, 'An extension must be later than the due date');

    const enrolled = await prisma.enrollment.findFirst({
      where: { tenantId, courseId: item.courseId, userId: input.userId, status: { in: ['ENROLLED', 'IN_PROGRESS', 'COMPLETED'] } },
      select: { id: true },
    });
    if (!enrolled) throw new HttpError(400, 'This person is not enrolled in the course');

    const key =
      input.itemType === 'ASSIGNMENT'
        ? { assignmentId_userId: { assignmentId: item.id, userId: input.userId } }
        : { quizId_userId: { quizId: item.id, userId: input.userId } };
    const row = await prisma.deadlineExtension.upsert({
      where: key as any,
      create: {
        tenantId,
        userId: input.userId,
        ...(input.itemType === 'ASSIGNMENT' ? { assignmentId: item.id } : { quizId: item.id }),
        dueAt: input.dueAt,
        reason: input.reason ?? null,
        grantedById: req.user!.id,
      },
      update: { dueAt: input.dueAt, reason: input.reason ?? null, grantedById: req.user!.id },
      include: userSelect,
    });

    await Promise.all([
      notify({
        tenantId,
        userId: input.userId,
        category: 'EXAM',
        title: `Extension: ${item.title}`,
        body: `Your new deadline is ${input.dueAt.toUTCString()}.`,
        link: input.itemType === 'ASSIGNMENT' ? `/courses/${item.courseId}/assignments` : `/quizzes/${item.id}`,
      }),
      logAuditEvent({
        tenantId,
        userId: req.user!.id,
        action: 'DEADLINE_EXTENDED',
        resourceType: input.itemType,
        resourceId: item.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        diffJson: { learnerId: input.userId, dueAt: input.dueAt.toISOString(), reason: input.reason ?? null },
      }),
    ]);
    return res.json({ data: view(row) });
  })
);

/** DELETE /api/v1/extensions/:id: withdraw an extension; the course-wide date applies again. */
router.delete(
  '/extensions/:id',
  authenticateJWT,
  route('Failed to remove the extension', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const row = await prisma.deadlineExtension.findFirst({ where: { id: idSchema.parse(req.params.id), tenantId } });
    if (!row) throw new HttpError(404, 'Extension not found');
    const item = await loadItem(req, row.assignmentId ? 'ASSIGNMENT' : 'QUIZ', (row.assignmentId ?? row.quizId)!);
    await prisma.deadlineExtension.delete({ where: { id: row.id } });
    await logAuditEvent({
      tenantId,
      userId: req.user!.id,
      action: 'DEADLINE_EXTENSION_REMOVED',
      resourceType: row.assignmentId ? 'ASSIGNMENT' : 'QUIZ',
      resourceId: item.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { learnerId: row.userId },
    });
    return res.status(204).end();
  })
);

export default router;
