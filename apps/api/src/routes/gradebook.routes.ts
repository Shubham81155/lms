import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';
import { HttpError, route } from '../lib/http';
import { idSchema, parseBody } from '../lib/validate';
import { isAdminRole, requireContentAccess, requireCourseEditor, requireCourseStaff } from '../lib/access';
import { notify } from '../lib/notify';
import { autoComplete } from '../lib/completion';
import { csvRow } from '../lib/csv';
import { CurveMethod, ItemScore, applyCurve, computeRawGrade, letterFor, weightsValid } from '../lib/gradebook';

// Mounted at /api/v1. Grade flow: staff configure categories, items and a curve -> calculate
// (DRAFT) -> an editor submits for review (SUBMITTED) -> an administrator who did not submit
// approves (APPROVED), which writes Enrollment.finalGrade and releases the grade to the learner.

const router = Router();
router.use(['/courses/:courseId/gradebook'], authenticateJWT);

const ACTIVE = ['ENROLLED', 'IN_PROGRESS', 'COMPLETED'] as const;

export const categoriesSchema = z.object({
  categories: z
    .array(z.object({ name: z.string().trim().min(1).max(80), weightPercent: z.number().min(0.01).max(100) }))
    .min(1)
    .max(20),
});
export const itemsSchema = z.object({
  items: z
    .array(z.object({ type: z.enum(['QUIZ', 'ASSIGNMENT']), id: idSchema, categoryId: idSchema.nullable() }))
    .min(1)
    .max(500),
});
export const curveSchema = z
  .object({ method: z.enum(['NONE', 'ADD_POINTS', 'SCALE_TO_MAX']), value: z.number().min(0).max(50).default(0) })
  .refine((c) => c.method !== 'ADD_POINTS' || c.value > 0, { message: 'ADD_POINTS needs a positive value' });
export const submitSchema = z.object({ allowIncomplete: z.boolean().default(false) });
export const rejectSchema = z.object({ note: z.string().trim().min(3).max(1000) });

const audit = (req: Request, action: string, courseId: string, diffJson?: unknown) =>
  logAuditEvent({
    tenantId: tenantIdOf(req),
    userId: req.user!.id,
    action,
    resourceType: 'GRADEBOOK',
    resourceId: courseId,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    diffJson,
  });

/** GET /courses/:courseId/gradebook/config */
router.get(
  '/courses/:courseId/gradebook/config',
  route('Failed to load gradebook configuration', async (req, res) => {
    const access = await requireCourseStaff(req, idSchema.parse(req.params.courseId));
    const [course, categories, quizzes, assignments] = await Promise.all([
      prisma.course.findUnique({ where: { id: access.course.id }, select: { gradeCurveMethod: true, gradeCurveValue: true } }),
      prisma.gradeCategory.findMany({ where: { courseId: access.course.id }, orderBy: { orderIndex: 'asc' } }),
      prisma.quiz.findMany({ where: { courseId: access.course.id }, select: { id: true, title: true, gradeCategoryId: true } }),
      prisma.assignment.findMany({ where: { courseId: access.course.id }, select: { id: true, title: true, gradeCategoryId: true } }),
    ]);
    return res.json({
      data: {
        curve: { method: course?.gradeCurveMethod, value: course?.gradeCurveValue },
        categories,
        items: [...quizzes.map((q) => ({ type: 'QUIZ', ...q })), ...assignments.map((a) => ({ type: 'ASSIGNMENT', ...a }))],
      },
    });
  })
);

