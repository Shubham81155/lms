import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { QuestionType } from '@enterprise-lms/database';
import { prisma } from '../lib/prisma';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';
import { HttpError, route } from '../lib/http';
import { httpUrl, idSchema, pageMeta, paginationShape, parseBody, parseQuery } from '../lib/validate';
import {
  CourseAccess,
  canSeeAllCourses,
  requireContentAccess,
  requireCourseEditor,
  requireCourseStaff,
} from '../lib/access';
import { config } from '../config';
import { commitGrade, resolveGradeInput } from '../lib/assignment-grade';
import { validateQuestion, withOptionIds } from '../lib/questions';
import { notify } from '../lib/notify';
import { awardXp, touchStreak } from '../lib/gamification';
import { VERBS, recordStatement } from '../lib/xapi';
import { dispatchWebhook } from '../lib/webhooks';
import { MANUAL_TYPES, QuestionType as GradingType, gradeQuiz, hasPassed, normalizeAnswers } from '../lib/grading';

const router = Router();

/** Extra seconds allowed beyond a quiz's time limit, to absorb network latency. */
const TIME_LIMIT_GRACE_SECONDS = 30;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const quizFields = {
  title: z.string().trim().min(1).max(255),
  timeLimitMins: z.number().int().min(1).max(1440).nullable().optional(),
  maxAttempts: z.number().int().min(1).max(100).optional(),
  randomizeQuestions: z.boolean().optional(),
  requireProctoring: z.boolean().optional(),
  passingPercent: z.number().min(0).max(100).optional(),
};
export const createQuizSchema = z.object(quizFields);
export const updateQuizSchema = z.object(quizFields).partial();

const optionSchema = z.object({
  id: idSchema.optional(),
  text: z.string().trim().min(1).max(2000),
  isCorrect: z.boolean(),
});

const questionFields = {
  questionText: z.string().trim().min(1).max(10_000),
  questionType: z.nativeEnum(QuestionType),
  points: z.number().positive().max(1000).optional(),
  orderIndex: z.number().int().min(0).max(10_000).optional(),
  optionsJson: z.array(optionSchema).max(20).nullable().optional(),
  correctAnswer: z.string().max(5000).nullable().optional(),
  explanation: z.string().max(10_000).nullable().optional(),
  bloomLevel: z.enum(['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYZE', 'EVALUATE', 'CREATE']).nullable().optional(),
};
export const createQuestionSchema = z.object(questionFields);
export const updateQuestionSchema = z.object(questionFields).partial();

const answerValue = z.union([z.string().max(20_000), z.array(z.string().max(2000)).max(50)]);
export const submitSchema = z.object({
  answers: z.union([
    z.record(z.string().max(64), answerValue),
    z.array(z.object({ questionId: idSchema, answer: answerValue.nullable() })).max(1000),
  ]),
});

export const manualGradeSchema = z.object({
  grades: z.record(z.string().max(64), z.number().min(0).max(1000)),
});

const assignmentFields = {
  title: z.string().trim().min(1).max(255),
  instructions: z.string().min(1).max(50_000),
  maxPoints: z.number().positive().max(10_000).optional(),
  dueDate: z.coerce.date().nullable().optional(),
};
export const createAssignmentSchema = z.object(assignmentFields);
export const updateAssignmentSchema = z.object(assignmentFields).partial();

