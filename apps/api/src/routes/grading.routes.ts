import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@enterprise-lms/database';
import { prisma } from '../lib/prisma';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';
import { HttpError, route } from '../lib/http';
import { idSchema, parseBody } from '../lib/validate';
import { isAdminRole, requireContentAccess, requireCourseEditor, requireCourseStaff } from '../lib/access';
import { notify } from '../lib/notify';
import { RubricError, normaliseCriteria, rubricTotal } from '../lib/rubric';
import { commitGrade, resolveGradeInput } from '../lib/assignment-grade';

// Mounted at /api/v1. Per-criterion rubrics for assignments, and grade appeals: a learner can ask
// for a graded assignment to be reviewed once, within APPEAL_WINDOW_DAYS of the grade, and a course
// editor decides it.

const router = Router();
router.use(['/assignments/:id/rubric', '/assignments/:id/submissions/:subId/appeal', '/courses/:courseId/appeals', '/appeals'], authenticateJWT);

export const APPEAL_WINDOW_DAYS = 14;

export const rubricSchema = z.object({
  criteria: z
    .array(
      z.object({
        id: idSchema.optional(),
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(1000).optional(),
        maxPoints: z.number().positive().max(10_000),
      })
    )
    .max(30)
    .nullable(),
});
export const appealSchema = z.object({ reason: z.string().trim().min(10).max(2000) });
export const resolveSchema = z
  .object({
    decision: z.enum(['UPHELD', 'DENIED']),
    response: z.string().trim().min(3).max(2000),
    grade: z.number().min(0).optional(),
    criteria: z.record(z.string().max(64), z.number().min(0).max(10_000)).optional(),
  })
  .refine((d) => d.decision === 'UPHELD' || (d.grade === undefined && d.criteria === undefined), { message: 'A denied appeal cannot change the grade' })
  .refine((d) => d.decision === 'DENIED' || (d.grade === undefined) !== (d.criteria === undefined), { message: 'An upheld appeal needs the corrected grade (or criterion scores)' });

async function loadAssignment(tenantId: string, id: string) {
  const a = await prisma.assignment.findFirst({ where: { id, tenantId } });
  if (!a) throw new HttpError(404, 'Assignment not found');
  return a;
}

/**
 * PUT /api/v1/assignments/:id/rubric {criteria}
 * Sets the rubric (the assignment's max points become the sum of the criteria) or removes it with
 * `criteria: null`. Refused once any submission has been graded, because that would change the
 * meaning of grades already given.
 */
router.put(
  '/assignments/:id/rubric',
  route('Failed to save rubric', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const assignment = await loadAssignment(tenantId, idSchema.parse(req.params.id));
    await requireCourseEditor(req, assignment.courseId);
    const { criteria } = parseBody(req, rubricSchema);

    if ((await prisma.assignmentSubmission.count({ where: { assignmentId: assignment.id, gradedAt: { not: null } } })) > 0) {
      throw new HttpError(409, 'Some submissions are already graded, so the rubric can no longer be changed');
    }
    let normalised: ReturnType<typeof normaliseCriteria> | null = null;
    try {
      if (criteria !== null) normalised = normaliseCriteria(criteria);
    } catch (e) {
      if (e instanceof RubricError) throw new HttpError(400, e.message);
      throw e;
    }
    const updated = await prisma.assignment.update({
      where: { id: assignment.id },
      data: normalised ? { rubricJson: normalised as any, maxPoints: rubricTotal(normalised) } : { rubricJson: Prisma.DbNull },
    });
    await logAuditEvent({
      tenantId, userId: req.user!.id, action: criteria === null ? 'ASSIGNMENT_RUBRIC_REMOVED' : 'ASSIGNMENT_RUBRIC_SET', resourceType: 'ASSIGNMENT', resourceId: assignment.id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], diffJson: { criteria: criteria?.length ?? 0, maxPoints: updated.maxPoints },
    });
    return res.json({ data: { rubric: updated.rubricJson, maxPoints: updated.maxPoints } });
  })
);

