import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { logAuditEvent } from '../../lib/audit';
import { authenticateJWT, tenantIdOf } from '../../middleware/auth';
import { HttpError, route } from '../../lib/http';
import { parseBody } from '../../lib/validate';
import { requireContentAccess, requireCourseEditor } from '../../lib/access';
import { personalDue } from '../../lib/deadlines';
import { loadAssignment, seesAnswerKeys } from './shared';

const assignmentFields = {
  title: z.string().trim().min(1).max(255),
  instructions: z.string().min(1).max(50_000),
  maxPoints: z.number().positive().max(10_000).optional(),
  dueDate: z.coerce.date().nullable().optional(),
  /** Late work is accepted until this time (null: always accepted, flagged as late after the due date). */
  acceptLateUntil: z.coerce.date().nullable().optional(),
};
const cutoffAfterDue = (a: { dueDate?: Date | null; acceptLateUntil?: Date | null }) =>
  !a.acceptLateUntil || !a.dueDate || a.acceptLateUntil >= a.dueDate;
export const createAssignmentSchema = z
  .object(assignmentFields)
  .refine(cutoffAfterDue, { message: 'Late work must be accepted until a time after the due date', path: ['acceptLateUntil'] });
export const updateAssignmentSchema = z
  .object(assignmentFields)
  .partial()
  .refine(cutoffAfterDue, { message: 'Late work must be accepted until a time after the due date', path: ['acceptLateUntil'] });

/** Registers assignment CRUD routes on the assessments router. */
export function registerAssignmentsRoutes(router: Router): void {
  /** GET /api/v1/courses/:courseId/assignments */
  router.get(
    '/courses/:courseId/assignments',
    authenticateJWT,
    route('Failed to retrieve course assignments', async (req, res) => {
      const courseId = String(req.params.courseId);
      const access = await requireContentAccess(req, courseId);

      const assignments = await prisma.assignment.findMany({
        where: { courseId, tenantId: tenantIdOf(req) },
        orderBy: { createdAt: 'asc' },
        include: { _count: { select: { submissions: true } } },
      });
      // Submission counts are staff information; a learner instead sees their own due date (extension included).
      if (seesAnswerKeys(req, access)) return res.status(200).json({ data: assignments });
      const extensions = await prisma.deadlineExtension.findMany({
        where: { userId: req.user!.id, assignmentId: { in: assignments.map((a) => a.id) } },
        select: { assignmentId: true, dueAt: true },
      });
      const extended = new Map(extensions.map((e) => [e.assignmentId!, e.dueAt]));
      return res.status(200).json({
        data: assignments.map(({ _count, ...a }) => ({
          ...a,
          myDueAt: personalDue(a.dueDate, extended.get(a.id) ?? null),
          extended: extended.has(a.id),
        })),
      });
    })
  );

  /** POST /api/v1/courses/:courseId/assignments */
  router.post(
    '/courses/:courseId/assignments',
    authenticateJWT,
    route('Failed to create assignment', async (req, res) => {
      const tenantId = tenantIdOf(req);
      const courseId = String(req.params.courseId);
      await requireCourseEditor(req, courseId);
      const input = parseBody(req, createAssignmentSchema);

      const assignment = await prisma.assignment.create({
        data: { ...input, dueDate: input.dueDate ?? null, tenantId, courseId },
      });
      await logAuditEvent({
        tenantId,
        userId: req.user!.id,
        action: 'ASSIGNMENT_CREATED',
        resourceType: 'ASSIGNMENT',
        resourceId: assignment.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        diffJson: { courseId, title: assignment.title },
      });
      return res.status(201).json({ data: assignment });
    })
  );

  /** PATCH /api/v1/assignments/:id */
  router.patch(
    '/assignments/:id',
    authenticateJWT,
    route('Failed to update assignment', async (req, res) => {
      const assignment = await loadAssignment(req, String(req.params.id));
      await requireCourseEditor(req, assignment.courseId);
      const input = parseBody(req, updateAssignmentSchema);

      const updated = await prisma.assignment.update({ where: { id: assignment.id }, data: input });
      return res.status(200).json({ data: updated });
    })
  );

  /** DELETE /api/v1/assignments/:id - refused once learners have submitted */
  router.delete(
    '/assignments/:id',
    authenticateJWT,
    route('Failed to delete assignment', async (req, res) => {
      const assignment = await loadAssignment(req, String(req.params.id));
      await requireCourseEditor(req, assignment.courseId);

      if ((await prisma.assignmentSubmission.count({ where: { assignmentId: assignment.id } })) > 0) {
        throw new HttpError(409, 'This assignment already has submissions and cannot be deleted');
      }
      await prisma.assignment.delete({ where: { id: assignment.id } });
      return res.status(200).json({ message: 'Assignment deleted', id: assignment.id });
    })
  );
}
