import { z } from 'zod';
import { runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma, prisma } from './prisma';
import { HttpError } from './http';
import { logAuditEvent } from './audit';
import { logger } from './logger';
import { startPeriodicJob, withJobLock } from './job-lock';
import { mailAdmins } from './trial';
import { idSchema } from './validate';

// The personal-data breach register (DPDP Act s.8(6)): every breach is logged with what was involved, how many
// people, what was done, and when the Data Protection Board and the affected people were told. The clock is 72
// hours from detection (`dueAt`); a job e-mails the administrators once when fewer than 24 hours are left and once
// when it has run out, while the Board has not been notified. A breach can only be closed once the Board was
// notified or a reason is given why it did not have to be. Every change is audited.

export const BREACH_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const BREACH_STATUSES = ['DETECTED', 'CONTAINED', 'NOTIFIED', 'CLOSED'] as const;
export const BREACH_NOTIFY_HOURS = 72;
export const BREACH_SOON_HOURS = 24;
export const BREACH_JOB = 'breach-clock';
const HOUR_MS = 60 * 60 * 1000;

export interface BreachContext {
  ipAddress?: string;
  userAgent?: string;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const when = z.coerce.date();

export const createBreachSchema = z.object({
  title: text(160),
  description: text(5000),
  /** Kinds of personal data involved, e.g. "contact details". */
  categories: z.array(text(80)).max(30).default([]),
  affectedEstimate: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  severity: z.enum(BREACH_SEVERITIES),
  /** When it was found (default: now); starts the 72-hour clock. Not in the future. */
  detectedAt: when.optional(),
  occurredAt: when.nullable().optional(),
  containment: text(5000).nullable().optional(),
  ownerId: idSchema.nullable().optional(),
});
export const updateBreachSchema = z
  .object({
    title: text(160),
    description: text(5000),
    categories: z.array(text(80)).max(30),
    affectedEstimate: z.number().int().min(0).max(1_000_000_000).nullable(),
    severity: z.enum(BREACH_SEVERITIES),
    occurredAt: when.nullable(),
    containment: text(5000).nullable(),
    ownerId: idSchema.nullable(),
    /** When the Data Protection Board was told. */
    boardNotifiedAt: when.nullable(),
    /** When the affected people were told. */
    peopleNotifiedAt: when.nullable(),
    /** Why neither had to be told (closing without notifying). */
    noNotificationReason: text(2000).nullable(),
    status: z.enum(BREACH_STATUSES),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change' });
export const breachQuerySchema = z.object({
  status: z.enum(['open', ...BREACH_STATUSES]).optional(),
  overdue: z.enum(['true', 'false']).optional(),
});

type Row = NonNullable<Awaited<ReturnType<typeof prisma.dataBreach.findFirst>>>;
const iso = (d: Date | null) => d?.toISOString() ?? null;
const formatDate = (d: Date) => d.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });

/** The Board has not been told and the deadline passed. */
const isOverdue = (b: Row, now: Date) => b.status !== 'CLOSED' && !b.boardNotifiedAt && b.dueAt.getTime() <= now.getTime();

export function breachView(b: Row, now = new Date()) {
  const clockRunning = b.status !== 'CLOSED' && !b.boardNotifiedAt;
  return {
    id: b.id,
    title: b.title,
    description: b.description,
    categories: b.categories,
    affectedEstimate: b.affectedEstimate,
    severity: b.severity,
    status: b.status,
    detectedAt: b.detectedAt.toISOString(),
    occurredAt: iso(b.occurredAt),
    containment: b.containment,
    ownerId: b.ownerId,
    boardNotifiedAt: iso(b.boardNotifiedAt),
    peopleNotifiedAt: iso(b.peopleNotifiedAt),
    noNotificationReason: b.noNotificationReason,
    closedAt: iso(b.closedAt),
    /** When the Board has to be told: 72 hours after detection. */
    dueAt: b.dueAt.toISOString(),
    /** Whole hours left on the clock (negative once overdue); null when it no longer runs. */
    hoursLeft: clockRunning ? Math.floor((b.dueAt.getTime() - now.getTime()) / HOUR_MS) : null,
    overdue: isOverdue(b, now),
    createdById: b.createdById,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

const audit = (tenantId: string, userId: string | null, action: string, id: string, diffJson: Record<string, unknown>, ctx: BreachContext = {}) =>
  logAuditEvent({ tenantId, userId, action, resourceType: 'DATA_BREACH', resourceId: id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, diffJson });

async function assertActiveAdmin(tenantId: string, userId: string) {
  const u = await prisma.user.findFirst({ where: { id: userId, tenantId, status: 'ACTIVE', erasedAt: null, role: { in: ['TENANT_ADMIN', 'SUPER_ADMIN'] } }, select: { id: true } });
  if (!u) throw new HttpError(400, 'The owner must be an active administrator of this organisation');
}

export async function createBreach(tenantId: string, admin: { id: string }, input: z.infer<typeof createBreachSchema>, ctx: BreachContext, now = new Date()) {
  const detectedAt = input.detectedAt ?? now;
  if (detectedAt.getTime() > now.getTime() + HOUR_MS) throw new HttpError(400, 'detectedAt cannot be in the future');
  if (input.occurredAt && input.occurredAt.getTime() > now.getTime() + HOUR_MS) throw new HttpError(400, 'occurredAt cannot be in the future');
  if (input.ownerId) await assertActiveAdmin(tenantId, input.ownerId);
  const b = await prisma.dataBreach.create({
    data: {
      tenantId, title: input.title, description: input.description, categories: input.categories, affectedEstimate: input.affectedEstimate ?? null, severity: input.severity,
      status: input.containment ? 'CONTAINED' : 'DETECTED', detectedAt, occurredAt: input.occurredAt ?? null, containment: input.containment ?? null, ownerId: input.ownerId ?? null,
      dueAt: new Date(detectedAt.getTime() + BREACH_NOTIFY_HOURS * HOUR_MS), createdById: admin.id,
    },
  });
  await audit(tenantId, admin.id, 'BREACH_REGISTERED', b.id, { severity: b.severity, detectedAt: iso(b.detectedAt), dueAt: iso(b.dueAt) }, ctx);
  return b;
}

export async function listBreaches(tenantId: string, f: { status?: string; overdue?: string }, now = new Date()) {
  const rows = await prisma.dataBreach.findMany({
    where: { tenantId, ...(f.status === 'open' ? { status: { not: 'CLOSED' } } : f.status ? { status: f.status } : {}) },
    orderBy: [{ detectedAt: 'desc' }],
    take: 500,
  });
  const filtered = f.overdue === undefined ? rows : rows.filter((b) => isOverdue(b, now) === (f.overdue === 'true'));
  return { rows: filtered, open: rows.filter((b) => b.status !== 'CLOSED').length, overdue: rows.filter((b) => isOverdue(b, now)).length };
}

export async function getBreach(tenantId: string, id: string) {
  const b = await prisma.dataBreach.findFirst({ where: { id, tenantId } });
  if (!b) throw new HttpError(404, 'Breach not found');
  return b;
}

/** Applies the changes; the status follows what was recorded (containment, notifications) unless given. */
export async function updateBreach(tenantId: string, id: string, admin: { id: string }, input: z.infer<typeof updateBreachSchema>, ctx: BreachContext, now = new Date()) {
  const b = await getBreach(tenantId, id);
  if (b.status === 'CLOSED') throw new HttpError(409, 'This breach is closed');
  const next = { ...input } as Record<string, unknown>;
  if (input.ownerId) await assertActiveAdmin(tenantId, input.ownerId);
  for (const k of ['boardNotifiedAt', 'peopleNotifiedAt', 'occurredAt'] as const) {
    const v = input[k];
    if (v && v.getTime() > now.getTime() + HOUR_MS) throw new HttpError(400, `${k} cannot be in the future`);
  }
  const boardNotifiedAt = input.boardNotifiedAt !== undefined ? input.boardNotifiedAt : b.boardNotifiedAt;
  const noReason = input.noNotificationReason !== undefined ? input.noNotificationReason : b.noNotificationReason;
  const containment = input.containment !== undefined ? input.containment : b.containment;

  let status = input.status ?? b.status;
  if (input.status === undefined) {
    if (boardNotifiedAt && (b.status === 'DETECTED' || b.status === 'CONTAINED')) status = 'NOTIFIED';
    else if (containment && b.status === 'DETECTED') status = 'CONTAINED';
  }
  if (status === 'NOTIFIED' && !boardNotifiedAt) throw new HttpError(400, 'Record when the Board was notified (boardNotifiedAt) first');
  if (status === 'CLOSED') {
    if (!boardNotifiedAt && !noReason) throw new HttpError(400, 'Record when the Board was notified, or why no notification was needed, before closing');
    next.closedAt = now;
  }
  next.status = status;

  const done = await prisma.dataBreach.updateMany({ where: { id, tenantId, status: b.status }, data: next as any });
  if (done.count !== 1) throw new HttpError(409, 'The breach changed meanwhile; reload it');
  const after = await getBreach(tenantId, id);
  const changed = Object.keys(input);
  await audit(tenantId, admin.id, status === 'CLOSED' ? 'BREACH_CLOSED' : 'BREACH_UPDATED', id, {
    fields: changed,
    status: { before: b.status, after: status },
    boardNotifiedAt: iso(after.boardNotifiedAt),
    peopleNotifiedAt: iso(after.peopleNotifiedAt),
  }, ctx);
  return after;
}

// --------------------------------------------------------------------------- the clock

export interface BreachJobResult {
  dueSoon: number;
  overdue: number;
}

/**
 * One round: for each organisation the administrators are e-mailed once about breaches whose Board notification is
 * due within 24 hours and once about those past it. Each warning is claimed with a conditional update first, so
 * overlapping rounds never send it twice. `now` is for tests.
 */
export async function runBreachJob(now = new Date()): Promise<BreachJobResult> {
  const result: BreachJobResult = { dueSoon: 0, overdue: 0 };
  const tenants = await basePrisma.tenant.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL'] } }, select: { id: true, name: true, slug: true, customDomain: true } });
  for (const t of tenants) {
    try {
      await runWithTenant(t.id, async () => {
        for (const stage of [2, 1] as const) {
          const due = stage === 1 ? { gt: now, lte: new Date(now.getTime() + BREACH_SOON_HOURS * HOUR_MS) } : { lte: now };
          const open = { tenantId: t.id, status: { not: 'CLOSED' }, boardNotifiedAt: null, reminderStage: { lt: stage } };
          const candidates = await prisma.dataBreach.findMany({ where: { ...open, dueAt: due }, orderBy: { dueAt: 'asc' } });
          const claimed: Row[] = [];
          for (const b of candidates) {
            const c = await prisma.dataBreach.updateMany({ where: { id: b.id, ...open }, data: { reminderStage: stage } });
            if (c.count === 1) claimed.push(b);
          }
          if (claimed.length === 0) continue;
          const lines = claimed.map((b) => `- ${b.title} (${b.severity.toLowerCase()}), Board notification due ${formatDate(b.dueAt)}`).join('\n');
          await mailAdmins(
            t,
            stage === 1 ? `Breach notification due within ${BREACH_SOON_HOURS} hours` : `Breach notification deadline passed`,
            stage === 1
              ? `The Data Protection Board has to be told about:\n\n${lines}\n\nRecord the notification under Security & compliance, or close the breach with the reason none was needed.`
              : `The ${BREACH_NOTIFY_HOURS}-hour deadline to notify the Data Protection Board has passed for:\n\n${lines}\n\nNotify the Board without further delay and record it under Security & compliance.`
          );
          for (const b of claimed) await audit(t.id, null, 'BREACH_REMINDER_SENT', b.id, { stage: stage === 1 ? 'DUE_SOON' : 'OVERDUE', dueAt: iso(b.dueAt) });
          if (stage === 1) result.dueSoon += claimed.length;
          else result.overdue += claimed.length;
        }
      });
    } catch (err) {
      logger.error({ err, tenantId: t.id }, 'breach clock job failed for an organisation');
    }
  }
  if (result.dueSoon || result.overdue) logger.info({ ...result }, 'breach clock job');
  return result;
}

/** One round under the job lock: null when another process is running it. */
export const runBreachJobLocked = (now?: Date) => withJobLock(BREACH_JOB, () => runBreachJob(now));

/** Starts the periodic job (every BREACH_JOB_INTERVAL_SECONDS; one process at a time across the deployment). */
export const startBreachJob = () => startPeriodicJob(BREACH_JOB, config.BREACH_JOB_INTERVAL_SECONDS, () => runBreachJob());
