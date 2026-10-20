import { runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma, prisma } from './prisma';
import { logger } from './logger';
import { sendMail } from './mailer';
import { hourInZone, inQuietHours } from './notify';
import { tenantUrl } from './tenant-url';

// Sends the e-mails queued by notify() (emailStatus = PENDING). Safe to run on several instances at
// once: each notification is claimed with a conditional update before it is sent, so it goes out
// at most once per attempt, and a crash after the claim costs one retry, never a duplicate.

export const MAX_ATTEMPTS = 5;
/** A queued e-mail that has waited this long (stuck behind quiet hours or failures) is dropped as stale. */
export const EXPIRE_AFTER_MS = 48 * 3_600_000;
const DEFAULT_BATCH = 100;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Only same-app paths and https links become clickable; anything else is omitted. Paths are made absolute on
 * `base`, the recipient's organisation address (APP_URL when not given).
 */
export function absoluteLink(link: string | null, base: string = config.APP_URL): string | null {
  if (!link) return null;
  if (link.startsWith('/') && !link.startsWith('//')) return `${base.replace(/\/+$/, '')}${link}`;
  return /^https:\/\//i.test(link) ? link : null;
}

export function renderEmail(n: { title: string; body: string | null; link: string | null }, tenantName: string, base?: string) {
  const url = absoluteLink(n.link, base);
  const footer = `You are receiving this because of your notification settings at ${tenantName}. You can change them in the app.`;
  const text = [n.title, n.body ?? '', url ? `Open: ${url}` : '', '', footer].filter((l, i) => l !== '' || i > 2).join('\n');
  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:560px">` +
    `<h2 style="margin:0 0 12px">${escapeHtml(n.title)}</h2>` +
    (n.body ? `<p style="white-space:pre-wrap">${escapeHtml(n.body)}</p>` : '') +
    (url ? `<p><a href="${escapeHtml(url)}">Open in ${escapeHtml(tenantName)}</a></p>` : '') +
    `<hr style="border:none;border-top:1px solid #ddd"><p style="color:#666;font-size:12px">${escapeHtml(footer)}</p></div>`;
  return { subject: n.title.replace(/[\r\n]+/g, ' ').slice(0, 200), text, html };
}

export interface DispatchResult {
  sent: number;
  failed: number;
  /** Waiting for the recipient's quiet hours to end. */
  held: number;
  /** Cancelled: recipient inactive, e-mail turned off since queuing, or too old. */
  dropped: number;
}

async function processTenant(tenant: { id: string; name: string; slug: string; customDomain: string | null }, now: Date, batch: number, totals: DispatchResult) {
  const pending = await prisma.notification.findMany({
    where: { emailStatus: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: batch,
  });

  for (const n of pending) {
    const drop = () => prisma.notification.updateMany({ where: { id: n.id, emailStatus: 'PENDING' }, data: { emailStatus: 'NONE' } });

    if (now.getTime() - n.createdAt.getTime() > EXPIRE_AFTER_MS) {
      await drop();
      totals.dropped++;
      continue;
    }
    const [user, prefs] = await Promise.all([
      prisma.user.findFirst({ where: { id: n.userId }, select: { email: true, status: true } }),
      prisma.notificationPreference.findUnique({ where: { userId: n.userId } }),
    ]);
    if (!user || user.status !== 'ACTIVE' || prefs?.emailEnabled === false) {
      await drop();
      totals.dropped++;
      continue;
    }
    if (prefs && inQuietHours(hourInZone(now, prefs.timezone), prefs.quietStartHour, prefs.quietEndHour)) {
      totals.held++;
      continue;
    }

    // Claim this attempt; if another instance got there first, skip.
    const claimed = await prisma.notification.updateMany({
      where: { id: n.id, emailStatus: 'PENDING', emailAttempts: n.emailAttempts },
      data: { emailAttempts: n.emailAttempts + 1 },
    });
    if (claimed.count !== 1) continue;

    try {
      await sendMail({ to: user.email, ...renderEmail(n, tenant.name, tenantUrl(tenant)) });
      await prisma.notification.update({ where: { id: n.id }, data: { emailStatus: 'SENT', emailedAt: new Date() } });
      totals.sent++;
    } catch (err) {
      const exhausted = n.emailAttempts + 1 >= MAX_ATTEMPTS;
      logger.warn({ err, notificationId: n.id, attempt: n.emailAttempts + 1, exhausted }, 'notification e-mail failed');
      if (exhausted) await prisma.notification.update({ where: { id: n.id }, data: { emailStatus: 'FAILED' } });
      totals.failed++;
    }
  }
}

/** Processes every active tenant's queue once. Never throws: one bad tenant must not stop the rest. */
export async function dispatchPendingEmails(opts: { now?: Date; batch?: number } = {}): Promise<DispatchResult> {
  const now = opts.now ?? new Date();
  const totals: DispatchResult = { sent: 0, failed: 0, held: 0, dropped: 0 };
  const tenants = await basePrisma.tenant.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL'] } }, select: { id: true, name: true, slug: true, customDomain: true } });
  for (const tenant of tenants) {
    try {
      await runWithTenant(tenant.id, () => processTenant(tenant, now, opts.batch ?? DEFAULT_BATCH, totals));
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, 'e-mail dispatch failed for tenant');
    }
  }
  return totals;
}

let timer: NodeJS.Timeout | null = null;

/** Starts the background sender; a tick is skipped while the previous one is still running. */
export function startEmailDispatcher(): void {
  const seconds = config.EMAIL_DISPATCH_INTERVAL_SECONDS;
  if (seconds <= 0 || timer) return;
  let running = false;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await dispatchPendingEmails();
      if (r.sent || r.failed) logger.info(r, 'notification e-mails processed');
    } finally {
      running = false;
    }
  }, seconds * 1000);
  timer.unref();
}
