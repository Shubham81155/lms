import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@enterprise-lms/database';
import { prisma } from '../../lib/prisma';
import { logAuditEvent } from '../../lib/audit';
import { authenticateJWT, tenantIdOf } from '../../middleware/auth';
import { HttpError, route } from '../../lib/http';
import { idSchema, pageMeta, parseBody, parseQuery } from '../../lib/validate';
import { requireContentAccess, requireCourseStaff } from '../../lib/access';
import { config } from '../../config';
import { notify } from '../../lib/notify';
import { answersRevealed, assertQuizOpen, extensionFor, personalDue } from '../../lib/deadlines';
import { VERBS, recordStatement } from '../../lib/xapi';
import { dispatchWebhook } from '../../lib/webhooks';
import { MANUAL_TYPES, QuestionType as GradingType, gradeQuiz, hasPassed, normalizeAnswers } from '../../lib/grading';
import {
  TIME_LIMIT_GRACE_SECONDS,
  StoredGradingEntry,
  assertCanTake,
  loadQuiz,
  parseQuestionOptions,
  parseStoredAnswers,
  seesAnswerKeys,
  submissionListQuery,
} from './shared';

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

const expiryOf = (startedAt: Date, timeLimitMins: number | null) =>
  timeLimitMins ? new Date(startedAt.getTime() + (timeLimitMins * 60 + TIME_LIMIT_GRACE_SECONDS) * 1000) : null;

/** An attempt left open past its time limit is closed with no score so it still counts as used. */
async function closeExpiredAttempt(submissionId: string) {
  await prisma.quizSubmission.updateMany({
    where: { id: submissionId, submittedAt: null },
    data: { submittedAt: new Date(), score: 0, passed: false, answersJson: { expired: true } },
  });
}

