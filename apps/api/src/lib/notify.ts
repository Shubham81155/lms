import { prisma } from './prisma';
import { logger } from './logger';

/**
 * Categories worth an e-mail. Forum replies are deliberately left out: they are frequent and
 * low-urgency, so they stay in-app unless the user opens the app.
 */
export const EMAIL_CATEGORIES = ['GRADE', 'EXAM', 'COURSE', 'SYSTEM', 'LIVE'] as const;

export interface NotifyInput {
  tenantId: string;
  userId: string;
  category: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

/** True when `hour` falls inside [start, end), wrapping past midnight (e.g. 22 -> 7). */
export function inQuietHours(hour: number, start?: number | null, end?: number | null): boolean {
  if (start == null || end == null || start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Current hour of day in an IANA time zone; falls back to UTC for an unknown zone. */
export function hourInZone(now: Date, timeZone: string): number {
  try {
    const h = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone }).format(now);
    return Number(h) % 24;
  } catch {
    return now.getUTCHours();
  }
}

/**
 * Creates an in-app notification unless the user has switched in-app delivery off or muted the
 * category. Never throws: a failed notification must not fail the request that triggered it.
 * Must run inside the tenant context of `tenantId`.
 */
export async function notify(input: NotifyInput) {
  try {
    const prefs = await prisma.notificationPreference.findUnique({ where: { userId: input.userId } });
    if (prefs && (!prefs.inAppEnabled || prefs.mutedCategories.includes(input.category))) return null;
    // Queue an e-mail unless the user turned e-mail off (the default is on). Quiet hours are
    // applied when the queue is processed, so a night-time grade is sent in the morning.
    const wantsEmail = (prefs?.emailEnabled ?? true) && (EMAIL_CATEGORIES as readonly string[]).includes(input.category);
    return await prisma.notification.create({
      data: {
        emailStatus: wantsEmail ? 'PENDING' : 'NONE',
        tenantId: input.tenantId,
        userId: input.userId,
        category: input.category,
        title: input.title.slice(0, 200),
        body: input.body ?? null,
        link: input.link ?? null,
      },
    });
  } catch (err) {
    logger.warn({ err, userId: input.userId }, 'notification failed');
    return null;
  }
}

export async function notifyMany(inputs: NotifyInput[]) {
  return Promise.all(inputs.map(notify));
}