export const assignmentSubmissionSchema = z
  .object({
    fileUrl: httpUrl.or(z.literal('')).optional(),
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

export const submissionListQuery = z.object({ ...paginationShape, userId: idSchema.optional() });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadQuiz(req: Request, quizId: string) {
  const quiz = await prisma.quiz.findFirst({
    where: { id: quizId, tenantId: tenantIdOf(req) },
    include: { questions: { orderBy: { orderIndex: 'asc' } } },
  });
  if (!quiz) throw new HttpError(404, 'Quiz not found');
  return quiz;
}

/** Learners (and anyone who is neither staff nor an auditor) must not see answer keys. */
const seesAnswerKeys = (req: Request, access: CourseAccess) => access.isStaff || canSeeAllCourses(req.user!.role);

function assertCanTake(access: CourseAccess) {
  if (access.isStaff || !access.isEnrolled || access.course.status !== 'PUBLISHED') {
    throw new HttpError(403, 'Forbidden: you must be an enrolled learner in a published course');
  }
}

const shuffled = <T>(items: T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

// ---------------------------------------------------------------------------
// Quizzes
// ---------------------------------------------------------------------------

/** GET /api/v1/courses/:courseId/quizzes */
router.get(
  '/courses/:courseId/quizzes',
  authenticateJWT,
  route('Failed to retrieve course quizzes', async (req, res) => {
    const courseId = String(req.params.courseId);
    await requireContentAccess(req, courseId);

    const quizzes = await prisma.quiz.findMany({
      where: { courseId, tenantId: tenantIdOf(req) },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { questions: true, submissions: true } } },
    });

    return res.status(200).json({
      data: quizzes.map((q) => ({
        id: q.id,
        courseId: q.courseId,
        title: q.title,
        timeLimitMins: q.timeLimitMins,
        maxAttempts: q.maxAttempts,
        passingPercent: q.passingPercent,
        requireProctoring: q.requireProctoring,
        questionCount: q._count.questions,
        submissionCount: q._count.submissions,
        createdAt: q.createdAt,
      })),
    });
  })
);

/** POST /api/v1/courses/:courseId/quizzes */
router.post(
  '/courses/:courseId/quizzes',
  authenticateJWT,
  route('Failed to create quiz', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const courseId = String(req.params.courseId);
    await requireCourseEditor(req, courseId);
    const input = parseBody(req, createQuizSchema);

    const quiz = await prisma.quiz.create({ data: { ...input, tenantId, courseId } });

    await logAuditEvent({
      tenantId,
      userId: req.user!.id,
      action: 'QUIZ_CREATED',
      resourceType: 'QUIZ',
      resourceId: quiz.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { courseId, title: quiz.title },
    });
    return res.status(201).json({ data: quiz });
  })
);

/** GET /api/v1/quizzes/:id - answer keys are only included for staff and auditors */
router.get(
  '/quizzes/:id',
  authenticateJWT,
  route('Failed to retrieve quiz', async (req, res) => {
    const quiz = await loadQuiz(req, String(req.params.id));
    const access = await requireContentAccess(req, quiz.courseId);
    const course = await prisma.course.findFirst({
      where: { id: quiz.courseId },
      select: { id: true, title: true, code: true },
    });

    if (seesAnswerKeys(req, access)) {
      return res.status(200).json({ data: { ...quiz, course } });
    }

    const attemptsUsed = await prisma.quizSubmission.count({ where: { quizId: quiz.id, userId: req.user!.id } });
    const ordered = quiz.randomizeQuestions ? shuffled(quiz.questions) : quiz.questions;
    const questions = ordered.map((q) => ({
      id: q.id,
      questionText: q.questionText,
      questionType: q.questionType,
      points: q.points,
      orderIndex: q.orderIndex,
      options: Array.isArray(q.optionsJson)
        ? (q.optionsJson as any[]).map((o) => ({ id: o?.id, text: o?.text }))
        : q.optionsJson,
    }));

    return res.status(200).json({
      data: {
        id: quiz.id,
        courseId: quiz.courseId,
        title: quiz.title,
        timeLimitMins: quiz.timeLimitMins,
        maxAttempts: quiz.maxAttempts,
        passingPercent: quiz.passingPercent,
        requireProctoring: quiz.requireProctoring,
        randomizeQuestions: quiz.randomizeQuestions,
        course,
        attemptsUsed,
        attemptsRemaining: Math.max(0, quiz.maxAttempts - attemptsUsed),
        questions,
      },
    });
  })
);

