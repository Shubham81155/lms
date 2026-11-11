import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { shouldCheckPlagiarism } from '../../lib/plagiarism-submit';
import { prisma, runInTenantTransaction } from '../../lib/prisma';
import { logAuditEvent } from '../../lib/audit';
import { authenticateJWT, tenantIdOf } from '../../middleware/auth';
import { HttpError, route } from '../../lib/http';
import { assertAttachable, linkOrUpload } from '../../lib/stored-files';
import { idSchema, pageMeta, parseBody, parseQuery } from '../../lib/validate';
import { requireContentAccess, requireCourseStaff } from '../../lib/access';
import { commitGrade, resolveGradeInput } from '../../lib/assignment-grade';
import { assignmentSubmissionTiming, extensionFor } from '../../lib/deadlines';
import { assertCanTake, loadAssignment, seesAnswerKeys, submissionListQuery } from './shared';

export const assignmentSubmissionSchema = z
  .object({
    /** An http(s) URL, or a file the learner uploaded for this course (/api/v1/files/<id>). */
    fileUrl: linkOrUpload.or(z.literal('')).optional(),
    submissionText: z.string().max(100_000).optional(),
  })
  .refine((d) => d.fileUrl || d.submissionText, { message: 'Either fileUrl or submissionText must be provided' });

export const gradeSubmissionSchema = z
  .object({
    grade: z.number().min(0).optional(),
    /** Points per rubric criterion, for assignments that have a rubric. */
    criteria: z.record(z.string().max(64), z.number().min(0).max(10_000)).optional(),
    feedback: z.string().max(10_000).optional(),
  })
  .refine((d) => (d.grade === undefined) !== (d.criteria === undefined), { message: 'Send either grade or criteria' });

