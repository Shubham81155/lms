import { randomUUID } from 'crypto';
import { Router, Request } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';
import { HttpError, route } from '../lib/http';
import { idSchema, parseBody } from '../lib/validate';
import { requireContentAccess, requireCourseEditor, requireCourseStaff } from '../lib/access';
import { notify } from '../lib/notify';
import { isPresent, issueJoinToken, liveConfigured, roomNameFor, secondsBetween } from '../lib/livekit';

// Mounted at /api/v1. Live classes: course editors schedule, start and end sessions; enrolled
// learners and course staff join with a signed token that limits what they can do in the room.

const router = Router();
router.use(['/live-sessions', '/courses/:courseId/live-sessions'], authenticateJWT);

const ACTIVE_ENROLLMENT = ['ENROLLED', 'IN_PROGRESS', 'COMPLETED'] as const;
/** A session can be created this far in the past (clock drift, "starting now"). */
const PAST_GRACE_MS = 5 * 60_000;
/** Tokens outlive the scheduled end a little, for a session that overruns. */
const TOKEN_GRACE_SECONDS = 30 * 60;

export const createSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).optional(),
  scheduledAt: z.coerce.date(),
  durationMins: z.number().int().min(5).max(480).default(60),
  allowStudentVideo: z.boolean().default(false),
});
export const updateSchema = createSchema.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to change');

const audit = (req: Request, action: string, id: string, diffJson?: unknown) =>
  logAuditEvent({
    tenantId: tenantIdOf(req),
    userId: req.user!.id,
    action,
    resourceType: 'LIVE_SESSION',
    resourceId: id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    diffJson,
  });

