import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';
import { HttpError, route } from '../lib/http';
import { idSchema, parseBody, parseQuery } from '../lib/validate';
import { canSeeAllCourses, isAdminRole, requireCourseEditor } from '../lib/access';
import { personalDue } from '../lib/deadlines';

// Mounted at /api/v1/calendar. Events are stored as UTC instants; `timezone` is the organiser's
// display zone so clients can render them in local time.

const router = Router();
router.use(authenticateJWT);

const CATEGORIES = ['EXAM', 'LAB', 'LECTURE', 'OFFICE_HOURS', 'DEADLINE'] as const;

const tz = z
  .string()
  .max(64)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone');

const eventShape = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  category: z.enum(CATEGORIES),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  timezone: tz.default('UTC'),
  courseId: idSchema.nullable().optional(),
};
export const createSchema = z.object(eventShape).refine((e) => e.endsAt >= e.startsAt, { message: 'endsAt must not be before startsAt' });
export const updateSchema = z
  .object({
    ...eventShape,
    // An event cannot be moved between courses: any value is rejected.
    courseId: z
      .any()
      .refine((v) => v === undefined, 'courseId cannot be changed')
      .optional(),
  })
  .partial()
  .refine((e) => !e.startsAt || !e.endsAt || e.endsAt >= e.startsAt, { message: 'endsAt must not be before startsAt' });

const rangeQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  courseId: idSchema.optional(),
});

/** Course ids whose events the caller may see: enrolled, assigned, or (admin/auditor) all. */
async function visibleCourseIds(req: Request): Promise<string[] | 'ALL'> {
  const user = req.user!;
  if (canSeeAllCourses(user.role)) return 'ALL';
  const [enrolled, taught] = await Promise.all([
    prisma.enrollment.findMany({
      where: { userId: user.id, status: { in: ['ENROLLED', 'IN_PROGRESS', 'COMPLETED'] } },
      select: { courseId: true },
    }),
    prisma.courseInstructor.findMany({ where: { userId: user.id }, select: { courseId: true } }),
  ]);
  return [...new Set([...enrolled, ...taught].map((c) => c.courseId))];
}

async function queryEvents(req: Request) {
  const { from, to, courseId } = parseQuery(req, rangeQuery);
  const visible = await visibleCourseIds(req);
  if (courseId && visible !== 'ALL' && !visible.includes(courseId)) return [];
  const scope = courseId ? { courseId } : visible === 'ALL' ? {} : { OR: [{ courseId: null }, { courseId: { in: visible } }] };
  const tenantId = tenantIdOf(req);
  const [events, due] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: {
        tenantId,
        ...scope,
        ...(from ? { endsAt: { gte: from } } : {}),
        ...(to ? { startsAt: { lte: to } } : {}),
      },
      orderBy: { startsAt: 'asc' },
      take: 500,
    }),
    dueDates(req.user!.id, tenantId, courseId ? [courseId] : visible, from, to),
  ]);
  return [...events.map((e) => ({ ...e, source: 'EVENT' as const, itemId: null, extended: false, completed: false })), ...due]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, 500);
}

/**
 * Quiz and assignment due dates as calendar entries, worked out on every read so they always match the
 * item and the caller's own extension (no stored copy to keep in step). They are read-only: change the
 * quiz or assignment, not the entry. `completed` is the caller's own state (submitted, or attempts used).
 */
async function dueDates(userId: string, tenantId: string, courseIds: string[] | 'ALL', from?: Date, to?: Date) {
  if (courseIds !== 'ALL' && courseIds.length === 0) return [];
  const course = courseIds === 'ALL' ? {} : { courseId: { in: courseIds } };
  const inRange = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  const dated = (field: 'dueAt' | 'dueDate') => [
    { [field]: from || to ? inRange : { not: null } },
    { extensions: { some: { userId, dueAt: inRange } } },
  ];
  const [quizzes, assignments] = await Promise.all([
    prisma.quiz.findMany({
      where: { tenantId, ...course, questions: { some: {} }, OR: dated('dueAt') },
      select: {
        id: true,
        title: true,
        courseId: true,
        dueAt: true,
        maxAttempts: true,
        createdAt: true,
        course: { select: { code: true } },
        extensions: { where: { userId }, select: { dueAt: true } },
        submissions: { where: { userId, submittedAt: { not: null } }, select: { id: true } },
      },
      take: 500,
    }),
    prisma.assignment.findMany({
      where: { tenantId, ...course, OR: dated('dueDate') },
      select: {
        id: true,
        title: true,
        courseId: true,
        dueDate: true,
        createdAt: true,
        course: { select: { code: true } },
        extensions: { where: { userId }, select: { dueAt: true } },
        submissions: { where: { userId }, select: { id: true } },
      },
      take: 500,
    }),
  ]);
  const entry = (
    source: 'QUIZ' | 'ASSIGNMENT',
    item: { id: string; title: string; courseId: string; createdAt: Date; course: { code: string }; extensions: { dueAt: Date }[] },
    courseDue: Date | null,
    completed: boolean
  ) => {
    const at = personalDue(courseDue, item.extensions[0]?.dueAt ?? null);
    if (!at || (from && at < from) || (to && at > to)) return null;
    return {
      id: `${source.toLowerCase()}-${item.id}`,
      tenantId,
      courseId: item.courseId,
      createdById: null,
      title: `${item.course.code}: ${item.title} due`,
      description: null,
      category: source === 'QUIZ' ? 'EXAM' : 'DEADLINE',
      startsAt: at,
      endsAt: at,
      timezone: 'UTC',
      createdAt: item.createdAt,
      source,
      itemId: item.id,
      extended: item.extensions.length > 0 && at.getTime() !== courseDue?.getTime(),
      completed,
    };
  };
  return [
    ...quizzes.map((q) => entry('QUIZ', q, q.dueAt, q.submissions.length >= q.maxAttempts)),
    ...assignments.map((a) => entry('ASSIGNMENT', a, a.dueDate, a.submissions.length > 0)),
  ].filter((e): e is NonNullable<typeof e> => e !== null);
}