/** PATCH /api/v1/quizzes/:id */
router.patch(
  '/quizzes/:id',
  authenticateJWT,
  route('Failed to update quiz', async (req, res) => {
    const quiz = await loadQuiz(req, String(req.params.id));
    await requireCourseEditor(req, quiz.courseId);
    const input = parseBody(req, updateQuizSchema);

    const updated = await prisma.quiz.update({ where: { id: quiz.id }, data: input });
    await logAuditEvent({
      tenantId: tenantIdOf(req),
      userId: req.user!.id,
      action: 'QUIZ_UPDATED',
      resourceType: 'QUIZ',
      resourceId: quiz.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { changed: Object.keys(input) },
    });
    return res.status(200).json({ data: updated });
  })
);

/** DELETE /api/v1/quizzes/:id - refused once learners have submitted, so grades are never lost */
router.delete(
  '/quizzes/:id',
  authenticateJWT,
  route('Failed to delete quiz', async (req, res) => {
    const quiz = await loadQuiz(req, String(req.params.id));
    await requireCourseEditor(req, quiz.courseId);

    const submissions = await prisma.quizSubmission.count({ where: { quizId: quiz.id } });
    if (submissions > 0) {
      throw new HttpError(409, 'This quiz already has submissions and cannot be deleted');
    }

    await prisma.quiz.delete({ where: { id: quiz.id } });
    await logAuditEvent({
      tenantId: tenantIdOf(req),
      userId: req.user!.id,
      action: 'QUIZ_DELETED',
      resourceType: 'QUIZ',
      resourceId: quiz.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { courseId: quiz.courseId, title: quiz.title },
    });
    return res.status(200).json({ message: 'Quiz deleted', id: quiz.id });
  })
);

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/** POST /api/v1/quizzes/:id/questions */
router.post(
  '/quizzes/:id/questions',
  authenticateJWT,
  route('Failed to create question', async (req, res) => {
    const quiz = await loadQuiz(req, String(req.params.id));
    await requireCourseEditor(req, quiz.courseId);
    const input = parseBody(req, createQuestionSchema);
    validateQuestion(input);

    const orderIndex = input.orderIndex ?? quiz.questions.reduce((m, q) => Math.max(m, q.orderIndex + 1), 0);
    const question = await prisma.quizQuestion.create({
      data: {
        quizId: quiz.id,
        questionText: input.questionText,
        questionType: input.questionType,
        points: input.points ?? 1,
        orderIndex,
        optionsJson: withOptionIds(input.optionsJson) ?? undefined,
        correctAnswer: input.correctAnswer ?? null,
        explanation: input.explanation ?? null,
        bloomLevel: input.bloomLevel ?? null,
      },
    });
    return res.status(201).json({ data: question });
  })
);

/** PATCH /api/v1/quizzes/:id/questions/:questionId */
router.patch(
  '/quizzes/:id/questions/:questionId',
  authenticateJWT,
  route('Failed to update question', async (req, res) => {
    const quiz = await loadQuiz(req, String(req.params.id));
    await requireCourseEditor(req, quiz.courseId);
    const input = parseBody(req, updateQuestionSchema);

    const existing = quiz.questions.find((q) => q.id === String(req.params.questionId));
    if (!existing) throw new HttpError(404, 'Question not found');

    validateQuestion({
      questionType: input.questionType ?? existing.questionType,
      optionsJson: (input.optionsJson !== undefined ? input.optionsJson : (existing.optionsJson as any)) ?? null,
      correctAnswer: input.correctAnswer !== undefined ? input.correctAnswer : existing.correctAnswer,
    });

    const updated = await prisma.quizQuestion.update({
      where: { id: existing.id },
      data: {
        questionText: input.questionText,
        questionType: input.questionType,
        points: input.points,
        orderIndex: input.orderIndex,
        optionsJson: input.optionsJson === undefined ? undefined : withOptionIds(input.optionsJson) ?? undefined,
        correctAnswer: input.correctAnswer,
        explanation: input.explanation,
        bloomLevel: input.bloomLevel,
      },
    });
    return res.status(200).json({ data: updated });
  })
);

