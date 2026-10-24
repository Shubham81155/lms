import crypto from 'crypto';
import { runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma, prisma } from './prisma';
import { logger } from './logger';
import { mailDelivers, sendMail } from './mailer';
import { absoluteLink } from './email-dispatch';
import { personalDue } from './deadlines';
import { startPeriodicJob, withJobLock } from './job-lock';
import { tenantUrl } from './tenant-url';

// Digest e-mails: one summary of what a person missed (unread notifications that were not e-mailed on their own,
// deadlines in the next seven days, new announcements, upcoming live classes), sent daily or weekly at the hour
// the person picked in their own time zone (UTC until they set one). Everyone gets a WEEKLY digest until they
// change it (opt-out), and every e-mail carries a signed one-click unsubscribe link. Settings live in
// NotificationPreference (digestFrequency, digestHour, digestWeekday, digestSections, lastDigestAt). SMS and push
// are stored as flags there but nothing delivers them yet.
//
// Safe on several instances at once: the job runs under an advisory lock, and each digest is claimed by moving
// lastDigestAt with a conditional update before it is sent, so it goes out at most once per period. A failed send
// costs that period's digest (it is logged), never a retry loop.

export const DIGEST_JOB = 'digest-emails';
export const DIGEST_FREQUENCIES = ['OFF', 'DAILY', 'WEEKLY'] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];
export const DIGEST_SECTIONS = ['deadlines', 'announcements', 'grades', 'forum', 'live'] as const;
export type DigestSection = (typeof DIGEST_SECTIONS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far ahead deadlines and live classes are listed. */
export const LOOKAHEAD_MS = 7 * DAY_MS;
/** Items listed per section; the rest are counted ("and 4 more"). */
const PER_SECTION = 10;

// --------------------------------------------------------------------------- when a digest is due

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The calendar date, hour and weekday of an instant in an IANA time zone (UTC for an unknown zone). */
export function localParts(at: Date, timeZone: string): { day: number; hour: number; weekday: number } {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      weekday: 'short',
    });
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      weekday: 'short',
    });
  }
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  // Days since the epoch of the local date: comparable across month ends, no time of day in it.
  const day = Math.floor(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / DAY_MS);
  return { day, hour: Number(p.hour) % 24, weekday: WEEKDAYS[p.weekday] ?? 0 };
}

export interface DigestSchedule {
  digestFrequency: string;
  digestHour: number;
  digestWeekday: number;
  timezone: string;
  lastDigestAt: Date | null;
}

/**
 * Whether the digest is due at `now`: past the chosen hour of a local day that has not had one. DAILY: any such
 * day. WEEKLY: the chosen weekday, or (so a day of downtime does not skip a week) eight days after the last one.
 */
export function digestDue(s: DigestSchedule, now: Date): boolean {
  if (s.digestFrequency !== 'DAILY' && s.digestFrequency !== 'WEEKLY') return false;
  const here = localParts(now, s.timezone);
  if (here.hour < s.digestHour) return false;
  const last = s.lastDigestAt ? localParts(s.lastDigestAt, s.timezone) : null;
  if (last && last.day >= here.day) return false;
  if (s.digestFrequency === 'DAILY') return true;
  return here.weekday === s.digestWeekday || (!!last && here.day - last.day >= 8);
}

// --------------------------------------------------------------------------- unsubscribe links

const tokenMac = (payload: string) =>
  crypto.createHmac('sha256', config.JWT_SECRET).update(`digest-unsubscribe:${payload}`).digest('base64url');

/**
 * A link token that turns one person's digests off without signing in. It has no expiry (an old e-mail must keep
 * working) and can do nothing else.
 */
export function signUnsubscribeToken(tenantId: string, userId: string): string {
  const payload = Buffer.from(`${tenantId}.${userId}`).toString('base64url');
  return `${payload}.${tokenMac(payload)}`;
}