/** GET /api/v1/calendar/events?from&to&courseId */
router.get(
  '/events',
  route('Failed to load calendar', async (req, res) => {
    const events = await queryEvents(req);
    const now = Date.now();
    const next = events.find((e) => e.category !== 'LECTURE' && !e.completed && e.startsAt.getTime() >= now) ?? null;
    return res.json({ data: events, nextDeadline: next });
  })
);

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
/** RFC 5545 line folding at 75 octets. */
const fold = (line: string) => {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(` ${line.slice(i, i + 74)}`);
  return parts.join('\r\n');
};

/** GET /api/v1/calendar/export.ics: iCalendar feed of the same events (Google/Outlook/Apple). */
router.get(
  '/export.ics',
  route('Failed to export calendar', async (req, res) => {
    const events = await queryEvents(req);
    const stamp = icsDate(new Date());
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Enterprise LMS//Calendar//EN',
      'CALSCALE:GREGORIAN',
      ...events.flatMap((e) => [
        'BEGIN:VEVENT',
        `UID:${e.id}@enterprise-lms`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsDate(e.startsAt)}`,
        `DTEND:${icsDate(e.endsAt)}`,
        `SUMMARY:${icsEscape(e.title)}`,
        ...(e.description ? [`DESCRIPTION:${icsEscape(e.description)}`] : []),
        `CATEGORIES:${e.category}`,
        'END:VEVENT',
      ]),
      'END:VCALENDAR',
    ];
    res.setHeader('content-type', 'text/calendar; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="lms-calendar.ics"');
    return res.send(lines.map(fold).join('\r\n') + '\r\n');
  })
);

/** POST /api/v1/calendar/events: course editors for their course; admins for any / tenant-wide. */
router.post(
  '/events',
  route('Failed to create event', async (req, res) => {
    const body = parseBody(req, createSchema);
    if (body.courseId) await requireCourseEditor(req, body.courseId);
    else if (!isAdminRole(req.user!.role)) throw new HttpError(403, 'Forbidden: only administrators can create tenant-wide events');

    const event = await prisma.calendarEvent.create({
      data: {
        tenantId: tenantIdOf(req),
        createdById: req.user!.id,
        title: body.title,
        description: body.description ?? null,
        category: body.category,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        timezone: body.timezone,
        courseId: body.courseId ?? null,
      },
    });
    return res.status(201).json({ data: event });
  })
);

async function ownedEvent(req: Request, id: string) {
  const event = await prisma.calendarEvent.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!event) throw new HttpError(404, 'Event not found');
  if (event.courseId) await requireCourseEditor(req, event.courseId);
  else if (!isAdminRole(req.user!.role)) throw new HttpError(403, 'Forbidden: only administrators can change tenant-wide events');
  return event;
}

/** PATCH /api/v1/calendar/events/:id */
router.patch(
  '/events/:id',
  route('Failed to update event', async (req, res) => {
    const event = await ownedEvent(req, idSchema.parse(req.params.id));
    const patch = parseBody(req, updateSchema);
    const startsAt = patch.startsAt ?? event.startsAt;
    const endsAt = patch.endsAt ?? event.endsAt;
    if (endsAt < startsAt) throw new HttpError(400, 'endsAt must not be before startsAt');
    const { courseId: _ignored, ...data } = patch as any;
    const updated = await prisma.calendarEvent.update({ where: { id: event.id }, data });
    return res.json({ data: updated });
  })
);

/** DELETE /api/v1/calendar/events/:id */
router.delete(
  '/events/:id',
  route('Failed to delete event', async (req, res) => {
    const event = await ownedEvent(req, idSchema.parse(req.params.id));
    await prisma.calendarEvent.delete({ where: { id: event.id } });
    return res.status(204).end();
  })
);

export default router;