async function enrolledLearnerIds(courseId: string) {
  const rows = await prisma.enrollment.findMany({
    where: { courseId, status: { in: ['ENROLLED', 'IN_PROGRESS'] } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

async function loadSession(req: Request, id: string) {
  const s = await prisma.liveSession.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!s) throw new HttpError(404, 'Live session not found');
  return s;
}

const view = (s: any, extra: object = {}) => ({
  id: s.id,
  courseId: s.courseId,
  title: s.title,
  description: s.description,
  scheduledAt: s.scheduledAt,
  durationMins: s.durationMins,
  status: s.status,
  allowStudentVideo: s.allowStudentVideo,
  startedAt: s.startedAt,
  endedAt: s.endedAt,
  ...extra,
});

/** GET /api/v1/courses/:courseId/live-sessions */
router.get(
  '/courses/:courseId/live-sessions',
  route('Failed to load live sessions', async (req, res) => {
    const access = await requireContentAccess(req, idSchema.parse(req.params.courseId));
    const sessions = await prisma.liveSession.findMany({
      where: { courseId: access.course.id, tenantId: tenantIdOf(req), status: { not: 'CANCELLED' } },
      orderBy: { scheduledAt: 'desc' },
      take: 50,
      include: { attendance: { select: { userId: true, totalSeconds: true } } },
    });
    return res.json({
      configured: liveConfigured(),
      data: sessions.map((s) => {
        const mine = s.attendance.find((a) => a.userId === req.user!.id);
        return view(s, access.isStaff ? { attendeeCount: s.attendance.length } : { attended: !!mine && isPresent(mine.totalSeconds) });
      }),
    });
  })
);

/** POST /api/v1/courses/:courseId/live-sessions: schedules a class and tells the enrolled learners. */
router.post(
  '/courses/:courseId/live-sessions',
  route('Failed to schedule live session', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const access = await requireCourseEditor(req, idSchema.parse(req.params.courseId));
    const body = parseBody(req, createSchema);
    if (body.scheduledAt.getTime() < Date.now() - PAST_GRACE_MS) throw new HttpError(400, 'A live class cannot be scheduled in the past');

    const id = randomUUID();
    const event = await prisma.calendarEvent.create({
      data: {
        tenantId,
        courseId: access.course.id,
        createdById: req.user!.id,
        title: `Live class: ${body.title}`,
        description: body.description ?? null,
        category: 'LECTURE',
        startsAt: body.scheduledAt,
        endsAt: new Date(body.scheduledAt.getTime() + body.durationMins * 60_000),
        timezone: 'UTC',
      },
    });
    const session = await prisma.liveSession.create({
      data: {
        id,
        tenantId,
        courseId: access.course.id,
        createdById: req.user!.id,
        roomName: roomNameFor(tenantId, id),
        calendarEventId: event.id,
        ...body,
      },
    });
    await Promise.all(
      (await enrolledLearnerIds(access.course.id)).map((userId) =>
        notify({
          tenantId,
          userId,
          category: 'LIVE',
          title: `Live class scheduled: ${body.title}`,
          body: `Starts ${body.scheduledAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`,
          link: `/courses/${access.course.id}/live`,
        })
      )
    );
    await audit(req, 'LIVE_SESSION_SCHEDULED', session.id, { courseId: access.course.id, scheduledAt: body.scheduledAt });
    return res.status(201).json({ data: view(session) });
  })
);

/** GET /api/v1/live-sessions/mine: what is live now or coming up in the caller's courses. */
router.get(
  '/live-sessions/mine',
  route('Failed to load live sessions', async (req, res) => {
    const user = req.user!;
    const courseWhere =
      user.role === 'STUDENT' || user.role === 'PARENT_GUARDIAN'
        ? { enrollments: { some: { userId: user.id, status: { in: [...ACTIVE_ENROLLMENT] } } } }
        : user.role === 'INSTRUCTOR' || user.role === 'TEACHING_ASSISTANT'
          ? { instructors: { some: { userId: user.id } } }
          : {};
    const horizon = new Date(Date.now() + 7 * 86_400_000);
    const sessions = await prisma.liveSession.findMany({
      where: {
        tenantId: tenantIdOf(req),
        course: { status: 'PUBLISHED', ...courseWhere },
        OR: [{ status: 'LIVE' }, { status: 'SCHEDULED', scheduledAt: { lte: horizon, gte: new Date(Date.now() - 60 * 60_000) } }],
      },
      orderBy: [{ status: 'asc' }, { scheduledAt: 'asc' }],
      take: 20,
      include: { course: { select: { id: true, code: true, title: true } } },
    });
    // LIVE first, then by start time.
    sessions.sort((a, b) => Number(b.status === 'LIVE') - Number(a.status === 'LIVE') || a.scheduledAt.getTime() - b.scheduledAt.getTime());
    return res.json({ configured: liveConfigured(), data: sessions.map((s) => view(s, { course: s.course })) });
  })
);

/** PATCH /api/v1/live-sessions/:id: reschedule or retitle a class that has not started. */
router.patch(
  '/live-sessions/:id',
  route('Failed to update live session', async (req, res) => {
    const s = await loadSession(req, idSchema.parse(req.params.id));
    await requireCourseEditor(req, s.courseId);
    if (s.status !== 'SCHEDULED') throw new HttpError(409, 'Only a class that has not started can be changed');
    const body = parseBody(req, updateSchema);
    if (body.scheduledAt && body.scheduledAt.getTime() < Date.now() - PAST_GRACE_MS)
      throw new HttpError(400, 'A live class cannot be scheduled in the past');
    const updated = await prisma.liveSession.update({ where: { id: s.id }, data: body });
    if (s.calendarEventId) {
      await prisma.calendarEvent.updateMany({
        where: { id: s.calendarEventId },
        data: {
          title: `Live class: ${updated.title}`,
          description: updated.description,
          startsAt: updated.scheduledAt,
          endsAt: new Date(updated.scheduledAt.getTime() + updated.durationMins * 60_000),
        },
      });
    }
    await audit(req, 'LIVE_SESSION_UPDATED', s.id, body);
    return res.json({ data: view(updated) });
  })
);

/** POST /api/v1/live-sessions/:id/cancel */
router.post(
  '/live-sessions/:id/cancel',
  route('Failed to cancel live session', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const s = await loadSession(req, idSchema.parse(req.params.id));
    await requireCourseEditor(req, s.courseId);
    const claimed = await prisma.liveSession.updateMany({ where: { id: s.id, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });
    if (claimed.count !== 1) throw new HttpError(409, 'Only a class that has not started can be cancelled');
    if (s.calendarEventId) await prisma.calendarEvent.deleteMany({ where: { id: s.calendarEventId } });
    await Promise.all(
      (await enrolledLearnerIds(s.courseId)).map((userId) =>
        notify({ tenantId, userId, category: 'LIVE', title: `Live class cancelled: ${s.title}`, link: `/courses/${s.courseId}/live` })
      )
    );
    await audit(req, 'LIVE_SESSION_CANCELLED', s.id);
    return res.json({ data: { id: s.id, status: 'CANCELLED' } });
  })
);

/** POST /api/v1/live-sessions/:id/start: opens the room to learners and tells them it is live. */
router.post(
  '/live-sessions/:id/start',
  route('Failed to start live session', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const s = await loadSession(req, idSchema.parse(req.params.id));
    await requireCourseEditor(req, s.courseId);
    if (!liveConfigured()) throw new HttpError(503, 'Live classes are not configured on this server');
    if (s.status === 'LIVE') return res.json({ data: view(s) }); // already live: idempotent
    const claimed = await prisma.liveSession.updateMany({
      where: { id: s.id, status: 'SCHEDULED' },
      data: { status: 'LIVE', startedAt: new Date() },
    });
    if (claimed.count !== 1) {
      // Lost a race with another start (a double click): if it is live now, that is the outcome asked for.
      const current = await loadSession(req, s.id);
      if (current.status === 'LIVE') return res.json({ data: view(current) });
      throw new HttpError(409, 'This class has already ended or been cancelled');
    }
    await Promise.all(
      (await enrolledLearnerIds(s.courseId)).map((userId) =>
        notify({
          tenantId,
          userId,
          category: 'LIVE',
          title: `Live now: ${s.title}`,
          body: 'Join from your dashboard.',
          link: `/courses/${s.courseId}/live`,
        })
      )
    );
    await audit(req, 'LIVE_SESSION_STARTED', s.id);
    return res.json({ data: view(await loadSession(req, s.id)) });
  })
);

/** Closes every open attendance record at `at`, adding the time spent in the room. */
export async function closeOpenAttendance(sessionId: string, at: Date) {
  const open = await prisma.liveAttendance.findMany({ where: { sessionId, activeSince: { not: null } } });
  for (const a of open) {
    await prisma.liveAttendance.updateMany({
      where: { id: a.id, activeSince: { not: null } },
      data: { totalSeconds: a.totalSeconds + secondsBetween(a.activeSince!, at), activeSince: null },
    });
  }
}

/** POST /api/v1/live-sessions/:id/end */
router.post(
  '/live-sessions/:id/end',
  route('Failed to end live session', async (req, res) => {
    const s = await loadSession(req, idSchema.parse(req.params.id));
    await requireCourseEditor(req, s.courseId);
    const now = new Date();
    const claimed = await prisma.liveSession.updateMany({ where: { id: s.id, status: 'LIVE' }, data: { status: 'ENDED', endedAt: now } });
    if (claimed.count !== 1) throw new HttpError(409, 'Only a class that is live can be ended');
    await closeOpenAttendance(s.id, now);
    await audit(req, 'LIVE_SESSION_ENDED', s.id);
    return res.json({ data: view(await loadSession(req, s.id)) });
  })
);

/**
 * POST /api/v1/live-sessions/:id/join
 * Returns the media server URL and a token for this person. Course staff may publish; learners may
 * only watch and chat unless the instructor allowed student video. Only while the class is live.
 */
router.post(
  '/live-sessions/:id/join',
  route('Failed to join live session', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const user = req.user!;
    const s = await loadSession(req, idSchema.parse(req.params.id));
    const access = await requireContentAccess(req, s.courseId);
    if (user.role === 'AUDITOR') throw new HttpError(403, 'Forbidden: auditors cannot join live classes');
    if (!access.isStaff && !access.isEnrolled) throw new HttpError(403, 'Forbidden: enrol in this course to join its live classes');
    if (!liveConfigured()) throw new HttpError(503, 'Live classes are not configured on this server');
    if (s.status !== 'LIVE')
      throw new HttpError(409, s.status === 'SCHEDULED' ? 'This class has not started yet' : 'This class is not live');

    const person = await prisma.user.findFirst({ where: { id: user.id }, select: { firstName: true, lastName: true } });
    const isEditor = access.canEdit;
    const endsAt = s.scheduledAt.getTime() + s.durationMins * 60_000;
    const ttlSeconds = Math.max(15 * 60, Math.min(12 * 3600, Math.ceil((endsAt - Date.now()) / 1000) + TOKEN_GRACE_SECONDS));
    const role = isEditor ? 'HOST' : access.isStaff ? 'ASSISTANT' : 'LEARNER';

    const token = issueJoinToken({
      identity: user.id,
      name: person ? `${person.firstName} ${person.lastName}` : user.email,
      room: s.roomName,
      canPublish: access.isStaff || s.allowStudentVideo,
      roomAdmin: isEditor,
      role,
      ttlSeconds,
    });

    const existing = await prisma.liveAttendance.findUnique({ where: { sessionId_userId: { sessionId: s.id, userId: user.id } } });
    if (existing) await prisma.liveAttendance.update({ where: { id: existing.id }, data: { joinCount: { increment: 1 } } });
    else await prisma.liveAttendance.create({ data: { tenantId, sessionId: s.id, userId: user.id, firstJoinedAt: new Date() } });

    return res.json({
      data: { url: config.LIVEKIT_URL, token, roomName: s.roomName, role, canPublish: access.isStaff || s.allowStudentVideo },
    });
  })
);

