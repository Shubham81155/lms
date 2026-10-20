import { runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma, prisma } from './prisma';
import { HttpError } from './http';
import { logAuditEvent } from './audit';
import { logger } from './logger';
import { mailDelivers, sendMail } from './mailer';
import { invalidateTenantSessions } from './session';
import { startPeriodicJob, withJobLock } from './job-lock';
import { tenantUrl } from './tenant-url';
import type { Actor } from './organizations';

// Free trials. Off unless ORG_TRIAL_DAYS > 0 (or the operator starts one for an organisation). A trial
// organisation has status TRIAL and trialEndsAt. Its administrators are e-mailed seven days and one day before
// the end; at the end trialExpiredAt is set and the organisation is read-only (lib/trial-guard.ts) for
// ORG_TRIAL_GRACE_DAYS, then suspended. The operator can start, extend, end or convert a trial to paid (ACTIVE).
// Every transition is audited in the organisation's trail and the operator's.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const TRIAL_JOB = 'trial-lifecycle';

/** trialRemindersSent bits. */
export const REMINDER_7_DAYS = 1;
export const REMINDER_1_DAY = 2;

export type TrialState = 'NONE' | 'TRIAL' | 'READ_ONLY';

interface TrialFields {
  status: string;
  trialEndsAt: Date | null;
  trialExpiredAt: Date | null;
}

/** When an ended trial's read-only period is over and the organisation is suspended. */
export const readOnlyUntil = (trialExpiredAt: Date) => new Date(trialExpiredAt.getTime() + config.ORG_TRIAL_GRACE_DAYS * DAY_MS);

/** Whole days left, rounded up ("ends in 1 day" until the very end). */
export const daysLeft = (endsAt: Date, now = new Date()) => Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS));

/** The trial as people see it: none, running (with days left), or ended and read-only (until when). */
export function trialInfo(t: TrialFields, now = new Date()) {
  const state: TrialState = t.status !== 'TRIAL' ? 'NONE' : t.trialExpiredAt ? 'READ_ONLY' : 'TRIAL';
  return {
    state,
    trialEndsAt: state === 'NONE' ? null : t.trialEndsAt,
    daysLeft: state === 'TRIAL' && t.trialEndsAt ? daysLeft(t.trialEndsAt, now) : null,
    readOnlyUntil: state === 'READ_ONLY' && t.trialExpiredAt ? readOnlyUntil(t.trialExpiredAt) : null,
  };
}

/** Columns a new organisation starts with: a trial of `days` (0: none, active as before). */
export const initialTrial = (days: number, now = new Date()) =>
  days > 0 ? { status: 'TRIAL' as const, trialEndsAt: new Date(now.getTime() + days * DAY_MS) } : { status: 'ACTIVE' as const };

const formatDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// --------------------------------------------------------------------------- audit and mail

/** Writes the entry in the organisation's trail and in the operator's (the actor's, or the configured operator organisation). */
async function auditTrial(tenantId: string, action: string, diffJson: Record<string, unknown>, actor?: Actor): Promise<void> {
  const entry = { action, resourceType: 'TENANT', resourceId: tenantId, ipAddress: actor?.ipAddress, userAgent: actor?.userAgent, diffJson };
  await runWithTenant(tenantId, () => logAuditEvent({ ...entry, tenantId, userId: undefined }));
  const operatorId =
    actor?.tenantId ??
    (config.PLATFORM_OPERATOR_TENANT ? (await basePrisma.tenant.findUnique({ where: { slug: config.PLATFORM_OPERATOR_TENANT }, select: { id: true } }))?.id : undefined);
  if (operatorId && operatorId !== tenantId) await runWithTenant(operatorId, () => logAuditEvent({ ...entry, tenantId: operatorId, userId: actor?.userId }));
}

/** E-mails the organisation's administrators (active or still invited). Problems are logged, never thrown. */
async function mailAdmins(tenant: { id: string; name: string; slug: string; customDomain: string | null }, subject: string, body: string): Promise<number> {
  if (!mailDelivers()) return 0;
  const admins = await runWithTenant(tenant.id, () =>
    prisma.user.findMany({ where: { tenantId: tenant.id, role: { in: ['TENANT_ADMIN', 'SUPER_ADMIN'] }, status: { in: ['ACTIVE', 'INVITED'] }, erasedAt: null }, select: { email: true, firstName: true } })
  );
  let sent = 0;
  for (const a of admins) {
    try {
      await sendMail({ to: a.email, subject, text: `Hello ${a.firstName},\n\n${body}\n\n${tenantUrl(tenant)}/admin` });
      sent++;
    } catch (err) {
      logger.warn({ err, tenantId: tenant.id }, 'could not e-mail an administrator about the trial');
    }
  }
  return sent;
}

// --------------------------------------------------------------------------- operator actions

const trialSelect = { id: true, slug: true, status: true, trialEndsAt: true, trialExpiredAt: true } as const;