/** Registers quiz attempt, submission, review, and manual grading routes on the assessments router. */
export function registerQuizSubmissionsRoutes(router: Router): void {
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
      // An attempt already under way may be resumed; a new one needs the quiz to be open.
      if (!open) assertQuizOpen(quiz, await extensionFor(userId, { quizId: quiz.id }));
      if (open) {
        const expiresAt = expiryOf(open.startedAt, quiz.timeLimitMins);
        if (!expiresAt || expiresAt > new Date()) {
          return res.status(200).json({
            data: { submissionId: open.id, attemptNumber: open.attemptNumber, startedAt: open.startedAt, expiresAt, resumed: true },
          });
        }
        await closeExpiredAttempt(open.id);
        assertQuizOpen(quiz, await extensionFor(userId, { quizId: quiz.id }));
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
    const submitted = normalizeAnswers(parseBody(req, submitSchema).answers);

    const open = await prisma.quizSubmission.findFirst({ where: { quizId: quiz.id, userId, submittedAt: null } });
    // Finishing an attempt that was started in time is always allowed; answering in one request needs the quiz open.
    if (!open) assertQuizOpen(quiz, await extensionFor(userId, { quizId: quiz.id }));

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
    const answersJson = {
      submittedAnswers: submitted,
      grading: grade.results,
      pendingManual: grade.pendingManual,
    } as unknown as Prisma.InputJsonValue;
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
        object: {
          id: `${config.APP_URL}/xapi/quizzes/${quiz.id}`,
          name: quiz.title,
          type: 'http://adlnet.gov/expapi/activities/assessment',
        },
        result: {
          score: { raw: grade.score, max: grade.maxScore, scaled: grade.maxScore > 0 ? grade.score / grade.maxScore : 0 },
          success: passed,
        },
      }),
    ]);
    // Not awaited: a slow receiver must not hold up the learner's response.
    void dispatchWebhook(tenantId, 'quiz.submitted', {
      quizId: quiz.id,
      submissionId,
      userId,
      score: grade.score,
      maxScore: grade.maxScore,
      passed,
    });

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
          const { answersJson, ...rest } = s;
          // Learners get results without the stored answer key analysis of other fields.
          return all
            ? { ...rest, answersJson }
            : { ...rest, pendingManualGrading: (parseStoredAnswers(answersJson).pendingManual ?? []).length > 0 };
        }),
        pagination: pageMeta(page, limit, total),
      });
    })
  );

  /**
   * GET /api/v1/quizzes/:id/submissions/:subId/review
   * One finished attempt, question by question. Staff see everything. A learner sees their own attempt as the
   * quiz's review policy allows: SCORE_ONLY (no questions), RESPONSES (their answers, marked right or wrong), or
   * ANSWERS (also the correct answers and explanations, once they have no attempts left or the quiz has closed).
   */
  router.get(
    '/quizzes/:id/submissions/:subId/review',
    authenticateJWT,
    route('Failed to load the attempt', async (req, res) => {
      const quiz = await loadQuiz(req, String(req.params.id));
      const access = await requireContentAccess(req, quiz.courseId);
      const staff = seesAnswerKeys(req, access);
      const sub = await prisma.quizSubmission.findFirst({ where: { id: idSchema.parse(req.params.subId), quizId: quiz.id } });
      if (!sub || (!staff && sub.userId !== req.user!.id)) throw new HttpError(404, 'Attempt not found');
      if (!sub.submittedAt) throw new HttpError(400, 'This attempt has not been submitted yet');

      const used = await prisma.quizSubmission.count({ where: { quizId: quiz.id, userId: sub.userId } });
      const closesAt = personalDue(quiz.dueAt, await extensionFor(sub.userId, { quizId: quiz.id }));
      const policy = staff ? 'ANSWERS' : quiz.reviewPolicy;
      const reveal = staff || answersRevealed(quiz.reviewPolicy, quiz.maxAttempts - used, closesAt);
      const stored = parseStoredAnswers(sub.answersJson);

      const questions =
        policy === 'SCORE_ONLY'
          ? []
          : quiz.questions.map((q) => {
              const result = stored.grading?.[q.id];
              const options = parseQuestionOptions(q.optionsJson);
              return {
                id: q.id,
                questionText: q.questionText,
                questionType: q.questionType,
                options: options.map((o) => ({ id: o.id ?? null, text: o.text ?? '' })),
                yourAnswer: stored.submittedAnswers?.[q.id] ?? null,
                awardedPoints: result?.awardedPoints ?? 0,
                maxPoints: result?.maxPoints ?? q.points,
                isCorrect: result?.isCorrect ?? null,
                needsManualGrading: !!result?.needsManualGrading,
                ...(reveal
                  ? {
                      correctOptionIds: options.filter((o) => o.isCorrect).map((o) => o.id ?? null),
                      correctAnswer: MANUAL_TYPES.includes(q.questionType as GradingType) ? null : q.correctAnswer,
                      explanation: q.explanation,
                    }
                  : {}),
              };
            });

      return res.json({
        data: {
          submissionId: sub.id,
          attemptNumber: sub.attemptNumber,
          submittedAt: sub.submittedAt,
          score: sub.score,
          maxScore: sub.maxScore,
          passed: sub.passed,
          pendingManualGrading: (stored.pendingManual ?? []).length > 0,
          reviewPolicy: quiz.reviewPolicy,
          answersRevealed: reveal,
          questions,
        },
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

      const stored = parseStoredAnswers(submission.answersJson);
      const grading: Record<string, StoredGradingEntry> = { ...(stored.grading ?? {}) };
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

      const results = Object.values(grading);
      const score = results.reduce((sum, r) => sum + r.awardedPoints, 0);
      const pendingManual = Object.keys(grading).filter((id) => grading[id].needsManualGrading);
      const passed = hasPassed(score, submission.maxScore, quiz.passingPercent, pendingManual.length);

      const updated = await prisma.quizSubmission.update({
        where: { id: submission.id },
        data: { score, passed, answersJson: { ...stored, grading, pendingManual } as unknown as Prisma.InputJsonValue },
      });

      if (pendingManual.length === 0) {
        await notify({
          tenantId,
          userId: submission.userId,
          category: 'GRADE',
          title: `Your quiz "${quiz.title}" has been graded`,
          body: `Score: ${score} / ${submission.maxScore}${passed ? ' (passed)' : ''}`,
          link: `/quizzes/${quiz.id}`,
        });
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
}
