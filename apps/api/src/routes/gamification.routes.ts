import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';
import { route } from '../lib/http';
import { idSchema, parseQuery } from '../lib/validate';
import { requireContentAccess } from '../lib/access';
import { bloomsMastery } from '../lib/bloom';
import { awardXp, levelFor, touchStreak, XP_AWARDS, XP_PER_LEVEL } from '../lib/gamification';

// Mounted at /api/v1/gamification.

const router = Router();
router.use(authenticateJWT);

const view = (g: { xp: number; streakDays: number; longestStreak: number; lastActiveDate: Date | null } | null) => {
  const xp = g?.xp ?? 0;
  return {
    xp,
    level: levelFor(xp),
    xpIntoLevel: xp % XP_PER_LEVEL,
    xpPerLevel: XP_PER_LEVEL,
    streakDays: g?.streakDays ?? 0,
    longestStreak: g?.longestStreak ?? 0,
    lastActiveDate: g?.lastActiveDate ?? null,
  };
};

/** GET /api/v1/gamification/me */
router.get(
  '/me',
  route('Failed to load progress', async (req, res) => {
    const g = await prisma.userGamification.findUnique({ where: { userId: req.user!.id } });
    const recent = await prisma.xpEvent.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { source: true, points: true, createdAt: true },
    });
    return res.json({ data: { ...view(g), recent } });
  })
);

/**
 * POST /api/v1/gamification/checkin: claims today's streak. The first check-in of a UTC day
 * extends (or restarts) the streak and awards the daily bonus once; repeating it is a no-op.
 */
router.post(
  '/checkin',
  route('Failed to record check-in', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const userId = req.user!.id;
    const streak = await touchStreak(tenantId, userId);
    const awarded = streak.firstToday
      ? await awardXp({
          tenantId,
          userId,
          source: 'DAILY_STREAK',
          refId: new Date().toISOString().slice(0, 10),
          points: XP_AWARDS.DAILY_STREAK + Math.min(streak.streakDays - 1, 6) * 10,
        })
      : 0;
    const g = await prisma.userGamification.findUnique({ where: { userId } });
    return res.json({ data: { ...view(g), awarded, alreadyClaimed: !streak.firstToday } });
  })
);

/**
 * GET /api/v1/gamification/mastery
 * The caller's own Bloom's-taxonomy profile, from their graded answers to tagged quiz questions.
 */
router.get(
  '/mastery',
  route('Failed to load mastery', async (req, res) => {
    const userId = req.user!.id;
    const quizzes = await prisma.quiz.findMany({
      where: { tenantId: tenantIdOf(req), questions: { some: { bloomLevel: { not: null } } }, submissions: { some: { userId, submittedAt: { not: null } } } },
      select: {
        questions: { select: { id: true, bloomLevel: true } },
        submissions: { where: { userId, submittedAt: { not: null } }, select: { answersJson: true } },
      },
    });
    return res.json({ data: bloomsMastery(quizzes) });
  })
);

export const boardQuery = z.object({ courseId: idSchema, limit: z.coerce.number().int().min(1).max(50).default(10) });

/**
 * GET /api/v1/gamification/leaderboard?courseId=
 * Cohort standings for one course, visible to people with access to that course. Names are
 * abbreviated ("Alex C.") and only enrolled learners appear.
 */
router.get(
  '/leaderboard',
  route('Failed to load leaderboard', async (req, res) => {
    const { courseId, limit } = parseQuery(req, boardQuery);
    const access = await requireContentAccess(req, courseId);
    const rows = await prisma.enrollment.findMany({
      where: { tenantId: tenantIdOf(req), courseId: access.course.id, status: { in: ['ENROLLED', 'IN_PROGRESS', 'COMPLETED'] } },
      select: { user: { select: { id: true, firstName: true, lastName: true, role: true, gamification: true } } },
    });
    const standings = rows
      .filter((r) => r.user.role === 'STUDENT')
      .map((r) => ({
        userId: r.user.id,
        name: `${r.user.firstName} ${r.user.lastName.charAt(0)}.`,
        xp: r.user.gamification?.xp ?? 0,
        level: levelFor(r.user.gamification?.xp ?? 0),
        streakDays: r.user.gamification?.streakDays ?? 0,
      }))
      .sort((a, b) => b.xp - a.xp || b.streakDays - a.streakDays)
      .slice(0, limit)
      .map((s, i) => ({ rank: i + 1, ...s, isMe: s.userId === req.user!.id }));
    return res.json({ data: standings });
  })
);

export default router;