/** Registers assignment submission, version history, and grading routes on the assessments router. */
export function registerAssignmentSubmissionsRoutes(router: Router): void {
  /**
   * POST /api/v1/assignments/:id/submit   (alias: POST /assignments/:id/submissions)
   * One submission per learner, replaceable until it has been graded. Every submit also keeps an immutable
   * copy (see GET .../submissions/:subId/versions); the response's `version` is its number.
   */
  const submitAssignment = route('Failed to submit assignment', async (req: Request, res: Response) => {
    const tenantId = tenantIdOf(req);
    const userId = req.user!.id;
    const assignment = await loadAssignment(req, String(req.params.id));
    assertCanTake(await requireContentAccess(req, assignment.courseId));
    const { fileUrl, submissionText } = parseBody(req, assignmentSubmissionSchema);
    await assertAttachable(fileUrl, { tenantId, courseId: assignment.courseId, purpose: 'ASSIGNMENT_SUBMISSION', ownerId: userId });

    const existing = await prisma.assignmentSubmission.findUnique({
      where: { assignmentId_userId: { assignmentId: assignment.id, userId } },
      select: { gradedAt: true },
    });
    if (existing?.gradedAt) throw new HttpError(409, 'This submission has already been graded and can no longer be changed');

    const now = new Date();
    const { isLate } = assignmentSubmissionTiming(assignment, await extensionFor(userId, { assignmentId: assignment.id }), now);
    const check = shouldCheckPlagiarism(submissionText);
    // A new or changed text invalidates any earlier similarity result.
    const data = {
      fileUrl: fileUrl || null,
      submissionText: submissionText || null,
      submittedAt: now,
      isLate,
      plagiarismScore: null,
      plagiarismReportUrl: null,
      plagiarismStatus: check ? 'PENDING' : null,
      plagiarismAttempts: 0,
      plagiarismNextAttemptAt: check ? now : null,
      plagiarismScanId: null,
    };
    const { submission, version } = await runInTenantTransaction(tenantId, async (tx) => {
      const submission = await tx.assignmentSubmission.upsert({
        where: { assignmentId_userId: { assignmentId: assignment.id, userId } },
        create: { assignmentId: assignment.id, userId, ...data },
        update: data,
      });
      const last = await tx.assignmentSubmissionVersion.findFirst({
        where: { submissionId: submission.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (last?.version ?? 0) + 1;
      await tx.assignmentSubmissionVersion.create({
        data: {
          tenantId,
          submissionId: submission.id,
          version,
          fileUrl: data.fileUrl,
          submissionText: data.submissionText,
          submittedAt: now,
          isLate,
        },
      });
      return { submission, version };
    });
    await logAuditEvent({
      tenantId,
      userId,
      action: 'ASSIGNMENT_SUBMITTED',
      resourceType: 'ASSIGNMENT_SUBMISSION',
      resourceId: submission.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { assignmentId: assignment.id, isLate, resubmission: !!existing, version },
    });

    return res.status(201).json({ data: { ...submission, version } });
  });
  router.post('/assignments/:id/submit', authenticateJWT, submitAssignment);
  router.post('/assignments/:id/submissions', authenticateJWT, submitAssignment);

  /** GET /api/v1/assignments/:id/submissions - staff/auditors: all; learners: their own */
  router.get(
    '/assignments/:id/submissions',
    authenticateJWT,
    route('Failed to retrieve assignment submissions', async (req, res) => {
      const assignment = await loadAssignment(req, String(req.params.id));
      const access = await requireContentAccess(req, assignment.courseId);
      const { page, limit, userId } = parseQuery(req, submissionListQuery);

      const all = seesAnswerKeys(req, access);
      const where = { assignmentId: assignment.id, ...(all ? (userId ? { userId } : {}) : { userId: req.user!.id }) };

      const [total, submissions] = await Promise.all([
        prisma.assignmentSubmission.count({ where }),
        prisma.assignmentSubmission.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { submittedAt: 'desc' },
          include: all ? { user: { select: { id: true, firstName: true, lastName: true, email: true } } } : undefined,
        }),
      ]);
      return res.status(200).json({ data: submissions, pagination: pageMeta(page, limit, total) });
    })
  );

  /**
   * GET /api/v1/assignments/:id/submissions/:subId/versions
   * Everything the learner handed in for this assignment, newest first: course staff and auditors, or the
   * learner themselves.
   */
  router.get(
    '/assignments/:id/submissions/:subId/versions',
    authenticateJWT,
    route('Failed to retrieve submission history', async (req, res) => {
      const assignment = await loadAssignment(req, String(req.params.id));
      const access = await requireContentAccess(req, assignment.courseId);
      const submission = await prisma.assignmentSubmission.findFirst({
        where: {
          id: idSchema.parse(req.params.subId),
          assignmentId: assignment.id,
          ...(seesAnswerKeys(req, access) ? {} : { userId: req.user!.id }),
        },
        select: { id: true },
      });
      if (!submission) throw new HttpError(404, 'Submission not found');
      const versions = await prisma.assignmentSubmissionVersion.findMany({
        where: { submissionId: submission.id },
        orderBy: { version: 'desc' },
        select: { version: true, fileUrl: true, submissionText: true, submittedAt: true, isLate: true },
      });
      return res.status(200).json({ data: versions });
    })
  );

  /**
   * PATCH /api/v1/assignments/:id/submissions/:subId/grade
   * Staff of the submission's own course only (not any instructor in the tenant).
   */
  router.patch(
    '/assignments/:id/submissions/:subId/grade',
    authenticateJWT,
    route('Failed to grade assignment submission', async (req, res) => {
      const tenantId = tenantIdOf(req);
      const assignment = await loadAssignment(req, String(req.params.id));
      await requireCourseStaff(req, assignment.courseId);
      const { grade, criteria, feedback } = parseBody(req, gradeSubmissionSchema);

      const submission = await prisma.assignmentSubmission.findFirst({
        where: { id: String(req.params.subId), assignmentId: assignment.id },
      });
      if (!submission) throw new HttpError(404, 'Assignment submission not found');

      const resolved = resolveGradeInput(assignment, { grade, criteria });
      const { updated, courseGradeReopened } = await commitGrade({ req, tenantId, assignment, submission, resolved, feedback });

      return res.status(200).json({ data: updated, courseGradeReopened });
    })
  );
}