/** DELETE /api/v1/quizzes/:id/questions/:questionId */
router.delete(
  '/quizzes/:id/questions/:questionId',
  authenticateJWT,
  route('Failed to delete question', async (req, res) => {
    const quiz = await loadQuiz(req, String(req.params.id));
    await requireCourseEditor(req, quiz.courseId);

    const existing = quiz.questions.find((q) => q.id === String(req.params.questionId));
    if (!existing) throw new HttpError(404, 'Question not found');

    if ((await prisma.quizSubmission.count({ where: { quizId: quiz.id } })) > 0) {
      throw new HttpError(409, 'This quiz already has submissions; its questions can no longer be deleted');
    }
    await prisma.quizQuestion.delete({ where: { id: existing.id } });
    return res.status(200).json({ message: 'Question deleted', id: existing.id });
  })
);

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

const expiryOf = (startedAt: Date, timeLimitMins: number | null) =>
  timeLimitMins ? new Date(startedAt.getTime() + (timeLimitMins * 60 + TIME_LIMIT_GRACE_SECONDS) * 1000) : null;

/** An attempt left open past its time limit is closed with no score so it still counts as used. */
async function closeExpiredAttempt(submissionId: string) {
  await prisma.quizSubmission.updateMany({
    where: { id: submissionId, submittedAt: null },
    data: { submittedAt: new Date(), score: 0, passed: false, answersJson: { expired: true } },
  });
}

/**
 * POST /api/v1/quizzes/:id/start
 * Opens an attempt and starts the clock. Required for timed quizzes. Calling it again while an
 * attempt is open resumes that attempt.
 */
router.post(
  '/quizzes/:id/start',
  authenticateJWT,
  route('Failed to start quiz', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const userId = req.user!.id;
    const quiz = await loadQuiz(req, String(req.params.id));
    assertCanTake(await requireContentAccess(req, quiz.courseId));

    const open = await prisma.quizSubmission.findFirst({ where: { quizId: quiz.id, userId, submittedAt: null } });
    if (open) {
      const expiresAt = expiryOf(open.startedAt, quiz.timeLimitMins);
      if (!expiresAt || expiresAt > new Date()) {
        return res.status(200).json({
          data: { submissionId: open.id, attemptNumber: open.attemptNumber, startedAt: open.startedAt, expiresAt, resumed: true },
        });
      }
      await closeExpiredAttempt(open.id);
    }

    const used = await prisma.quizSubmission.count({ where: { quizId: quiz.id, userId } });
    if (used >= quiz.maxAttempts) {
      throw new HttpError(400, `Maximum attempts (${quiz.maxAttempts}) reached for this quiz`);
    }
    if (quiz.questions.length === 0) throw new HttpError(400, 'This quiz has no questions yet');

    const maxScore = quiz.questions.reduce((sum, q) => sum + (q.points > 0 ? q.points : 1), 0);
    const attempt = await prisma.quizSubmission.create({
      data: { quizId: quiz.id, userId, maxScore, attemptNumber: used + 1, answersJson: {} },
    });

    await logAuditEvent({
      tenantId,
      userId,
      action: 'QUIZ_STARTED',
      resourceType: 'QUIZ_SUBMISSION',
      resourceId: attempt.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { quizId: quiz.id, attemptNumber: attempt.attemptNumber },
    });

    return res.status(201).json({
      data: {
        submissionId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        startedAt: attempt.startedAt,
        expiresAt: expiryOf(attempt.startedAt, quiz.timeLimitMins),
        resumed: false,
      },
    });
  })
);

