import { Router, Request } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { QuestionType } from '@enterprise-lms/database';
import { prisma } from '../lib/prisma';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';
import { HttpError, route } from '../lib/http';
import { idSchema, pageMeta, paginationShape, parseBody, parseQuery } from '../lib/validate';
import { isAdminRole, requireCourseEditor } from '../lib/access';
import { validateQuestion, withOptionIds } from '../lib/questions';

// Mounted at /api/v1. A reusable pool of questions for instructors and administrators. An item is
// visible to its owner, to administrators, and (when it names a course) to that course's staff.
// Copying an item into a quiz makes an independent QuizQuestion, so later edits never rewrite
// quizzes that already have submissions.

const router = Router();
router.use(['/question-bank', '/quizzes/:quizId/questions/from-bank'], authenticateJWT);

export const BLOOM_LEVELS = ['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYZE', 'EVALUATE', 'CREATE'] as const;

const optionSchema = z.object({ id: idSchema.optional(), text: z.string().trim().min(1).max(2000), isCorrect: z.boolean() });
const tag = z.string().trim().toLowerCase().min(1).max(40);
const itemFields = {
  questionText: z.string().trim().min(1).max(10_000),
  questionType: z.nativeEnum(QuestionType),
  points: z.number().positive().max(1000).optional(),
  optionsJson: z.array(optionSchema).max(20).nullable().optional(),
  correctAnswer: z.string().max(5000).nullable().optional(),
  explanation: z.string().max(10_000).nullable().optional(),
  tags: z.array(tag).max(20).optional(),
  bloomLevel: z.enum(BLOOM_LEVELS).nullable().optional(),
  courseId: idSchema.nullable().optional(),
};
export const createSchema = z.object(itemFields);
export const updateSchema = z.object(itemFields).partial();
export const listQuery = z.object({
  ...paginationShape,
  q: z.string().trim().max(200).optional(),
  tag: tag.optional(),
  type: z.nativeEnum(QuestionType).optional(),
  bloomLevel: z.enum(BLOOM_LEVELS).optional(),
  courseId: idSchema.optional(),
});
export const fromBankSchema = z.object({ itemIds: z.array(idSchema).min(1).max(50) });

/** Only instructors and administrators author questions; TAs and learners never see the bank. */
function assertAuthor(req: Request) {
  const role = req.user!.role;
  if (role !== 'INSTRUCTOR' && !isAdminRole(role))
    throw new HttpError(403, 'Forbidden: the question bank is for instructors and administrators');
}

async function taughtCourseIds(req: Request): Promise<string[]> {
  const rows = await prisma.courseInstructor.findMany({ where: { userId: req.user!.id }, select: { courseId: true } });
  return rows.map((r) => r.courseId);
}

async function visibleWhere(req: Request) {
  const tenantId = tenantIdOf(req);
  if (isAdminRole(req.user!.role)) return { tenantId };
  return { tenantId, OR: [{ ownerId: req.user!.id }, { courseId: { in: await taughtCourseIds(req) } }] };
}

async function loadVisible(req: Request, id: string) {
  const item = await prisma.questionBankItem.findFirst({ where: { id, ...(await visibleWhere(req)) } });
  if (!item) throw new HttpError(404, 'Question not found');
  return item;
}

const canModify = (req: Request, item: { ownerId: string }) => isAdminRole(req.user!.role) || item.ownerId === req.user!.id;

/** A bank item may be tied to a course only if the author can edit that course. */
async function checkCourse(req: Request, courseId: string | null | undefined) {
  if (courseId) await requireCourseEditor(req, courseId);
}

const dedupe = (t?: string[]) => (t ? [...new Set(t)] : undefined);

/** GET /api/v1/question-bank */
router.get(
  '/question-bank',
  route('Failed to load question bank', async (req, res) => {
    assertAuthor(req);
    const { page, limit, q, tag: t, type, bloomLevel, courseId } = parseQuery(req, listQuery);
    const where = {
      AND: [
        await visibleWhere(req),
        ...(q ? [{ questionText: { contains: q, mode: 'insensitive' as const } }] : []),
        ...(t ? [{ tags: { has: t } }] : []),
        ...(type ? [{ questionType: type }] : []),
        ...(bloomLevel ? [{ bloomLevel }] : []),
        ...(courseId ? [{ courseId }] : []),
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.questionBankItem.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.questionBankItem.count({ where }),
    ]);
    return res.json({ data: rows, pagination: pageMeta(page, limit, total) });
  })
);