/** PUT /courses/:courseId/gradebook/categories: replaces the set; weights must total 100. */
router.put(
  '/courses/:courseId/gradebook/categories',
  route('Failed to save grade categories', async (req, res) => {
    const access = await requireCourseEditor(req, idSchema.parse(req.params.courseId));
    const { categories } = parseBody(req, categoriesSchema);
    if (!weightsValid(categories.map((c) => c.weightPercent))) throw new HttpError(400, 'Category weights must total 100');
    const names = categories.map((c) => c.name.toLowerCase());
    if (new Set(names).size !== names.length) throw new HttpError(400, 'Category names must be unique');

    const tenantId = tenantIdOf(req);
    const existing = await prisma.gradeCategory.findMany({ where: { courseId: access.course.id } });
    const keep = new Set<string>();
    // Matching by name keeps the quizzes and assignments already assigned to a category.
    for (const [i, c] of categories.entries()) {
      const match = existing.find((e) => e.name.toLowerCase() === c.name.toLowerCase());
      if (match) {
        keep.add(match.id);
        await prisma.gradeCategory.update({
          where: { id: match.id },
          data: { name: c.name, weightPercent: c.weightPercent, orderIndex: i },
        });
      } else {
        await prisma.gradeCategory.create({
          data: { tenantId, courseId: access.course.id, name: c.name, weightPercent: c.weightPercent, orderIndex: i },
        });
      }
    }
    const drop = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (drop.length) await prisma.gradeCategory.deleteMany({ where: { id: { in: drop } } }); // items fall back to uncategorised
    await audit(req, 'GRADEBOOK_CATEGORIES_UPDATED', access.course.id, { categories });
    return res.json({
      data: await prisma.gradeCategory.findMany({ where: { courseId: access.course.id }, orderBy: { orderIndex: 'asc' } }),
    });
  })
);

/** PUT /courses/:courseId/gradebook/items: assigns quizzes and assignments to categories. */
router.put(
  '/courses/:courseId/gradebook/items',
  route('Failed to assign grade items', async (req, res) => {
    const access = await requireCourseEditor(req, idSchema.parse(req.params.courseId));
    const { items } = parseBody(req, itemsSchema);
    const categories = await prisma.gradeCategory.findMany({ where: { courseId: access.course.id }, select: { id: true } });
    const categoryIds = new Set(categories.map((c) => c.id));
    for (const i of items) {
      if (i.categoryId && !categoryIds.has(i.categoryId)) throw new HttpError(400, `Category ${i.categoryId} is not part of this course`);
      const found =
        i.type === 'QUIZ'
          ? await prisma.quiz.findFirst({ where: { id: i.id, courseId: access.course.id }, select: { id: true } })
          : await prisma.assignment.findFirst({ where: { id: i.id, courseId: access.course.id }, select: { id: true } });
      if (!found) throw new HttpError(400, `${i.type} ${i.id} does not belong to this course`);
    }
    for (const i of items) {
      if (i.type === 'QUIZ') await prisma.quiz.update({ where: { id: i.id }, data: { gradeCategoryId: i.categoryId } });
      else await prisma.assignment.update({ where: { id: i.id }, data: { gradeCategoryId: i.categoryId } });
    }
    await audit(req, 'GRADEBOOK_ITEMS_UPDATED', access.course.id, { count: items.length });
    return res.json({ data: { updated: items.length } });
  })
);

/** PUT /courses/:courseId/gradebook/curve */
router.put(
  '/courses/:courseId/gradebook/curve',
  route('Failed to save curve', async (req, res) => {
    const access = await requireCourseEditor(req, idSchema.parse(req.params.courseId));
    const { method, value } = parseBody(req, curveSchema);
    await prisma.course.update({
      where: { id: access.course.id },
      data: { gradeCurveMethod: method, gradeCurveValue: method === 'NONE' ? 0 : value },
    });
    await audit(req, 'GRADEBOOK_CURVE_UPDATED', access.course.id, { method, value });
    return res.json({ data: { method, value: method === 'NONE' ? 0 : value } });
  })
);

/**
 * Scores of the given learners for the course's quizzes and assignments: by default only the categorised
 * ones (what the course grade counts); with `all`, every quiz that has questions and every assignment.
 */