/**
 * POST /api/v1/quizzes/:id/submit   (alias: POST /quizzes/:id/submissions)
 * Grades objective questions immediately; essay and code questions wait for a grader.
 */
const submitQuiz = route('Failed to submit and grade quiz', async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const userId = req.user!.id;
  const quiz = await loadQuiz(req, String(req.params.id));
  assertCanTake(await requireContentAccess(req, quiz.courseId));
  const submitted = normalizeAnswers(parseBody(req, submitSchema).answers as any);

  const open = await prisma.quizSubmission.findFirst({ where: { quizId: quiz.id, userId, submittedAt: null } });

  if (quiz.timeLimitMins) {
    if (!open) throw new HttpError(400, 'This quiz is timed: start an attempt before submitting');
    const expiresAt = expiryOf(open.startedAt, quiz.timeLimitMins)!;
    if (expiresAt < new Date()) {
      await closeExpiredAttempt(open.id);
      throw new HttpError(400, 'The time limit for this attempt has passed');
    }
  }

  const used = await prisma.quizSubmission.count({ where: { quizId: quiz.id, userId } });
  if (!open && used >= quiz.maxAttempts) {
    throw new HttpError(400, `Maximum attempts (${quiz.maxAttempts}) reached for this quiz`);
  }
  if (quiz.questions.length === 0) throw new HttpError(400, 'This quiz has no questions yet');

  const grade = gradeQuiz(
    quiz.questions.map((q) => ({
      id: q.id,
      questionType: q.questionType as GradingType,
      points: q.points,
      optionsJson: q.optionsJson,
      correctAnswer: q.correctAnswer,
    })),
    submitted
  );
  const passed = hasPassed(grade.score, grade.maxScore, quiz.passingPercent, grade.pendingManual.length);
  const percentage = grade.maxScore > 0 ? (grade.score / grade.maxScore) * 100 : 0;
  const answersJson = { submittedAnswers: submitted, grading: grade.results, pendingManual: grade.pendingManual };
  const now = new Date();

  let submissionId: string;
  let attemptNumber: number;

  if (open) {
    // Only one request can close an open attempt; a concurrent duplicate gets a 409.
    const closed = await prisma.quizSubmission.updateMany({
      where: { id: open.id, submittedAt: null },
      data: { score: grade.score, maxScore: grade.maxScore, passed, submittedAt: now, answersJson },
    });
    if (closed.count !== 1) throw new HttpError(409, 'This attempt was already submitted');
    submissionId = open.id;
    attemptNumber = open.attemptNumber;
  } else {
    // (quizId, userId, attemptNumber) is unique, so concurrent submits cannot exceed maxAttempts.
    const created = await prisma.quizSubmission.create({
      data: {
        quizId: quiz.id,
        userId,
        score: grade.score,
        maxScore: grade.maxScore,
        passed,
        attemptNumber: used + 1,
        submittedAt: now,
        answersJson,
      },
    });
    submissionId = created.id;
    attemptNumber = created.attemptNumber;
  }

  // Engagement and telemetry side effects; none of these can fail the submission.
  await Promise.all([
    recordStatement({
      tenantId,
      user: { id: userId, email: req.user!.email },
      verb: grade.pendingManual.length > 0 ? VERBS.attempted : passed ? VERBS.passed : VERBS.failed,
      object: { id: `${config.APP_URL}/xapi/quizzes/${quiz.id}`, name: quiz.title, type: 'http://adlnet.gov/expapi/activities/assessment' },
      result: { score: { raw: grade.score, max: grade.maxScore, scaled: grade.maxScore > 0 ? grade.score / grade.maxScore : 0 }, success: passed },
    }),
    passed ? awardXp({ tenantId, userId, source: 'QUIZ_PASSED', refId: quiz.id }) : Promise.resolve(0),
    touchStreak(tenantId, userId).catch(() => null),
  ]);
  // Not awaited: a slow receiver must not hold up the learner's response.
  void dispatchWebhook(tenantId, 'quiz.submitted', { quizId: quiz.id, submissionId, userId, score: grade.score, maxScore: grade.maxScore, passed });

  await logAuditEvent({
    tenantId,
    userId,
    action: 'QUIZ_SUBMITTED',
    resourceType: 'QUIZ_SUBMISSION',
    resourceId: submissionId,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    diffJson: {
      quizId: quiz.id,
      score: grade.score,
      maxScore: grade.maxScore,
      percentage,
      passed,
      attemptNumber,
      pendingManual: grade.pendingManual.length,
    },
  });

  return res.status(201).json({
    data: {
      submissionId,
      score: grade.score,
      maxScore: grade.maxScore,
      percentage: parseFloat(percentage.toFixed(2)),
      passed,
      attemptNumber,
      attemptsRemaining: Math.max(0, quiz.maxAttempts - (open ? used : used + 1)),
      pendingManualGrading: grade.pendingManual.length > 0,
    },
  });
});
router.post('/quizzes/:id/submit', authenticateJWT, submitQuiz);
router.post('/quizzes/:id/submissions', authenticateJWT, submitQuiz);