/** GET /api/v1/live-sessions/:id/attendance: course staff see who attended and for how long. */
router.get(
  '/live-sessions/:id/attendance',
  route('Failed to load attendance', async (req, res) => {
    const s = await loadSession(req, idSchema.parse(req.params.id));
    await requireCourseStaff(req, s.courseId);
    const [enrolled, records] = await Promise.all([
      prisma.enrollment.findMany({
        where: { courseId: s.courseId, status: { in: [...ACTIVE_ENROLLMENT] } },
        select: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      }),
      prisma.liveAttendance.findMany({ where: { sessionId: s.id } }),
    ]);
    const byUser = new Map(records.map((r) => [r.userId, r]));
    const now = new Date();
    const rows = enrolled.map(({ user }) => {
      const r = byUser.get(user.id);
      // Someone still in the room is counted up to now.
      const seconds = r ? r.totalSeconds + (r.activeSince ? secondsBetween(r.activeSince, now) : 0) : 0;
      return {
        userId: user.id,
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
        joinCount: r?.joinCount ?? 0,
        firstJoinedAt: r?.firstJoinedAt ?? null,
        minutes: Math.floor(seconds / 60),
        present: isPresent(seconds),
        inRoomNow: !!r?.activeSince,
      };
    });
    return res.json({ data: rows, summary: { enrolled: rows.length, present: rows.filter((r) => r.present).length } });
  })
);

export default router;