async function scoreItems(courseId: string, learnerIds: string[], all = false) {
  const [quizzes, assignments] = await Promise.all([
    prisma.quiz.findMany({
      where: { courseId, ...(all ? { questions: { some: {} } } : { gradeCategoryId: { not: null } }) },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        gradeCategoryId: true,
        submissions: {
          where: { submittedAt: { not: null }, userId: { in: learnerIds } },
          select: { userId: true, score: true, maxScore: true, answersJson: true },
        },
      },
    }),
    prisma.assignment.findMany({
      where: { courseId, ...(all ? {} : { gradeCategoryId: { not: null } }) },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        maxPoints: true,
        gradeCategoryId: true,
        submissions: { where: { userId: { in: learnerIds } }, select: { userId: true, grade: true } },
      },
    }),
  ]);

  const byUser = new Map<string, ItemScore[]>(learnerIds.map((id) => [id, []]));
  for (const q of quizzes) {
    for (const userId of learnerIds) {
      const attempts = q.submissions.filter((s) => s.userId === userId);
      const finished = attempts.filter(
        (s) => ((s.answersJson as any)?.pendingManual ?? []).length === 0 && s.score !== null && s.maxScore > 0
      );
      const best = finished.length ? Math.max(...finished.map((s) => ((s.score as number) / s.maxScore) * 100)) : null;
      byUser.get(userId)!.push({
        itemId: q.id,
        type: 'QUIZ',
        title: q.title,
        categoryId: q.gradeCategoryId,
        percent: best !== null ? best : attempts.length ? null : 0,
        pending: best === null && attempts.length > 0,
        missing: attempts.length === 0,
      });
    }
  }
  for (const a of assignments) {
    for (const userId of learnerIds) {
      const sub = a.submissions.find((s) => s.userId === userId);
      const graded = sub && sub.grade !== null;
      byUser.get(userId)!.push({
        itemId: a.id,
        type: 'ASSIGNMENT',
        title: a.title,
        categoryId: a.gradeCategoryId,
        percent: graded ? Math.min(100, ((sub!.grade as number) / a.maxPoints) * 100) : sub ? null : 0,
        pending: !!sub && !graded,
        missing: !sub,
      });
    }
  }
  return byUser;
}

/** Every learner against every quiz and assignment, with their course grade: the gradebook grid. */
async function gradeGrid(courseId: string) {
  const enrollments = await prisma.enrollment.findMany({
    where: { courseId, status: { in: [...ACTIVE] } },
    select: { userId: true, user: { select: { firstName: true, lastName: true, email: true } } },
    orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
  });
  const learnerIds = enrollments.map((e) => e.userId);
  const [scores, grades, categories] = await Promise.all([
    scoreItems(courseId, learnerIds, true),
    prisma.courseGrade.findMany({
      where: { courseId },
      select: { userId: true, rawPercent: true, curvedPercent: true, letter: true, status: true },
    }),
    prisma.gradeCategory.findMany({ where: { courseId }, select: { id: true, name: true } }),
  ]);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const first = learnerIds.length ? scores.get(learnerIds[0])! : [];
  const gradeOf = new Map(grades.map((g) => [g.userId, g]));
  return {
    items: first.map((i) => ({
      id: i.itemId,
      type: i.type,
      title: i.title,
      category: i.categoryId ? (categoryName.get(i.categoryId) ?? null) : null,
    })),
    learners: enrollments.map((e) => {
      const g = gradeOf.get(e.userId);
      return {
        userId: e.userId,
        name: `${e.user.firstName} ${e.user.lastName}`,
        email: e.user.email,
        scores: Object.fromEntries(
          scores
            .get(e.userId)!
            .map((i) => [
              i.itemId,
              { percent: i.percent === null ? null : Math.round(i.percent * 10) / 10, pending: i.pending, missing: i.missing },
            ])
        ),
        courseGrade: g ? { rawPercent: g.rawPercent, curvedPercent: g.curvedPercent, letter: g.letter, status: g.status } : null,
      };
    }),
  };
}

/** GET /courses/:courseId/gradebook/grid: course staff see every learner's score on every item. */
router.get(
  '/courses/:courseId/gradebook/grid',
  route('Failed to load the grade grid', async (req, res) => {
    const access = await requireCourseStaff(req, idSchema.parse(req.params.courseId));
    return res.json({ data: await gradeGrid(access.course.id) });
  })
);

/**
 * GET /courses/:courseId/gradebook/export.csv: the grid as CSV (one row per learner, a percentage column per
 * item, then the course grade). Audited, since it is a bulk export of student records.
 */