/** POST /api/v1/assignments/:id/submissions/:subId/appeal: the owner asks for a review. */
router.post(
  '/assignments/:id/submissions/:subId/appeal',
  route('Failed to submit appeal', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const assignment = await loadAssignment(tenantId, idSchema.parse(req.params.id));
    const submission = await prisma.assignmentSubmission.findFirst({ where: { id: idSchema.parse(req.params.subId), assignmentId: assignment.id } });
    // Someone else's submission is indistinguishable from a missing one.
    if (!submission || submission.userId !== req.user!.id) throw new HttpError(404, 'Submission not found');
    const access = await requireContentAccess(req, assignment.courseId);
    const { reason } = parseBody(req, appealSchema);

    if (!submission.gradedAt) throw new HttpError(409, 'This submission has not been graded yet');
    if (Date.now() - submission.gradedAt.getTime() > APPEAL_WINDOW_DAYS * 86_400_000) {
      throw new HttpError(409, `Appeals must be filed within ${APPEAL_WINDOW_DAYS} days of the grade`);
    }
    try {
      const appeal = await prisma.gradeAppeal.create({
        data: { tenantId, submissionId: submission.id, courseId: assignment.courseId, userId: req.user!.id, reason },
      });
      await Promise.all(
        access.course.instructorIds.map((userId) =>
          notify({ tenantId, userId, category: 'GRADE', title: `Grade appeal on "${assignment.title}"`, body: reason.slice(0, 140), link: `/courses/${assignment.courseId}/appeals` })
        )
      );
      await logAuditEvent({ tenantId, userId: req.user!.id, action: 'GRADE_APPEAL_FILED', resourceType: 'GRADE_APPEAL', resourceId: appeal.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
      return res.status(201).json({ data: appeal });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new HttpError(409, 'This grade has already been appealed');
      throw e;
    }
  })
);

/** GET /api/v1/courses/:courseId/appeals: staff see every appeal in the course; learners their own. */
router.get(
  '/courses/:courseId/appeals',
  route('Failed to load appeals', async (req, res) => {
    const access = await requireContentAccess(req, idSchema.parse(req.params.courseId));
    const all = access.isStaff || req.user!.role === 'AUDITOR' || isAdminRole(req.user!.role);
    const rows = await prisma.gradeAppeal.findMany({
      where: { courseId: access.course.id, ...(all ? {} : { userId: req.user!.id }) },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      include: {
        submission: {
          select: {
            id: true, grade: true, feedback: true, rubricScoresJson: true, submissionText: true,
            assignment: { select: { id: true, title: true, maxPoints: true, rubricJson: true } },
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    return res.json({
      data: rows.map((a) => ({
        id: a.id, status: a.status, reason: a.reason, response: a.response, createdAt: a.createdAt, respondedAt: a.respondedAt,
        student: all ? `${a.submission.user.firstName} ${a.submission.user.lastName}` : undefined,
        submission: {
          id: a.submission.id, grade: a.submission.grade, feedback: a.submission.feedback, rubricScores: a.submission.rubricScoresJson,
          ...(all ? { text: a.submission.submissionText } : {}),
        },
        assignment: a.submission.assignment,
      })),
    });
  })
);

/**
 * POST /api/v1/appeals/:id/resolve
 * A course editor (instructor or administrator, not a TA) decides. UPHELD must carry the corrected
 * grade; DENIED must not. The new grade is validated before the appeal is closed, and closing is
 * a conditional update so two reviewers cannot both resolve it.
 */
router.post(
  '/appeals/:id/resolve',
  route('Failed to resolve appeal', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const appeal = await prisma.gradeAppeal.findFirst({ where: { id: idSchema.parse(req.params.id) } });
    if (!appeal) throw new HttpError(404, 'Appeal not found');
    await requireCourseStaff(req, appeal.courseId);
    await requireCourseEditor(req, appeal.courseId);
    const body = parseBody(req, resolveSchema);
    if (appeal.status !== 'OPEN') throw new HttpError(409, 'This appeal has already been decided');

    const submission = await prisma.assignmentSubmission.findFirst({ where: { id: appeal.submissionId } });
    const assignment = submission ? await prisma.assignment.findFirst({ where: { id: submission.assignmentId } }) : null;
    if (!submission || !assignment) throw new HttpError(404, 'Submission not found');

    const resolved = body.decision === 'UPHELD' ? resolveGradeInput(assignment, { grade: body.grade, criteria: body.criteria }) : null;

    const claimed = await prisma.gradeAppeal.updateMany({
      where: { id: appeal.id, status: 'OPEN' },
      data: { status: body.decision, response: body.response, respondedById: req.user!.id, respondedAt: new Date() },
    });
    if (claimed.count !== 1) throw new HttpError(409, 'This appeal has already been decided');

    let courseGradeReopened = false;
    if (resolved) {
      ({ courseGradeReopened } = await commitGrade({
        req, tenantId, assignment, submission, resolved, feedback: submission.feedback, action: 'GRADE_CHANGED_ON_APPEAL',
        note: `Your appeal was upheld. New grade: ${resolved.grade} / ${assignment.maxPoints}. ${body.response}`,
      }));
    } else {
      await notify({ tenantId, userId: appeal.userId, category: 'GRADE', title: `Your appeal on "${assignment.title}" was decided`, body: `Not upheld. ${body.response}`, link: `/assignments/${assignment.id}` });
    }
    await logAuditEvent({
      tenantId, userId: req.user!.id, action: `GRADE_APPEAL_${body.decision}`, resourceType: 'GRADE_APPEAL', resourceId: appeal.id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], diffJson: { previousGrade: submission.grade, newGrade: resolved?.grade ?? submission.grade, courseGradeReopened },
    });
    return res.json({ data: { id: appeal.id, status: body.decision, courseGradeReopened } });
  })
);

export default router;
