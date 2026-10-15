import { prisma } from './prisma';
import { logger } from './logger';

export const XP_PER_LEVEL = 500;
export const XP_AWARDS = {
  LESSON_COMPLETE: 25,
  QUIZ_PASSED: 100,
  COURSE_COMPLETE: 500,
  DAILY_STREAK: 50,
} as const;
export type XpSource = keyof typeof XP_AWARDS;

export const levelFor = (xp: number) => Math.floor(xp / XP_PER_LEVEL) + 1;

/** UTC calendar day as a Date at 00:00Z. */
export const utcDay = (d: Date = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const DAY_MS = 86_400_000;

/**
 * Next streak value given the last active day: same day keeps it, the next day extends it, any
 * longer gap restarts at 1.
 */
export function nextStreak(last: Date | null, today: Date, current: number): number {
  if (!last) return 1;
  const gap = Math.round((utcDay(today).getTime() - utcDay(last).getTime()) / DAY_MS);
  if (gap <= 0) return Math.max(current, 1);
  return gap === 1 ? current + 1 : 1;
}

/**
 * Grants XP once per (user, source, refId). Returns the points actually granted (0 when it was
 * already awarded). Never throws. Must run inside the tenant context of `tenantId`.
 */
export async function awardXp(opts: {
  tenantId: string;
  userId: string;
  source: XpSource;
  refId: string;
  points?: number;
}): Promise<number> {
  const points = opts.points ?? XP_AWARDS[opts.source];
  try {
    await prisma.xpEvent.create({
      data: { tenantId: opts.tenantId, userId: opts.userId, source: opts.source, refId: opts.refId, points },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') return 0; // already awarded
    logger.warn({ err }, 'xp award failed');
    return 0;
  }
  try {
    await prisma.userGamification.upsert({
      where: { userId: opts.userId },
      create: { tenantId: opts.tenantId, userId: opts.userId, xp: points },
      update: { xp: { increment: points } },
    });
  } catch (err) {
    logger.warn({ err }, 'xp total update failed');
  }
  return points;
}

/**
 * Records activity for today: extends or restarts the streak. Returns the state and whether this
 * was the first activity of the day.
 */
export async function touchStreak(tenantId: string, userId: string, now: Date = new Date()) {
  const today = utcDay(now);
  const row = await prisma.userGamification.findUnique({ where: { userId } });
  if (row?.lastActiveDate && utcDay(row.lastActiveDate).getTime() === today.getTime()) {
    return { streakDays: row.streakDays, longestStreak: row.longestStreak, firstToday: false };
  }
  const streakDays = nextStreak(row?.lastActiveDate ?? null, now, row?.streakDays ?? 0);
  const longestStreak = Math.max(row?.longestStreak ?? 0, streakDays);
  await prisma.userGamification.upsert({
    where: { userId },
    create: { tenantId, userId, streakDays, longestStreak, lastActiveDate: today },
    update: { streakDays, longestStreak, lastActiveDate: today },
  });
  return { streakDays, longestStreak, firstToday: true };
}