export function verifyUnsubscribeToken(token: string): { tenantId: string; userId: string } | null {
  const [payload, mac, extra] = token.split('.');
  if (!payload || !mac || extra !== undefined) return null;
  const expected = Buffer.from(tokenMac(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  const [tenantId, userId, more] = Buffer.from(payload, 'base64url').toString().split('.');
  return tenantId && userId && more === undefined ? { tenantId, userId } : null;
}

// --------------------------------------------------------------------------- the message

export interface DigestInput {
  tenantName: string;
  /** The organisation's own address, for links. */
  base: string;
  firstName: string;
  timezone: string;
  frequency: 'DAILY' | 'WEEKLY';
  sections: string[];
  now: Date;
  /** Unread notifications that were not e-mailed on their own, newest first. */
  notifications: { category: string; title: string; body: string | null; link: string | null }[];
  /** Work due within the next seven days that the person has not handed in. */
  deadlines: { kind: 'Assignment' | 'Quiz'; title: string; courseTitle: string; dueAt: Date; link: string }[];
  announcements: { title: string; courseTitle: string; createdAt: Date; link: string }[];
  liveSessions: { title: string; courseTitle: string; scheduledAt: Date; link: string }[];
  unsubscribeUrl: string;
  /** The address the List-Unsubscribe header points at (answers POST). */
  oneClickUrl: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

function when(d: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
}

interface Line {
  title: string;
  detail?: string;
  url: string | null;
}
interface Block {
  heading: string;
  lines: Line[];
  more: number;
}

/** The digest for one person, or null when there is nothing in the sections they asked for. Pure: no queries. */
export function buildDigest(i: DigestInput): { subject: string; text: string; html: string; items: number } | null {
  const on = (s: DigestSection) => i.sections.includes(s);
  const fromNotes = (category: string): Line[] =>
    i.notifications
      .filter((n) => n.category === category)
      .map((n) => ({
        title: oneLine(n.title),
        detail: n.body ? oneLine(n.body).slice(0, 160) : undefined,
        url: absoluteLink(n.link, i.base),
      }));
  const other = i.notifications
    .filter((n) => !['GRADE', 'FORUM', 'LIVE'].includes(n.category))
    .map((n) => ({
      title: oneLine(n.title),
      detail: n.body ? oneLine(n.body).slice(0, 160) : undefined,
      url: absoluteLink(n.link, i.base),
    }));

  const raw: { heading: string; lines: Line[] }[] = [
    {
      heading: 'Due in the next 7 days',
      lines: on('deadlines')
        ? [...i.deadlines]
            .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
            .map((d) => ({
              title: `${d.kind}: ${oneLine(d.title)}`,
              detail: `${oneLine(d.courseTitle)} · due ${when(d.dueAt, i.timezone)}`,
              url: absoluteLink(d.link, i.base),
            }))
        : [],
    },
    { heading: 'New grades', lines: on('grades') ? fromNotes('GRADE') : [] },
    {
      heading: 'New announcements',
      lines: on('announcements')
        ? i.announcements.map((a) => ({ title: oneLine(a.title), detail: oneLine(a.courseTitle), url: absoluteLink(a.link, i.base) }))
        : [],
    },
    { heading: 'Discussion replies', lines: on('forum') ? fromNotes('FORUM') : [] },
    {
      heading: 'Live classes this week',
      lines: on('live')
        ? [...i.liveSessions]
            .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
            .map((l) => ({
              title: oneLine(l.title),
              detail: `${oneLine(l.courseTitle)} · ${when(l.scheduledAt, i.timezone)}`,
              url: absoluteLink(l.link, i.base),
            }))
        : [],
    },
    { heading: 'Other updates', lines: other },
  ];
  const blocks: Block[] = raw
    .filter((b) => b.lines.length > 0)
    .map((b) => ({ heading: b.heading, lines: b.lines.slice(0, PER_SECTION), more: Math.max(0, b.lines.length - PER_SECTION) }));
  const items = raw.reduce((n, b) => n + b.lines.length, 0);
  if (items === 0) return null;

  const period = i.frequency === 'DAILY' ? 'daily' : 'weekly';
  const subject = `Your ${period} summary from ${oneLine(i.tenantName)}`.slice(0, 200);
  const footer = `You get this ${period} summary because of your notification settings at ${i.tenantName}.`;

  const text = [
    `Hello ${oneLine(i.firstName)},`,
    '',
    `Here is what happened at ${i.tenantName}${i.frequency === 'DAILY' ? ' since yesterday' : ' this week'}.`,
    ...blocks.flatMap((b) => [
      '',
      b.heading.toUpperCase(),
      ...b.lines.map((l) => `- ${l.title}${l.detail ? ` (${l.detail})` : ''}${l.url ? `\n  ${l.url}` : ''}`),
      ...(b.more ? [`  ...and ${b.more} more`] : []),
    ]),
    '',
    `Open ${i.tenantName}: ${i.base}`,
    '',
    footer,
    `Change how often you get it, or turn it off: ${i.unsubscribeUrl}`,
  ].join('\n');

  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:560px">` +
    `<h2 style="margin:0 0 12px">${escapeHtml(subject)}</h2>` +
    `<p>Hello ${escapeHtml(oneLine(i.firstName))},</p>` +
    blocks
      .map(
        (b) =>
          `<h3 style="margin:20px 0 6px;font-size:15px">${escapeHtml(b.heading)}</h3><ul style="margin:0;padding-left:20px">` +
          b.lines
            .map(
              (l) =>
                `<li style="margin:4px 0">${l.url ? `<a href="${escapeHtml(l.url)}">${escapeHtml(l.title)}</a>` : escapeHtml(l.title)}${l.detail ? `<br><span style="color:#666;font-size:13px">${escapeHtml(l.detail)}</span>` : ''}</li>`
            )
            .join('') +
          (b.more ? `<li style="color:#666">…and ${b.more} more</li>` : '') +
          `</ul>`
      )
      .join('') +
    `<p style="margin-top:20px"><a href="${escapeHtml(i.base)}">Open ${escapeHtml(i.tenantName)}</a></p>` +
    `<hr style="border:none;border-top:1px solid #ddd"><p style="color:#666;font-size:12px">${escapeHtml(footer)} <a href="${escapeHtml(i.unsubscribeUrl)}">Change how often you get it, or turn it off</a>.</p></div>`;

  return { subject, text, html, items };
}

// --------------------------------------------------------------------------- gathering one person's items

type TenantRow = { id: string; name: string; slug: string; customDomain: string | null };
type Recipient = { id: string; email: string; firstName: string };
type Pref = { digestFrequency: string; digestSections: string[]; timezone: string; lastDigestAt: Date | null };

/** Runs inside the tenant's context. Only the person's own enrolments' items; each source is capped. */
async function gather(tenant: TenantRow, user: Recipient, pref: Pref, since: Date, now: Date): Promise<DigestInput> {
  const base = tenantUrl(tenant);
  const horizon = new Date(now.getTime() + LOOKAHEAD_MS);

  // E-mailed notifications (grades, exams, ...) reached the person already; the digest is for what did not.
  const notifications = await prisma.notification.findMany({
    where: { userId: user.id, readAt: null, createdAt: { gt: since }, emailStatus: { not: 'SENT' } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { category: true, title: true, body: true, link: true },
  });

  const enrolments = await prisma.enrollment.findMany({
    where: { userId: user.id, status: { in: ['ENROLLED', 'IN_PROGRESS'] } },
    select: { courseId: true, course: { select: { title: true } } },
    take: 200,
  });
  const courseIds = enrolments.map((e) => e.courseId);
  const courseTitle = new Map(enrolments.map((e) => [e.courseId, e.course.title]));
  const sections = pref.digestSections;

  const deadlines: DigestInput['deadlines'] = [];
  if (sections.includes('deadlines') && courseIds.length) {
    // A deadline is looked at through the person's extension, so the course-wide date may be past already.
    const [assignments, quizzes] = await Promise.all([
      prisma.assignment.findMany({
        where: {
          courseId: { in: courseIds },
          dueDate: { not: null, lte: horizon },
          OR: [{ dueDate: { gt: now } }, { extensions: { some: { userId: user.id, dueAt: { gt: now } } } }],
        },
        select: {
          id: true,
          title: true,
          courseId: true,
          dueDate: true,
          extensions: { where: { userId: user.id }, select: { dueAt: true } },
        },
        take: 100,
      }),
      prisma.quiz.findMany({
        where: {
          courseId: { in: courseIds },
          dueAt: { not: null, lte: horizon },
          OR: [{ dueAt: { gt: now } }, { extensions: { some: { userId: user.id, dueAt: { gt: now } } } }],
        },
        select: { id: true, title: true, courseId: true, dueAt: true, extensions: { where: { userId: user.id }, select: { dueAt: true } } },
        take: 100,
      }),
    ]);
    const [handedIn, attempted] = await Promise.all([
      prisma.assignmentSubmission.findMany({
        where: { userId: user.id, assignmentId: { in: assignments.map((a) => a.id) } },
        select: { assignmentId: true },
      }),
      prisma.quizSubmission.findMany({ where: { userId: user.id, quizId: { in: quizzes.map((q) => q.id) } }, select: { quizId: true } }),
    ]);
    const doneA = new Set(handedIn.map((s) => s.assignmentId));
    const doneQ = new Set(attempted.map((s) => s.quizId));
    const within = (d: Date | null) => !!d && d > now && d <= horizon;
    for (const a of assignments) {
      const due = personalDue(a.dueDate, a.extensions[0]?.dueAt ?? null);
      if (!doneA.has(a.id) && within(due))
        deadlines.push({
          kind: 'Assignment',
          title: a.title,
          courseTitle: courseTitle.get(a.courseId) ?? '',
          dueAt: due!,
          link: `/courses/${a.courseId}/assignments`,
        });
    }
    for (const q of quizzes) {
      const due = personalDue(q.dueAt, q.extensions[0]?.dueAt ?? null);
      if (!doneQ.has(q.id) && within(due))
        deadlines.push({
          kind: 'Quiz',
          title: q.title,
          courseTitle: courseTitle.get(q.courseId) ?? '',
          dueAt: due!,
          link: `/quizzes/${q.id}`,
        });
    }
  }

  const announcements =
    sections.includes('announcements') && courseIds.length
      ? (
          await prisma.announcement.findMany({
            where: { courseId: { in: courseIds }, createdAt: { gt: since } },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: { title: true, courseId: true, createdAt: true },
          })
        ).map((a) => ({
          title: a.title,
          courseTitle: courseTitle.get(a.courseId) ?? '',
          createdAt: a.createdAt,
          link: `/courses/${a.courseId}`,
        }))
      : [];

  const liveSessions =
    sections.includes('live') && courseIds.length
      ? (
          await prisma.liveSession.findMany({
            where: { courseId: { in: courseIds }, status: 'SCHEDULED', scheduledAt: { gt: now, lte: horizon } },
            orderBy: { scheduledAt: 'asc' },
            take: 50,
            select: { title: true, courseId: true, scheduledAt: true },
          })
        ).map((l) => ({
          title: l.title,
          courseTitle: courseTitle.get(l.courseId) ?? '',
          scheduledAt: l.scheduledAt,
          link: `/courses/${l.courseId}/live`,
        }))
      : [];

  const token = signUnsubscribeToken(tenant.id, user.id);
  return {
    tenantName: tenant.name,
    base,
    firstName: user.firstName,
    timezone: pref.timezone,
    frequency: pref.digestFrequency === 'DAILY' ? 'DAILY' : 'WEEKLY',
    sections,
    now,
    notifications,
    deadlines,
    announcements,
    liveSessions,
    unsubscribeUrl: `${base}/unsubscribe?token=${token}`,
    oneClickUrl: `${base}/api/v1/notifications/unsubscribe?token=${token}`,
  };
}

// --------------------------------------------------------------------------- the job

export interface DigestResult {
  sent: number;
  /** Due, but nothing to report (no e-mail; the period still counts as done). */
  empty: number;
  failed: number;
}

const PAGE = 200;
/** Users looked at per organisation per run, so one large organisation of people not yet due cannot hold the job up. */
const SCAN_CAP = 5000;

async function processTenant(tenant: TenantRow, now: Date, budget: { left: number }, totals: DigestResult): Promise<void> {
  let cursor: string | undefined;
  let scanned = 0;
  while (budget.left > 0 && scanned < SCAN_CAP) {
    // People with no preference row have the defaults; a row exists from their first look on. Those whose
    // last digest is under 20 hours old cannot be due again yet (the shortest period is a day).
    const users = await prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        erasedAt: null,
        OR: [
          { notificationPref: null },
          {
            notificationPref: {
              digestFrequency: { not: 'OFF' },
              OR: [{ lastDigestAt: null }, { lastDigestAt: { lt: new Date(now.getTime() - 20 * 3_600_000) } }],
            },
          },
        ],
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: PAGE,
      select: { id: true, email: true, firstName: true, notificationPref: true },
    });
    if (users.length === 0) break;
    cursor = users[users.length - 1].id;
    scanned += users.length;

    for (const u of users) {
      if (budget.left <= 0) return;
      try {
        let pref = u.notificationPref;
        if (!pref)
          pref = await prisma.notificationPreference.upsert({
            where: { userId: u.id },
            create: { tenantId: tenant.id, userId: u.id },
            update: {},
          });
        if (!digestDue(pref, now)) continue;

        // Claim the period: only one instance moves lastDigestAt from the value read here.
        const claimed = await prisma.notificationPreference.updateMany({
          where: { userId: u.id, digestFrequency: pref.digestFrequency, lastDigestAt: pref.lastDigestAt },
          data: { lastDigestAt: now },
        });
        if (claimed.count !== 1) continue;

        const since = pref.lastDigestAt ?? new Date(now.getTime() - (pref.digestFrequency === 'DAILY' ? DAY_MS : 7 * DAY_MS));
        const input = await gather(tenant, u, pref, since, now);
        const digest = buildDigest(input);
        if (!digest) {
          totals.empty++;
          continue;
        }
        budget.left--;
        try {
          await sendMail({
            to: u.email,
            subject: digest.subject,
            text: digest.text,
            html: digest.html,
            headers: { 'List-Unsubscribe': `<${input.oneClickUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
          });
          totals.sent++;
        } catch (err) {
          totals.failed++;
          logger.warn({ err, userId: u.id }, 'digest e-mail failed');
        }
      } catch (err) {
        totals.failed++;
        logger.error({ err, userId: u.id, tenantId: tenant.id }, 'digest failed for a person');
      }
    }
    if (users.length < PAGE) break;
  }
}

/**
 * One round: every organisation that can send (active, or on a running trial; not suspended, not read-only), at
 * most DIGEST_MAX_PER_RUN e-mails in all. Never throws for one bad organisation.
 */
export async function runDigestJob(now = new Date()): Promise<DigestResult> {
  const totals: DigestResult = { sent: 0, empty: 0, failed: 0 };
  // With no transport the mail would be thrown away: do not use up anyone's period.
  if (!mailDelivers()) return totals;
  const budget = { left: config.DIGEST_MAX_PER_RUN };
  const tenants = await basePrisma.tenant.findMany({
    where: { OR: [{ status: 'ACTIVE' }, { status: 'TRIAL', trialExpiredAt: null }], deletionScheduledAt: null },
    select: { id: true, name: true, slug: true, customDomain: true },
    orderBy: { id: 'asc' },
  });
  for (const tenant of tenants) {
    if (budget.left <= 0) break;
    try {
      await runWithTenant(tenant.id, () => processTenant(tenant, now, budget, totals));
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, 'digest job failed for an organisation');
    }
  }
  if (totals.sent || totals.failed) logger.info({ ...totals }, 'digest e-mails processed');
  return totals;
}

/** One round under the job lock: null when another process is running it. */
export const runDigestJobLocked = (now?: Date) => withJobLock(DIGEST_JOB, () => runDigestJob(now));

export function startDigestJob(): void {
  startPeriodicJob(DIGEST_JOB, config.DIGEST_JOB_INTERVAL_SECONDS, () => runDigestJob());
}
