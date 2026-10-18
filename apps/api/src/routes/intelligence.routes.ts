import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';
import { HttpError, route } from '../lib/http';
import { idSchema, pageMeta, paginationShape, parseBody, parseQuery } from '../lib/validate';
import { canSeeAllCourses, isAdminRole, requireCourseStaff } from '../lib/access';
import { isUuid } from '../lib/xapi';
import { notify } from '../lib/notify';
import { assessProctoring, computeAtRisk } from '../lib/risk';

// Mounted at /api/v1: xAPI Learning Record Store, proctoring telemetry, early-warning analytics.

const router = Router();

// ---------------------------------------------------------------------------
// xAPI LRS
// ---------------------------------------------------------------------------

export const statementSchema = z.object({
  id: z.string().refine(isUuid, 'Statement id must be a UUID').optional(),
  actor: z
    .object({ mbox: z.string().regex(/^mailto:[^\s@]+@[^\s@]+$/, 'actor.mbox must be a mailto: IRI'), name: z.string().max(200).optional() })
    .passthrough(),
  verb: z.object({ id: z.string().url().max(2048), display: z.record(z.string()).optional() }).passthrough(),
  object: z.object({ id: z.string().url().max(2048) }).passthrough(),
  result: z.record(z.unknown()).optional(),
  context: z.record(z.unknown()).optional(),
  timestamp: z.coerce.date().optional(),
});

const MAX_BATCH = 50;

/**
 * POST /api/v1/xapi/statements
 * Accepts one statement or an array. Learners may only record statements about themselves
 * (actor.mbox must be their own address); staff and admins may record on behalf of others.
 * Re-sending an id with identical content is accepted idempotently; different content is a 409.
 */
router.post(
  '/xapi/statements',
  authenticateJWT,
  route('Failed to record xAPI statement', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const user = req.user!;
    const raw = Array.isArray(req.body) ? req.body : [req.body];
    if (raw.length === 0 || raw.length > MAX_BATCH) throw new HttpError(400, `Send between 1 and ${MAX_BATCH} statements`);

    const parsed = raw.map((s) => statementSchema.safeParse(s));
    const bad = parsed.findIndex((p) => !p.success);
    if (bad >= 0) throw new HttpError(400, 'Invalid xAPI Statement format', { index: bad, issues: (parsed[bad] as any).error.format() });

    const privileged = isAdminRole(user.role) || user.role === 'INSTRUCTOR' || user.role === 'TEACHING_ASSISTANT';
    const ids: string[] = [];
    let stored = 0;

    for (const p of parsed) {
      const s = (p as { success: true; data: z.infer<typeof statementSchema> }).data;
      const email = s.actor.mbox.slice('mailto:'.length).toLowerCase();
      if (!privileged && email !== user.email.toLowerCase()) {
        throw new HttpError(403, 'Forbidden: you can only record statements about yourself');
      }
      const actor = await prisma.user.findFirst({ where: { tenantId, email }, select: { id: true } });
      const id = s.id ?? crypto.randomUUID();
      const timestamp = s.timestamp ?? new Date();
      const json = { ...s, id, timestamp: timestamp.toISOString(), authority: { mbox: `mailto:${user.email}` } };

      const existing = await prisma.xapiStatement.findUnique({ where: { id } });
      if (existing) {
        const same = existing.actorUserId === (actor?.id ?? null) && existing.verbId === s.verb.id && existing.objectId === s.object.id;
        if (!same) throw new HttpError(409, `Statement ${id} already exists with different content`);
        ids.push(id);
        continue;
      }
      await prisma.xapiStatement.create({
        data: { id, tenantId, actorUserId: actor?.id ?? null, verbId: s.verb.id, objectId: s.object.id, statementJson: json as any, timestamp },
      });
      ids.push(id);
      stored++;
    }
    return res.status(Array.isArray(req.body) ? 200 : 201).json({ message: 'xAPI Statement recorded', statementIds: ids, statementId: ids[0], stored });
  })
);