async function trialTenant(id: string, actor: Actor) {
  if (id === actor.tenantId) throw new HttpError(409, 'The platform operator organisation cannot have a trial');
  const t = await basePrisma.tenant.findUnique({ where: { id }, select: trialSelect });
  if (!t) throw new HttpError(404, 'Organisation not found');
  return t;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Starts a trial of `days` for an active (paid) organisation. */
export async function startTrial(id: string, days: number, actor: Actor, now = new Date()): Promise<void> {
  const t = await trialTenant(id, actor);
  if (t.status !== 'ACTIVE') throw new HttpError(409, t.status === 'TRIAL' ? 'This organisation already has a trial: extend it instead' : 'Only an active organisation can start a trial');
  const trialEndsAt = new Date(now.getTime() + days * DAY_MS);
  const done = await basePrisma.tenant.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'TRIAL', trialEndsAt, trialExpiredAt: null, trialRemindersSent: 0 } });
  if (done.count !== 1) throw new HttpError(409, 'The organisation changed meanwhile; try again');
  invalidateTenantSessions(id);
  await auditTrial(id, 'TRIAL_STARTED', { tenant: t.slug, days, trialEndsAt: iso(trialEndsAt) }, actor);
}

/**
 * Adds `days` to the trial, counted from its end or from now if it has already ended; an ended trial (read-only,
 * or suspended because it lapsed) is open again. Reminders are sent afresh for the new end.
 */
export async function extendTrial(id: string, days: number, actor: Actor, now = new Date()): Promise<void> {
  const t = await trialTenant(id, actor);
  const lapsed = t.status === 'SUSPENDED' && !!t.trialExpiredAt;
  if (t.status !== 'TRIAL' && !lapsed) throw new HttpError(409, 'This organisation has no trial to extend');
  const from = Math.max(now.getTime(), t.trialEndsAt?.getTime() ?? 0);
  const trialEndsAt = new Date(from + days * DAY_MS);
  const done = await basePrisma.tenant.updateMany({
    where: { id, status: t.status, trialEndsAt: t.trialEndsAt, trialExpiredAt: t.trialExpiredAt },
    data: { status: 'TRIAL', trialEndsAt, trialExpiredAt: null, trialRemindersSent: 0 },
  });
  if (done.count !== 1) throw new HttpError(409, 'The organisation changed meanwhile; try again');
  invalidateTenantSessions(id);
  await auditTrial(id, 'TRIAL_EXTENDED', { tenant: t.slug, days, before: { status: t.status, trialEndsAt: iso(t.trialEndsAt), trialExpiredAt: iso(t.trialExpiredAt) }, trialEndsAt: iso(trialEndsAt) }, actor);
}

/** Ends a running trial now: the organisation becomes read-only, as when a trial runs out. */
export async function endTrial(id: string, actor: Actor, now = new Date()): Promise<void> {
  const t = await trialTenant(id, actor);
  if (t.status !== 'TRIAL' || t.trialExpiredAt) throw new HttpError(409, 'This organisation has no running trial');
  const done = await basePrisma.tenant.updateMany({ where: { id, status: 'TRIAL', trialExpiredAt: null }, data: { trialEndsAt: now, trialExpiredAt: now } });
  if (done.count !== 1) throw new HttpError(409, 'The organisation changed meanwhile; try again');
  invalidateTenantSessions(id);
  await auditTrial(id, 'TRIAL_ENDED', { tenant: t.slug, before: { trialEndsAt: iso(t.trialEndsAt) }, readOnlyUntil: iso(readOnlyUntil(now)), by: 'OPERATOR' }, actor);
}

/** Makes a trial organisation (running, ended, or suspended because its trial lapsed) an active, paid one. */
export async function convertTrial(id: string, actor: Actor): Promise<void> {
  const t = await trialTenant(id, actor);
  const lapsed = t.status === 'SUSPENDED' && !!t.trialExpiredAt;
  if (t.status !== 'TRIAL' && !lapsed) throw new HttpError(409, 'This organisation has no trial to convert');
  const done = await basePrisma.tenant.updateMany({
    where: { id, status: t.status, trialExpiredAt: t.trialExpiredAt },
    data: { status: 'ACTIVE', trialEndsAt: null, trialExpiredAt: null, trialRemindersSent: 0 },
  });
  if (done.count !== 1) throw new HttpError(409, 'The organisation changed meanwhile; try again');
  invalidateTenantSessions(id);
  await auditTrial(id, 'TRIAL_CONVERTED', { tenant: t.slug, before: { status: t.status, trialEndsAt: iso(t.trialEndsAt), trialExpiredAt: iso(t.trialExpiredAt) }, after: { status: 'ACTIVE' } }, actor);
}

// --------------------------------------------------------------------------- the background job

export interface TrialJobResult {
  reminded: number;
  expired: number;
  suspended: number;
}

/**
 * One round: reminders due, trials that ran out (read-only) and read-only periods that are over (suspended).
 * Each change is claimed with a conditional update first, so a reminder or transition happens once even when
 * rounds overlap. `now` is for tests.
 */
