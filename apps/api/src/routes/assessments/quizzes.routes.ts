import { Router } from 'express';
import { z } from 'zod';
import { QuestionType } from '@enterprise-lms/database';
import { prisma } from '../../lib/prisma';
import { logAuditEvent } from '../../lib/audit';
import { authenticateJWT, tenantIdOf } from '../../middleware/auth';
import { HttpError, route } from '../../lib/http';
import { idSchema, parseBody } from '../../lib/validate';
import { requireContentAccess, requireCourseEditor } from '../../lib/access';
import { QuestionInput, validateQuestion, withOptionIds } from '../../lib/questions';
import { REVIEW_POLICIES } from '../../lib/deadlines';
import { loadQuiz, parseQuestionOptions, seesAnswerKeys, shuffled } from './shared';

const quizFields = {
  title: z.string().trim().min(1).max(255),
  timeLimitMins: z.number().int().min(1).max(1440).nullable().optional(),
  maxAttempts: z.number().int().min(1).max(100).optional(),
  randomizeQuestions: z.boolean().optional(),
  requireProctoring: z.boolean().optional(),
  /** With requireProctoring: watch the camera / microphone in the learner's browser (events only). */
  proctorCamera: z.boolean().optional(),
  proctorMicrophone: z.boolean().optional(),
  passingPercent: z.number().min(0).max(100).optional(),
  /** Learners can start the quiz from this time (null: any time). */
  availableFrom: z.coerce.date().nullable().optional(),
  /** Learners cannot start an attempt after this time, unless they have an extension (null: no close). */
  dueAt: z.coerce.date().nullable().optional(),
  reviewPolicy: z.enum(REVIEW_POLICIES).optional(),
};
const windowInOrder = (q: { availableFrom?: Date | null; dueAt?: Date | null }) =>
  !q.availableFrom || !q.dueAt || q.availableFrom < q.dueAt;
export const createQuizSchema = z
  .object(quizFields)
  .refine(windowInOrder, { message: 'The quiz must open before it closes', path: ['dueAt'] });
export const updateQuizSchema = z
  .object(quizFields)
  .partial()
  .refine(windowInOrder, { message: 'The quiz must open before it closes', path: ['dueAt'] });

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

/** Registers quiz and question CRUD routes on the assessments router. */
export function registerQuizzesRoutes(router: Router): void {
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
          proctorCamera: q.proctorCamera,
          proctorMicrophone: q.proctorMicrophone,
          availableFrom: q.availableFrom,
          dueAt: q.dueAt,
          reviewPolicy: q.reviewPolicy,
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
          ? parseQuestionOptions(q.optionsJson).map((o) => ({ id: o.id, text: o.text }))
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
          proctorCamera: quiz.proctorCamera,
          proctorMicrophone: quiz.proctorMicrophone,
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

  // -------------------------------------------------------------------------
  // Questions
  // -------------------------------------------------------------------------

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

      const existingOptions = existing.optionsJson as QuestionInput['optionsJson'];
      validateQuestion({
        questionType: input.questionType ?? existing.questionType,
        optionsJson: (input.optionsJson !== undefined ? input.optionsJson : existingOptions) ?? null,
        correctAnswer: input.correctAnswer !== undefined ? input.correctAnswer : existing.correctAnswer,
      });

      const updated = await prisma.quizQuestion.update({
        where: { id: existing.id },
        data: {
          questionText: input.questionText,
          questionType: input.questionType,
          points: input.points,
          orderIndex: input.orderIndex,
          optionsJson: input.optionsJson === undefined ? undefined : (withOptionIds(input.optionsJson) ?? undefined),
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
}