export const streamQuery = z.object({
  ...paginationShape,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  verb: z.string().max(2048).optional(),
  actorEmail: z.string().email().optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
});

/**
 * GET /api/v1/analytics/xapi/stream
 * Admins and auditors browse the tenant's statements. Instructors and assistants see statements about the
 * learners of courses they are assigned to (and their own). Everyone else sees only their own.
 */
router.get(
  '/analytics/xapi/stream',
  authenticateJWT,
  route('Failed to retrieve xAPI stream', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const user = req.user!;
    const q = parseQuery(req, streamQuery);
    const wholeTenant = canSeeAllCourses(user.role);
    const courseStaff = user.role === 'INSTRUCTOR' || user.role === 'TEACHING_ASSISTANT';

    // Whose statements this person may read: everyone (null), their courses' learners and themselves, or themselves.
    let visible: string[] | null = [user.id];
    if (wholeTenant) visible = null;
    else if (courseStaff) {
      const learners = await prisma.enrollment.findMany({
        where: { tenantId, course: { instructors: { some: { userId: user.id } } } },
        select: { userId: true },
        distinct: ['userId'],
      });
      visible = [user.id, ...learners.map((l) => l.userId)];
    }

    const actor = (wholeTenant || courseStaff) && q.actorEmail ? await prisma.user.findFirst({ where: { tenantId, email: q.actorEmail.toLowerCase() }, select: { id: true } }) : null;
    const actorFilter = q.actorEmail && (wholeTenant || courseStaff)
      ? { actorUserId: actor && (visible === null || visible.includes(actor.id)) ? actor.id : '__none__' }
      : visible === null
        ? {}
        : { actorUserId: { in: visible } };
    const where = {
      tenantId,
      ...actorFilter,
      ...(q.verb ? { verbId: q.verb } : {}),
      ...(q.since || q.until ? { timestamp: { ...(q.since ? { gte: q.since } : {}), ...(q.until ? { lte: q.until } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.xapiStatement.findMany({ where, orderBy: { timestamp: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }),
      prisma.xapiStatement.count({ where }),
    ]);
    return res.json({ total, statements: rows.map((r) => r.statementJson), pagination: pageMeta(q.page, q.limit, total) });
  })
);

// ---------------------------------------------------------------------------
// Proctoring telemetry
// ---------------------------------------------------------------------------

const EVENT_TYPES = ['TAB_SWITCH', 'FACE_NOT_DETECTED', 'MULTIPLE_FACES', 'AUDIO_SPIKE', 'COPY_PASTE', 'FULLSCREEN_EXIT', 'CAMERA_STOPPED', 'MICROPHONE_STOPPED'] as const;
/** Reported from the camera or microphone: only accepted when the quiz asks for that device. */
const CAMERA_EVENTS: readonly string[] = ['FACE_NOT_DETECTED', 'MULTIPLE_FACES', 'CAMERA_STOPPED'];
const MICROPHONE_EVENTS: readonly string[] = ['AUDIO_SPIKE', 'MICROPHONE_STOPPED'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const proctorEventSchema = z.object({
  submissionId: idSchema,
  eventType: z.enum(EVENT_TYPES),
  severity: z.enum(SEVERITIES),
  snapshotUrl: z.string().url().max(2048).refine((u) => /^https:\/\//i.test(u), 'snapshotUrl must be https').optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * POST /api/v1/proctoring/events
 * The test taker's browser reports integrity events for their own, still-open attempt. When the
 * running total crosses the threshold the course staff are notified once.
 */
router.post(
  '/proctoring/events',
  authenticateJWT,
  route('Failed to record proctoring event', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const body = parseBody(req, proctorEventSchema);

    const submission = await prisma.quizSubmission.findFirst({
      where: { id: body.submissionId, userId: req.user!.id },
      select: { id: true, submittedAt: true, quiz: { select: { id: true, title: true, courseId: true, requireProctoring: true, proctorCamera: true, proctorMicrophone: true } } },
    });
    if (!submission) throw new HttpError(404, 'Submission not found');
    if (submission.submittedAt) throw new HttpError(409, 'This attempt is already submitted');
    if (!submission.quiz.requireProctoring) throw new HttpError(400, 'Proctoring is not enabled for this quiz');
    if (CAMERA_EVENTS.includes(body.eventType) && !submission.quiz.proctorCamera) throw new HttpError(400, 'This quiz does not use the camera');
    if (MICROPHONE_EVENTS.includes(body.eventType) && !submission.quiz.proctorMicrophone) throw new HttpError(400, 'This quiz does not use the microphone');

    const before = assessProctoring(await prisma.proctoringLog.findMany({ where: { submissionId: submission.id }, select: { severity: true } }));
    await prisma.proctoringLog.create({
      data: {
        submissionId: submission.id,
        eventType: body.eventType,
        severity: body.severity,
        snapshotUrl: body.snapshotUrl ?? null,
        metadataJson: (body.metadata as any) ?? undefined,
      },
    });
    const after = assessProctoring(await prisma.proctoringLog.findMany({ where: { submissionId: submission.id }, select: { severity: true } }));

    if (after.flagged && !before.flagged) {
      const staff = await prisma.courseInstructor.findMany({ where: { courseId: submission.quiz.courseId }, select: { userId: true } });
      await Promise.all(
        staff.map((s) =>
          notify({
            tenantId,
            userId: s.userId,
            category: 'EXAM',
            title: `Proctoring flag on "${submission.quiz.title}"`,
            body: 'An attempt crossed the integrity-violation threshold and needs review.',
            link: `/quizzes/${submission.quiz.id}/submissions/${submission.id}`,
          })
        )
      );
    }
    return res.status(201).json({ status: 'recorded', flagged: after.flagged, riskScore: after.score, eventType: body.eventType, timestamp: new Date().toISOString() });
  })
);

/**
 * GET /api/v1/analytics/proctoring
 * Recent integrity events across the caller's courses (instructors, TAs) or the whole tenant
 * (administrators), plus how many proctored attempts are open right now.
 */
router.get(
  '/analytics/proctoring',
  authenticateJWT,
  route('Failed to load proctoring activity', async (req, res) => {
    const user = req.user!;
    const staff = isAdminRole(user.role) || user.role === 'INSTRUCTOR' || user.role === 'TEACHING_ASSISTANT';
    if (!staff) throw new HttpError(403, 'Forbidden: proctoring activity is for course staff');
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const courseScope = isAdminRole(user.role) ? {} : { course: { instructors: { some: { userId: user.id } } } };
    const quizScope = { tenantId: tenantIdOf(req), requireProctoring: true, ...courseScope };

    const [events, openAttempts] = await Promise.all([
      prisma.proctoringLog.findMany({
        where: { submission: { quiz: quizScope } },
        orderBy: { timestamp: 'desc' },
        take: limit,
        select: {
          id: true, eventType: true, severity: true, timestamp: true, submissionId: true,
          submission: { select: { user: { select: { firstName: true, lastName: true } }, quiz: { select: { title: true } } } },
        },
      }),
      prisma.quizSubmission.count({ where: { submittedAt: null, quiz: quizScope } }),
    ]);
    return res.json({
      openAttempts,
      data: events.map((e) => ({
        id: e.id,
        submissionId: e.submissionId,
        student: `${e.submission.user.firstName} ${e.submission.user.lastName}`,
        quiz: e.submission.quiz.title,
        eventType: e.eventType,
        severity: e.severity,
        timestamp: e.timestamp,
      })),
    });
  })
);

/**
 * GET /api/v1/analytics/pending-grading
 * Assignment submissions still waiting for a grade, oldest first, in the caller's courses (or the
 * whole tenant for administrators), with the plagiarism score when a provider has reported one.
 */
router.get(
  '/analytics/pending-grading',
  authenticateJWT,
  route('Failed to load pending submissions', async (req, res) => {
    const user = req.user!;
    const staff = isAdminRole(user.role) || user.role === 'INSTRUCTOR' || user.role === 'TEACHING_ASSISTANT';
    if (!staff) throw new HttpError(403, 'Forbidden: pending submissions are for course staff');
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '10'), 10) || 10));
    const where = {
      grade: null,
      assignment: { tenantId: tenantIdOf(req), ...(isAdminRole(user.role) ? {} : { course: { instructors: { some: { userId: user.id } } } }) },
    };
    const [total, rows] = await Promise.all([
      prisma.assignmentSubmission.count({ where }),
      prisma.assignmentSubmission.findMany({
        where,
        orderBy: { submittedAt: 'asc' },
        take: limit,
        select: {
          id: true, submittedAt: true, plagiarismScore: true,
          user: { select: { firstName: true, lastName: true } },
          assignment: { select: { id: true, title: true, course: { select: { id: true, code: true } } } },
        },
      }),
    ]);
    return res.json({
      total,
      data: rows.map((r) => ({
        id: r.id,
        student: `${r.user.firstName} ${r.user.lastName}`,
        assignmentId: r.assignment.id,
        assignment: r.assignment.title,
        course: r.assignment.course.code,
        courseId: r.assignment.course.id,
        submittedAt: r.submittedAt,
        plagiarismScore: r.plagiarismScore,
      })),
    });
  })
);

/** GET /api/v1/quizzes/:quizId/proctoring: per-attempt integrity summary for course staff. */
router.get(
  '/quizzes/:quizId/proctoring',
  authenticateJWT,
  route('Failed to load proctoring report', async (req, res) => {
    const quiz = await prisma.quiz.findFirst({ where: { id: idSchema.parse(req.params.quizId), tenantId: tenantIdOf(req) }, select: { id: true, courseId: true, title: true } });
    if (!quiz) throw new HttpError(404, 'Quiz not found');
    await requireCourseStaff(req, quiz.courseId);
    const subs = await prisma.quizSubmission.findMany({
      where: { quizId: quiz.id },
      select: { id: true, userId: true, attemptNumber: true, submittedAt: true, proctoringLogs: { orderBy: { timestamp: 'asc' } } },
    });
    return res.json({
      data: subs
        .filter((s) => s.proctoringLogs.length > 0)
        .map((s) => ({ submissionId: s.id, userId: s.userId, attemptNumber: s.attemptNumber, ...assessProctoring(s.proctoringLogs), events: s.proctoringLogs })),
    });
  })
);

// ---------------------------------------------------------------------------
// Early-warning analytics
// ---------------------------------------------------------------------------

export const atRiskQuery = z.object({ courseId: idSchema });

/** GET /api/v1/analytics/at-risk?courseId= : staff only; learners at MEDIUM or HIGH risk. */
router.get(
  '/analytics/at-risk',
  authenticateJWT,
  route('Failed to compute at-risk learners', async (req, res) => {
    const { courseId } = parseQuery(req, atRiskQuery);
    const access = await requireCourseStaff(req, courseId);
    const learners = await computeAtRisk(tenantIdOf(req), [access.course.id]);
    return res.json({ data: learners, total: learners.length });
  })
);

export const nudgeSchema = z.object({ courseId: idSchema, userId: idSchema, message: z.string().trim().max(500).optional() });

/** POST /api/v1/analytics/at-risk/nudge: course staff send an enrolled learner a nudge. */
router.post(
  '/analytics/at-risk/nudge',
  authenticateJWT,
  route('Failed to send nudge', async (req, res) => {
    const body = parseBody(req, nudgeSchema);
    const access = await requireCourseStaff(req, body.courseId);
    const enrolled = await prisma.enrollment.findUnique({ where: { courseId_userId: { courseId: access.course.id, userId: body.userId } }, select: { id: true } });
    if (!enrolled) throw new HttpError(404, 'Learner is not enrolled in this course');
    await notify({
      tenantId: tenantIdOf(req),
      userId: body.userId,
      category: 'COURSE',
      title: 'Your instructor sent you a nudge',
      body: body.message ?? 'You have some catching up to do. A short practice session today keeps you on track.',
      link: `/courses/${access.course.id}`,
    });
    return res.status(201).json({ data: { sent: true } });
  })
);

export default router;