export async function runTrialJob(now = new Date()): Promise<TrialJobResult> {
  const result: TrialJobResult = { reminded: 0, expired: 0, suspended: 0 };
  const notOperator = config.PLATFORM_OPERATOR_TENANT ? { NOT: { slug: config.PLATFORM_OPERATOR_TENANT } } : {};
  const select = { id: true, slug: true, name: true, customDomain: true, trialEndsAt: true, trialExpiredAt: true, trialRemindersSent: true } as const;

  // Reminders and expiry: running trials ending within a week.
  const running = await basePrisma.tenant.findMany({
    where: { status: 'TRIAL', trialExpiredAt: null, trialEndsAt: { not: null, lte: new Date(now.getTime() + 7 * DAY_MS) }, ...notOperator },
    select,
  });
  for (const t of running) {
    try {
      const endsAt = t.trialEndsAt!;
      if (endsAt <= now) {
        const done = await basePrisma.tenant.updateMany({ where: { id: t.id, status: 'TRIAL', trialExpiredAt: null, trialEndsAt: endsAt }, data: { trialExpiredAt: now } });
        if (done.count !== 1) continue;
        invalidateTenantSessions(t.id);
        result.expired++;
        const until = readOnlyUntil(now);
        await auditTrial(t.id, 'TRIAL_ENDED', { tenant: t.slug, trialEndsAt: iso(endsAt), readOnlyUntil: iso(until), by: 'SCHEDULE' });
        await mailAdmins(
          t,
          `Your trial of ${t.name} has ended`,
          `The trial of ${t.name} on the learning platform has ended. Everyone can still sign in and see their courses, records and certificates, and take their data out, but nothing can be changed. On ${formatDate(until)} the organisation will be suspended.\n\nTo continue, contact us.`
        );
        continue;
      }
      const left = endsAt.getTime() - now.getTime();
      const sent = t.trialRemindersSent;
      // One day before (which also stands for the week's reminder when the trial was shorter), else seven.
      const due = left <= DAY_MS ? (sent & REMINDER_1_DAY ? 0 : REMINDER_1_DAY | REMINDER_7_DAYS) : sent & REMINDER_7_DAYS ? 0 : REMINDER_7_DAYS;
      if (!due) continue;
      const claimed = await basePrisma.tenant.updateMany({ where: { id: t.id, status: 'TRIAL', trialExpiredAt: null, trialEndsAt: endsAt, trialRemindersSent: sent }, data: { trialRemindersSent: sent | due } });
      if (claimed.count !== 1) continue;
      const days = daysLeft(endsAt, now);
      const recipients = await mailAdmins(
        t,
        `Your trial of ${t.name} ends in ${days} day${days === 1 ? '' : 's'}`,
        `The trial of ${t.name} on the learning platform ends on ${formatDate(endsAt)}. After that the organisation becomes read-only for ${config.ORG_TRIAL_GRACE_DAYS} days and is then suspended.\n\nTo continue without interruption, contact us before then.`
      );
      result.reminded++;
      await auditTrial(t.id, 'TRIAL_REMINDER_SENT', { tenant: t.slug, daysLeft: days, trialEndsAt: iso(endsAt), recipients });
    } catch (err) {
      logger.error({ err, tenantId: t.id }, 'trial job failed for an organisation');
    }
  }

  // Read-only periods that are over.
  const cutoff = new Date(now.getTime() - config.ORG_TRIAL_GRACE_DAYS * DAY_MS);
  const lapsed = await basePrisma.tenant.findMany({ where: { status: 'TRIAL', trialExpiredAt: { not: null, lte: cutoff }, ...notOperator }, select });
  for (const t of lapsed) {
    try {
      const done = await basePrisma.tenant.updateMany({ where: { id: t.id, status: 'TRIAL', trialExpiredAt: t.trialExpiredAt }, data: { status: 'SUSPENDED' } });
      if (done.count !== 1) continue;
      invalidateTenantSessions(t.id);
      result.suspended++;
      await auditTrial(t.id, 'TENANT_SUSPENDED', { tenant: t.slug, before: 'TRIAL', after: 'SUSPENDED', reason: 'TRIAL_LAPSED', trialExpiredAt: iso(t.trialExpiredAt) });
      await mailAdmins(t, `${t.name} has been suspended`, `The trial of ${t.name} ended on ${formatDate(t.trialExpiredAt!)} and the organisation has now been suspended: nobody can sign in. Its data is kept. To continue, contact us.`);
    } catch (err) {
      logger.error({ err, tenantId: t.id }, 'trial job failed for an organisation');
    }
  }

  if (result.reminded || result.expired || result.suspended) logger.info({ ...result }, 'trial job');
  return result;
}

/** One round under the job lock: null when another process is running it. */
export const runTrialJobLocked = (now?: Date) => withJobLock(TRIAL_JOB, () => runTrialJob(now));

/** Starts the periodic trial job (every TRIAL_JOB_INTERVAL_SECONDS; one process at a time across the deployment). */
export const startTrialJob = () => startPeriodicJob(TRIAL_JOB, config.TRIAL_JOB_INTERVAL_SECONDS, () => runTrialJob());