/** POST /api/v1/question-bank */
router.post(
  '/question-bank',
  route('Failed to create question', async (req, res) => {
    assertAuthor(req);
    const input = parseBody(req, createSchema);
    validateQuestion(input);
    await checkCourse(req, input.courseId);
    const item = await prisma.questionBankItem.create({
      data: {
        tenantId: tenantIdOf(req),
        ownerId: req.user!.id,
        courseId: input.courseId ?? null,
        questionText: input.questionText,
        questionType: input.questionType,
        points: input.points ?? 1,
        optionsJson: withOptionIds(input.optionsJson) ?? undefined,
        correctAnswer: input.correctAnswer ?? null,
        explanation: input.explanation ?? null,
        tags: dedupe(input.tags) ?? [],
        bloomLevel: input.bloomLevel ?? null,
      },
    });
    return res.status(201).json({ data: item });
  })
);

/** GET /api/v1/question-bank/:id */
router.get(
  '/question-bank/:id',
  route('Failed to load question', async (req, res) => {
    assertAuthor(req);
    return res.json({ data: await loadVisible(req, idSchema.parse(req.params.id)) });
  })
);

/** PATCH /api/v1/question-bank/:id: owner or administrator. */
router.patch(
  '/question-bank/:id',
  route('Failed to update question', async (req, res) => {
    assertAuthor(req);
    const item = await loadVisible(req, idSchema.parse(req.params.id));
    if (!canModify(req, item)) throw new HttpError(403, 'Forbidden: only the author or an administrator can change this question');
    const patch = parseBody(req, updateSchema);
    validateQuestion({
      questionType: patch.questionType ?? item.questionType,
      optionsJson: patch.optionsJson !== undefined ? patch.optionsJson : (item.optionsJson as any),
      correctAnswer: patch.correctAnswer !== undefined ? patch.correctAnswer : item.correctAnswer,
    });
    if (patch.courseId !== undefined) await checkCourse(req, patch.courseId);
    const { optionsJson, tags, ...rest } = patch;
    const updated = await prisma.questionBankItem.update({
      where: { id: item.id },
      data: {
        ...rest,
        ...(optionsJson !== undefined ? { optionsJson: (withOptionIds(optionsJson) as any) ?? undefined } : {}),
        ...(tags ? { tags: dedupe(tags) } : {}),
      },
    });
    return res.json({ data: updated });
  })
);

/** DELETE /api/v1/question-bank/:id */
router.delete(
  '/question-bank/:id',
  route('Failed to delete question', async (req, res) => {
    assertAuthor(req);
    const item = await loadVisible(req, idSchema.parse(req.params.id));
    if (!canModify(req, item)) throw new HttpError(403, 'Forbidden: only the author or an administrator can delete this question');
    await prisma.questionBankItem.delete({ where: { id: item.id } });
    return res.status(204).end();
  })
);

/** POST /api/v1/quizzes/:quizId/questions/from-bank {itemIds}: copies items into the quiz. */
router.post(
  '/quizzes/:quizId/questions/from-bank',
  route('Failed to add questions from the bank', async (req, res) => {
    assertAuthor(req);
    const tenantId = tenantIdOf(req);
    const quiz = await prisma.quiz.findFirst({
      where: { id: idSchema.parse(req.params.quizId), tenantId },
      select: { id: true, courseId: true, questions: { select: { orderIndex: true } } },
    });
    if (!quiz) throw new HttpError(404, 'Quiz not found');
    await requireCourseEditor(req, quiz.courseId);

    const { itemIds } = parseBody(req, fromBankSchema);
    const unique = [...new Set(itemIds)];
    const items = await prisma.questionBankItem.findMany({ where: { id: { in: unique }, ...(await visibleWhere(req)) } });
    if (items.length !== unique.length) throw new HttpError(404, 'One or more questions were not found');

    // Items keep the order the caller asked for.
    const ordered = unique.map((id) => items.find((i) => i.id === id)!);
    let next = quiz.questions.reduce((m, q) => Math.max(m, q.orderIndex + 1), 0);
    const created = [];
    for (const i of ordered) {
      created.push(
        await prisma.quizQuestion.create({
          data: {
            quizId: quiz.id,
            questionText: i.questionText,
            questionType: i.questionType,
            points: i.points,
            orderIndex: next++,
            // Fresh option ids so a copy never shares ids with its bank original.
            optionsJson: i.optionsJson ? ((i.optionsJson as any[]).map((o) => ({ ...o, id: randomUUID() })) as any) : undefined,
            correctAnswer: i.correctAnswer,
            explanation: i.explanation,
            bloomLevel: i.bloomLevel,
          },
        })
      );
    }
    await logAuditEvent({
      tenantId,
      userId: req.user!.id,
      action: 'QUIZ_QUESTIONS_ADDED_FROM_BANK',
      resourceType: 'QUIZ',
      resourceId: quiz.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { count: created.length },
    });
    return res.status(201).json({ data: created });
  })
);

export default router;