router.get(
  '/courses/:courseId/gradebook/export.csv',
  route('Failed to export grades', async (req, res) => {
    const access = await requireCourseStaff(req, idSchema.parse(req.params.courseId));
    const course = await prisma.course.findUnique({ where: { id: access.course.id }, select: { code: true } });
    const grid = await gradeGrid(access.course.id);
    await audit(req, 'GRADES_EXPORTED', access.course.id, { learners: grid.learners.length, items: grid.items.length });

    const cell = (sc: { percent: number | null; pending: boolean; missing: boolean } | undefined) =>
      !sc ? '' : sc.pending ? 'pending' : sc.missing ? 'missing' : sc.percent;
    let csv =
      '\uFEFF' +
      csvRow(['name', 'email', ...grid.items.map((i) => `${i.title} (%)`), 'course_raw_%', 'course_curved_%', 'letter', 'grade_status']);
    for (const l of grid.learners) {
      csv += csvRow([
        l.name,
        l.email,
        ...grid.items.map((i) => cell(l.scores[i.id])),
        l.courseGrade?.rawPercent ?? '',
        l.courseGrade?.curvedPercent ?? '',
        l.courseGrade?.letter ?? '',
        l.courseGrade?.status ?? '',
      ]);
    }
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="grades-${(course?.code ?? 'course').replace(/[^\w.-]+/g, '_')}.csv"`);
    return res.send(csv);
  })
);

/**
 * POST /courses/:courseId/gradebook/calculate
 * (Re)computes DRAFT grades for every active learner. APPROVED grades are never overwritten; an
 * administrator must reopen them first. SUBMITTED grades go back to DRAFT because inputs changed.
 */
router.post(
  '/courses/:courseId/gradebook/calculate',
  route('Failed to calculate grades', async (req, res) => {
    const access = await requireCourseEditor(req, idSchema.parse(req.params.courseId));
    const tenantId = tenantIdOf(req);
    const courseId = access.course.id;

    const [course, categories, enrollments, existing] = await Promise.all([
      prisma.course.findUnique({ where: { id: courseId }, select: { gradeCurveMethod: true, gradeCurveValue: true } }),
      prisma.gradeCategory.findMany({ where: { courseId }, orderBy: { orderIndex: 'asc' } }),
      prisma.enrollment.findMany({ where: { courseId, status: { in: [...ACTIVE] } }, select: { userId: true } }),
      prisma.courseGrade.findMany({ where: { courseId }, select: { userId: true, status: true } }),
    ]);
    if (!weightsValid(categories.map((c) => c.weightPercent)))
      throw new HttpError(409, 'Configure grade categories (weights totalling 100) first');

    const learnerIds = enrollments.map((e) => e.userId);
    const scores = await scoreItems(courseId, learnerIds);
    const raws = learnerIds.map((id) => computeRawGrade(categories, scores.get(id)!));
    const curved = applyCurve(
      raws.map((r) => r.rawPercent),
      (course?.gradeCurveMethod ?? 'NONE') as CurveMethod,
      course?.gradeCurveValue ?? 0
    );
    const locked = new Set(existing.filter((e) => e.status === 'APPROVED').map((e) => e.userId));

    let written = 0;
    for (const [i, userId] of learnerIds.entries()) {
      if (locked.has(userId)) continue;
      const data = {
        rawPercent: raws[i].rawPercent,
        curvedPercent: curved[i],
        letter: letterFor(curved[i]),
        incomplete: raws[i].incomplete,
        breakdownJson: { categories: raws[i].categories, items: scores.get(userId)! } as any,
        status: 'DRAFT',
        submittedById: null,
        decisionNote: null,
      };
      await prisma.courseGrade.upsert({
        where: { courseId_userId: { courseId, userId } },
        create: { tenantId, courseId, userId, ...data },
        update: data,
      });
      written++;
    }
    await audit(req, 'GRADEBOOK_CALCULATED', courseId, { learners: learnerIds.length, written, skippedApproved: locked.size });
    return res.json({ data: { learners: learnerIds.length, calculated: written, skippedApproved: locked.size } });
  })
);

/** GET /courses/:courseId/gradebook: staff see everyone; learners see their own once approved. */
router.get(
  '/courses/:courseId/gradebook',
  route('Failed to load gradebook', async (req, res) => {
    const access = await requireContentAccess(req, idSchema.parse(req.params.courseId));
    const user = req.user!;

    if (!access.isStaff && user.role !== 'AUDITOR' && !isAdminRole(user.role)) {
      const mine = await prisma.courseGrade.findUnique({ where: { courseId_userId: { courseId: access.course.id, userId: user.id } } });
      if (!mine || mine.status !== 'APPROVED') return res.json({ data: null, published: false });
      return res.json({
        published: true,
        data: {
          rawPercent: mine.rawPercent,
          curvedPercent: mine.curvedPercent,
          letter: mine.letter,
          breakdown: mine.breakdownJson,
          approvedAt: mine.approvedAt,
        },
      });
    }

    const rows = await prisma.courseGrade.findMany({
      where: { courseId: access.course.id },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      orderBy: { curvedPercent: 'desc' },
    });
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    return res.json({
      data: rows.map((r) => ({
        userId: r.userId,
        name: `${r.user.firstName} ${r.user.lastName}`,
        email: r.user.email,
        rawPercent: r.rawPercent,
        curvedPercent: r.curvedPercent,
        letter: r.letter,
        incomplete: r.incomplete,
        status: r.status,
        breakdown: r.breakdownJson,
        decisionNote: r.decisionNote,
      })),
      summary: {
        total: rows.length,
        draft: count('DRAFT'),
        submitted: count('SUBMITTED'),
        approved: count('APPROVED'),
        incomplete: rows.filter((r) => r.incomplete).length,
        average: rows.length ? Math.round((rows.reduce((s, r) => s + r.curvedPercent, 0) / rows.length) * 100) / 100 : null,
      },
    });
  })
);

/** POST /courses/:courseId/gradebook/submit: DRAFT -> SUBMITTED, for an administrator to approve. */
router.post(
  '/courses/:courseId/gradebook/submit',
  route('Failed to submit grades', async (req, res) => {
    const access = await requireCourseEditor(req, idSchema.parse(req.params.courseId));
    const { allowIncomplete } = parseBody(req, submitSchema);
    const drafts = await prisma.courseGrade.findMany({
      where: { courseId: access.course.id, status: 'DRAFT' },
      select: { id: true, incomplete: true },
    });
    if (drafts.length === 0) throw new HttpError(409, 'There are no draft grades to submit; calculate first');
    const incomplete = drafts.filter((d) => d.incomplete).length;
    if (incomplete > 0 && !allowIncomplete) {
      throw new HttpError(
        409,
        `${incomplete} grade(s) still have work waiting for a grader. Finish grading or submit with allowIncomplete.`
      );
    }
    await prisma.courseGrade.updateMany({
      where: { id: { in: drafts.map((d) => d.id) } },
      data: { status: 'SUBMITTED', submittedById: req.user!.id, decisionNote: null },
    });

    const admins = await prisma.user.findMany({
      where: { tenantId: tenantIdOf(req), role: { in: ['TENANT_ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE', NOT: { id: req.user!.id } },
      select: { id: true },
    });
    await Promise.all(
      admins.map((a) =>
        notify({
          tenantId: tenantIdOf(req),
          userId: a.id,
          category: 'GRADE',
          title: 'Final grades awaiting approval',
          body: `${drafts.length} grade(s) were submitted for review.`,
          link: `/courses/${access.course.id}/gradebook`,
        })
      )
    );
    await audit(req, 'GRADEBOOK_SUBMITTED', access.course.id, { count: drafts.length, incomplete });
    return res.json({ data: { submitted: drafts.length, incomplete } });
  })
);

const adminOnly = (req: Request) => {
  if (!isAdminRole(req.user!.role)) throw new HttpError(403, 'Forbidden: only administrators can approve, reject or reopen grades');
};

/**
 * POST /courses/:courseId/gradebook/approve
 * An administrator other than the submitter releases the grades: writes Enrollment.finalGrade and
 * notifies each learner. Two-person rule: you cannot approve what you submitted.
 */
router.post(
  '/courses/:courseId/gradebook/approve',
  route('Failed to approve grades', async (req, res) => {
    adminOnly(req);
    const courseId = idSchema.parse(req.params.courseId);
    const access = await requireCourseStaff(req, courseId);
    const tenantId = tenantIdOf(req);
    const submitted = await prisma.courseGrade.findMany({ where: { courseId: access.course.id, status: 'SUBMITTED' } });
    if (submitted.length === 0) throw new HttpError(409, 'There are no submitted grades to approve');
    if (submitted.some((g) => g.submittedById === req.user!.id)) {
      throw new HttpError(403, 'Forbidden: grades you submitted must be approved by a different administrator');
    }
    const now = new Date();
    for (const g of submitted) {
      await prisma.courseGrade.update({ where: { id: g.id }, data: { status: 'APPROVED', approvedById: req.user!.id, approvedAt: now } });
      await prisma.enrollment.updateMany({
        where: { courseId: access.course.id, userId: g.userId },
        data: { finalGrade: g.curvedPercent },
      });
    }
    await Promise.all(
      submitted.map((g) =>
        notify({
          tenantId,
          userId: g.userId,
          category: 'GRADE',
          title: 'Your final grade is available',
          body: `Final grade: ${g.curvedPercent}% (${g.letter})`,
          link: `/courses/${access.course.id}/gradebook`,
        })
      )
    );
    // Learners who have also finished every lesson and pass complete the course now.
    let completed = 0;
    for (const g of submitted) if ((await autoComplete(access.course.id, g.userId)) === 'COMPLETED') completed++;
    await audit(req, 'GRADEBOOK_APPROVED', access.course.id, { count: submitted.length, completed });
    return res.json({ data: { approved: submitted.length, completed } });
  })
);

/** POST /courses/:courseId/gradebook/reject {note}: SUBMITTED -> DRAFT, telling the submitter why. */
router.post(
  '/courses/:courseId/gradebook/reject',
  route('Failed to reject grades', async (req, res) => {
    adminOnly(req);
    const access = await requireCourseStaff(req, idSchema.parse(req.params.courseId));
    const { note } = parseBody(req, rejectSchema);
    const submitted = await prisma.courseGrade.findMany({
      where: { courseId: access.course.id, status: 'SUBMITTED' },
      select: { id: true, submittedById: true },
    });
    if (submitted.length === 0) throw new HttpError(409, 'There are no submitted grades to reject');
    await prisma.courseGrade.updateMany({
      where: { id: { in: submitted.map((s) => s.id) } },
      data: { status: 'DRAFT', decisionNote: note },
    });
    const submitters = [...new Set(submitted.map((s) => s.submittedById).filter((x): x is string => !!x))];
    await Promise.all(
      submitters.map((userId) =>
        notify({
          tenantId: tenantIdOf(req),
          userId,
          category: 'GRADE',
          title: 'Final grades were sent back',
          body: note,
          link: `/courses/${access.course.id}/gradebook`,
        })
      )
    );
    await audit(req, 'GRADEBOOK_REJECTED', access.course.id, { count: submitted.length, note });
    return res.json({ data: { returned: submitted.length } });
  })
);

/** POST /courses/:courseId/gradebook/reopen: APPROVED -> DRAFT, so grades can be corrected. */
router.post(
  '/courses/:courseId/gradebook/reopen',
  route('Failed to reopen grades', async (req, res) => {
    adminOnly(req);
    const access = await requireCourseStaff(req, idSchema.parse(req.params.courseId));
    const r = await prisma.courseGrade.updateMany({
      where: { courseId: access.course.id, status: 'APPROVED' },
      data: { status: 'DRAFT', approvedById: null, approvedAt: null, submittedById: null },
    });
    if (r.count === 0) throw new HttpError(409, 'There are no approved grades to reopen');
    await audit(req, 'GRADEBOOK_REOPENED', access.course.id, { count: r.count });
    return res.json({ data: { reopened: r.count } });
  })
);

export default router;