/**
 * GET /api/v1/quizzes/:id/submissions
 * Staff and auditors see every submission; learners see only their own.
 */
router.get(
  '/quizzes/:id/submissions',
  authenticateJWT,
  route('Failed to retrieve quiz submissions', async (req, res) => {
    const quiz = await loadQuiz(req, String(req.params.id));
    const access = await requireContentAccess(req, quiz.courseId);
    const { page, limit, userId } = parseQuery(req, submissionListQuery);

    const all = seesAnswerKeys(req, access);
    const where = { quizId: quiz.id, ...(all ? (userId ? { userId } : {}) : { userId: req.user!.id }) };

    const [total, submissions] = await Promise.all([
      prisma.quizSubmission.count({ where }),
      prisma.quizSubmission.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { startedAt: 'desc' },
        include: all ? { user: { select: { id: true, firstName: true, lastName: true, email: true } } } : undefined,
      }),
    ]);

    return res.status(200).json({
      data: submissions.map((s) => {
        const { answersJson, ...rest } = s as typeof s & { answersJson: any };
        // Learners get results without the stored answer key analysis of other fields.
        return all ? { ...rest, answersJson } : { ...rest, pendingManualGrading: (answersJson?.pendingManual ?? []).length > 0 };
      }),
      pagination: pageMeta(page, limit, total),
    });
  })
);

/**
 * PATCH /api/v1/quizzes/:id/submissions/:subId/grade
 * Staff award points for essay / code questions; the verdict is computed once none are pending.
 */
