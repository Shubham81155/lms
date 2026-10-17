import { randomUUID } from 'crypto';
import { CourseStatus, Prisma } from '@enterprise-lms/database';
import { prisma, runInTenantTransaction } from './prisma';
import { HttpError } from './http';
import { copyStored, newStorageKey, storage } from './storage';
import { fileLink } from './stored-files';
import { logger } from './logger';

const DAY = 86_400_000;
const UPLOAD = /^\/api\/v1\/files\/([0-9a-f-]{36})$/i;

export interface CopyOptions {
  code: string;
  title?: string;
  /** undefined: the source course's term. */
  termId?: string | null;
  shiftDays?: number;
}

/**
 * Copies a course's teaching material into a new DRAFT course: settings, modules and lessons, quizzes and
 * their questions, assignments (rubrics included), grade categories and the curve, and the course's own
 * question-bank items. Due dates and quiz windows move by `shiftDays`. Uploaded lesson files are duplicated,
 * so each course owns its copy. People and their work (enrollments, submissions, grades, extensions,
 * progress, forum, announcements, live classes) are not copied.
 */
export async function copyCourse(sourceId: string, opts: CopyOptions, actor: { id: string; role: string; tenantId: string }) {
  const tenantId = actor.tenantId;
  const source = await prisma.course.findFirst({
    where: { id: sourceId, tenantId },
    include: {
      term: { select: { startsOn: true } },
      instructors: { select: { userId: true, isPrimary: true } },
      modules: { orderBy: { orderIndex: 'asc' }, include: { lessons: { orderBy: { orderIndex: 'asc' } } } },
      gradeCategories: true,
      quizzes: { include: { questions: true } },
      assignments: true,
    },
  });
  if (!source) throw new HttpError(404, 'Course not found');
  if (await prisma.course.findFirst({ where: { tenantId, code: opts.code }, select: { id: true } })) {
    throw new HttpError(409, 'A course with that code already exists');
  }

  const termId = opts.termId === undefined ? source.termId : opts.termId;
  const target = termId ? await prisma.term.findFirst({ where: { id: termId, tenantId }, select: { startsOn: true } }) : null;
  if (termId && !target) throw new HttpError(400, 'Term not found');
  const shiftDays =
    opts.shiftDays ?? (source.term && target ? Math.round((target.startsOn.getTime() - source.term.startsOn.getTime()) / DAY) : 0);
  const shift = (d: Date | null) => (d ? new Date(d.getTime() + shiftDays * DAY) : null);

  const bank = await prisma.questionBankItem.findMany({ where: { tenantId, courseId: source.id } });

  // Uploaded lesson files: duplicate the bytes first (slow, outside the transaction); undone on failure.
  const fileIds = [...new Set(source.modules.flatMap((m) => m.lessons).map((l) => (l.mediaUrl ? UPLOAD.exec(l.mediaUrl)?.[1] : undefined)).filter((x): x is string => !!x))];
  const files = await prisma.storedFile.findMany({ where: { id: { in: fileIds }, tenantId, courseId: source.id, purpose: 'LESSON_MEDIA' } });
  const copiedFiles: { oldId: string; newId: string; key: string; file: (typeof files)[number] }[] = [];
  try {
    for (const f of files) {
      const key = newStorageKey(tenantId);
      await copyStored(f.storageKey, key, f.contentType);
      copiedFiles.push({ oldId: f.id, newId: randomUUID(), key, file: f });
    }
  } catch (e) {
    await undoFiles(copiedFiles.map((c) => c.key));
    throw e;
  }
  const newFileId = new Map(copiedFiles.map((c) => [c.oldId, c.newId]));
  const relink = (url: string | null) => {
    const id = url ? UPLOAD.exec(url)?.[1] : undefined;
    return id && newFileId.has(id) ? fileLink(newFileId.get(id)!) : url;
  };

  const instructors =
    actor.role === 'INSTRUCTOR'
      ? [{ userId: actor.id, isPrimary: true }, ...source.instructors.filter((i) => i.userId !== actor.id).map((i) => ({ userId: i.userId, isPrimary: false }))]
      : source.instructors;

  try {
    const result = await runInTenantTransaction(
      tenantId,
      async (tx) => {
        const course = await tx.course.create({
          data: {
            tenantId,
            code: opts.code,
            title: opts.title ?? source.title,
            description: source.description,
            syllabus: source.syllabus,
            thumbnailUrl: source.thumbnailUrl,
            departmentId: source.departmentId,
            termId,
            passingGradePercent: source.passingGradePercent,
            allowSelfEnroll: source.allowSelfEnroll,
            gradeCurveMethod: source.gradeCurveMethod,
            gradeCurveValue: source.gradeCurveValue,
            status: CourseStatus.DRAFT,
            instructors: { create: instructors },
          },
        });

        for (const c of copiedFiles) {
          await tx.storedFile.create({
            data: {
              id: c.newId, tenantId, ownerId: actor.id, courseId: course.id, purpose: 'LESSON_MEDIA', storageKey: c.key,
              filename: c.file.filename, contentType: c.file.contentType, sizeBytes: c.file.sizeBytes, sha256: c.file.sha256,
            },
          });
        }

        const category = new Map<string, string>();
        for (const g of source.gradeCategories) {
          const created = await tx.gradeCategory.create({ data: { tenantId, courseId: course.id, name: g.name, weightPercent: g.weightPercent, orderIndex: g.orderIndex } });
          category.set(g.id, created.id);
        }
        const mapCategory = (id: string | null) => (id ? category.get(id) ?? null : null);

        let lessons = 0;
        for (const m of source.modules) {
          await tx.module.create({
            data: {
              courseId: course.id,
              title: m.title,
              orderIndex: m.orderIndex,
              isLocked: m.isLocked,
              lessons: {
                create: m.lessons.map((l) => ({
                  title: l.title,
                  orderIndex: l.orderIndex,
                  contentType: l.contentType,
                  bodyContent: l.bodyContent,
                  mediaUrl: relink(l.mediaUrl),
                  scormPackageId: l.scormPackageId,
                  ltiToolLaunchUrl: l.ltiToolLaunchUrl,
                  estimatedMinutes: l.estimatedMinutes,
                })),
              },
            },
          });
          lessons += m.lessons.length;
        }

        let questions = 0;
        for (const q of source.quizzes) {
          await tx.quiz.create({
            data: {
              tenantId,
              courseId: course.id,
              title: q.title,
              timeLimitMins: q.timeLimitMins,
              maxAttempts: q.maxAttempts,
              randomizeQuestions: q.randomizeQuestions,
              requireProctoring: q.requireProctoring,
              passingPercent: q.passingPercent,
              availableFrom: shift(q.availableFrom),
              dueAt: shift(q.dueAt),
              reviewPolicy: q.reviewPolicy,
              gradeCategoryId: mapCategory(q.gradeCategoryId),
              questions: {
                create: q.questions.map((qq) => ({
                  questionText: qq.questionText,
                  questionType: qq.questionType,
                  points: qq.points,
                  orderIndex: qq.orderIndex,
                  optionsJson: qq.optionsJson ?? Prisma.JsonNull,
                  correctAnswer: qq.correctAnswer,
                  explanation: qq.explanation,
                  bloomLevel: qq.bloomLevel,
                })),
              },
            },
          });
          questions += q.questions.length;
        }

        for (const a of source.assignments) {
          await tx.assignment.create({
            data: {
              tenantId,
              courseId: course.id,
              title: a.title,
              instructions: a.instructions,
              maxPoints: a.maxPoints,
              dueDate: shift(a.dueDate),
              acceptLateUntil: shift(a.acceptLateUntil),
              gradeCategoryId: mapCategory(a.gradeCategoryId),
              rubricJson: a.rubricJson ?? Prisma.JsonNull,
            },
          });
        }

        for (const b of bank) {
          await tx.questionBankItem.create({
            data: {
              tenantId, courseId: course.id, ownerId: actor.id, questionText: b.questionText, questionType: b.questionType, points: b.points,
              optionsJson: b.optionsJson ?? Prisma.JsonNull, correctAnswer: b.correctAnswer, explanation: b.explanation, tags: b.tags, bloomLevel: b.bloomLevel,
            },
          });
        }

        return {
          course: { id: course.id, code: course.code, title: course.title, status: course.status, termId: course.termId },
          shiftDays,
          copied: {
            modules: source.modules.length,
            lessons,
            quizzes: source.quizzes.length,
            questions,
            assignments: source.assignments.length,
            gradeCategories: source.gradeCategories.length,
            questionBankItems: bank.length,
            files: copiedFiles.length,
          },
        };
      },
      { timeout: 60_000, maxWait: 10_000 }
    );
    return result;
  } catch (e) {
    await undoFiles(copiedFiles.map((c) => c.key));
    if ((e as { code?: string })?.code === 'P2002') throw new HttpError(409, 'A course with that code already exists');
    throw e;
  }
}

async function undoFiles(keys: string[]) {
  for (const key of keys) {
    await storage()
      .delete(key)
      .catch((err) => logger.warn({ err, key }, 'Could not remove a file copied for a failed course copy'));
  }
}