router.patch(
  '/quizzes/:id/submissions/:subId/grade',
  authenticateJWT,
  route('Failed to grade submission', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const quiz = await loadQuiz(req, String(req.params.id));
    await requireCourseStaff(req, quiz.courseId);
    const { grades } = parseBody(req, manualGradeSchema);

    const submission = await prisma.quizSubmission.findFirst({
      where: { id: String(req.params.subId), quizId: quiz.id },
    });
    if (!submission || !submission.submittedAt) throw new HttpError(404, 'Submission not found');

    const stored = (submission.answersJson ?? {}) as any;
    const grading: Record<string, any> = { ...(stored.grading ?? {}) };
    const questions = new Map(quiz.questions.map((q) => [q.id, q]));

    for (const [questionId, points] of Object.entries(grades)) {
      const q = questions.get(questionId);
      if (!q || !(MANUAL_TYPES as readonly string[]).includes(q.questionType)) {
        throw new HttpError(400, `Question ${questionId} is not a manually graded question of this quiz`);
      }
      if (points > q.points) throw new HttpError(400, `Points for ${questionId} cannot exceed ${q.points}`);
      grading[questionId] = {
        awardedPoints: points,
        maxPoints: q.points,
        isCorrect: points >= q.points,
        needsManualGrading: false,
        gradedBy: req.user!.id,
        gradedAt: new Date().toISOString(),
      };
    }

    const results = Object.values(grading) as { awardedPoints: number; needsManualGrading: boolean }[];
    const score = results.reduce((sum, r) => sum + r.awardedPoints, 0);
    const pendingManual = Object.keys(grading).filter((id) => grading[id].needsManualGrading);
    const passed = hasPassed(score, submission.maxScore, quiz.passingPercent, pendingManual.length);

    const updated = await prisma.quizSubmission.update({
      where: { id: submission.id },
      data: { score, passed, answersJson: { ...stored, grading, pendingManual } },
    });

    if (pendingManual.length === 0) {
      await Promise.all([
        notify({
          tenantId,
          userId: submission.userId,
          category: 'GRADE',
          title: `Your quiz "${quiz.title}" has been graded`,
          body: `Score: ${score} / ${submission.maxScore}${passed ? ' (passed)' : ''}`,
          link: `/quizzes/${quiz.id}`,
        }),
        passed ? awardXp({ tenantId, userId: submission.userId, source: 'QUIZ_PASSED', refId: quiz.id }) : Promise.resolve(0),
      ]);
    }

    await logAuditEvent({
      tenantId,
      userId: req.user!.id,
      action: 'GRADE_MODIFIED',
      resourceType: 'GRADE',
      resourceId: submission.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { quizId: quiz.id, previousScore: submission.score, newScore: score, passed, graded: Object.keys(grades) },
    });

    return res.status(200).json({
      data: { id: updated.id, score, maxScore: updated.maxScore, passed, pendingManualGrading: pendingManual.length > 0 },
    });
  })
);

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

async function loadAssignment(req: Request, assignmentId: string) {
  const assignment = await prisma.assignment.findFirst({ where: { id: assignmentId, tenantId: tenantIdOf(req) } });
  if (!assignment) throw new HttpError(404, 'Assignment not found');
  return assignment;
}

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
    // Submission counts are staff information.
    return res.status(200).json({
      data: assignments.map(({ _count, ...a }) => (seesAnswerKeys(req, access) ? { ...a, _count } : a)),
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

/**
 * POST /api/v1/assignments/:id/submit   (alias: POST /assignments/:id/submissions)
 * One submission per learner, replaceable until it has been graded.
 */
const submitAssignment = route('Failed to submit assignment', async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const userId = req.user!.id;
  const assignment = await loadAssignment(req, String(req.params.id));
  assertCanTake(await requireContentAccess(req, assignment.courseId));
  const { fileUrl, submissionText } = parseBody(req, assignmentSubmissionSchema);

  const existing = await prisma.assignmentSubmission.findUnique({
    where: { assignmentId_userId: { assignmentId: assignment.id, userId } },
    select: { gradedAt: true },
  });
  if (existing?.gradedAt) throw new HttpError(409, 'This submission has already been graded and can no longer be changed');

  const now = new Date();
  const data = { fileUrl: fileUrl || null, submissionText: submissionText || null, submittedAt: now };
  const submission = await prisma.assignmentSubmission.upsert({
    where: { assignmentId_userId: { assignmentId: assignment.id, userId } },
    create: { assignmentId: assignment.id, userId, ...data },
    update: data,
  });
  const isLate = !!assignment.dueDate && now > assignment.dueDate;

  await logAuditEvent({
    tenantId,
    userId,
    action: 'ASSIGNMENT_SUBMITTED',
    resourceType: 'ASSIGNMENT_SUBMISSION',
    resourceId: submission.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    diffJson: { assignmentId: assignment.id, isLate, resubmission: !!existing },
  });

  return res.status(201).json({ data: { ...submission, isLate } });
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

export default router;
