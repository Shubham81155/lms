import { runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma, prisma } from './prisma';
import { HttpError } from './http';
import { logAuditEvent } from './audit';
import { logger } from './logger';
import { mailDelivers, sendMail } from './mailer';
import { startPeriodicJob, withJobLock } from './job-lock';
import { tenantUrl } from './tenant-url';
import { mailAdmins } from './trial';
import { eraseUser, erasureBlocker, ERASED_NAME } from './privacy';

// Data-subject requests: a person asks about their own data (GDPR Art. 15-21, FERPA) and the organisation answers
// within DSAR_DUE_DAYS. Anyone can file one (and cancel it while it is open); administrators work the queue: take
// it, fulfil or reject it with a reason. Fulfilling carries out what the kind allows (an access request gets the
// person's data attached, an erasure request erases the account, a directory opt-out is applied); the rest is
// answered in words. Every step is audited and the person is e-mailed. A daily job warns the administrators of
// requests due within five days and of overdue ones, once per request and stage.

export const REQUEST_KINDS = ['ACCESS', 'ERASURE', 'CORRECTION', 'RESTRICTION', 'OBJECTION', 'FERPA_OPT_OUT', 'OTHER'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const KIND_LABEL: Record<RequestKind, string> = {
  ACCESS: 'access to my data',
  ERASURE: 'erasure of my data',
  CORRECTION: 'correction of my data',
  RESTRICTION: 'restriction of processing',
  OBJECTION: 'objection to processing',
  FERPA_OPT_OUT: 'hiding my name from classmates',
  OTHER: 'another data request',
};

export const REQUEST_STATUSES = ['OPEN', 'IN_PROGRESS', 'FULFILLED', 'REJECTED', 'CANCELLED'] as const;
export const OPEN_STATUSES = ['OPEN', 'IN_PROGRESS'];
/** Open requests one person may have at a time. */
export const MAX_OPEN_PER_PERSON = 5;
/** Administrators are warned this long before a deadline. */
export const DUE_SOON_DAYS = 5;
export const DSAR_JOB = 'dsar-reminders';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

type Row = NonNullable<Awaited<ReturnType<typeof prisma.dataRequest.findFirst>>>;

const iso = (d: Date | null) => d?.toISOString() ?? null;
const formatDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const dueAtFor = (from: Date) => new Date(from.getTime() + config.DSAR_DUE_DAYS * DAY_MS);

/** A request as the API shows it. Internal notes are for administrators only. */
export function requestView(r: Row, opts: { admin?: boolean; requester?: { email: string; firstName: string; lastName: string; erasedAt: Date | null } | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const open = OPEN_STATUSES.includes(r.status);
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    details: r.details,
    receivedAt: r.receivedAt.toISOString(),
    dueAt: r.dueAt.toISOString(),
    /** Whole days to the deadline (negative once overdue); null for a closed request. */
    daysLeft: open ? Math.ceil((r.dueAt.getTime() - now.getTime()) / DAY_MS) : null,
    overdue: open && r.dueAt <= now,
    resolution: r.resolution,
    /** The person can download their data from this request (access requests fulfilled with it attached). */
    exportAttached: r.exportAttached,
    closedAt: iso(r.closedAt),
    ...(opts.admin
      ? {
          requesterId: r.requesterId,
          requester: opts.requester
            ? opts.requester.erasedAt
              ? { name: ERASED_NAME, email: null }
              : { name: `${opts.requester.firstName} ${opts.requester.lastName}`.trim(), email: opts.requester.email }
            : null,
          assignedToId: r.assignedToId,
          notes: r.notes,
          closedById: r.closedById,
        }
      : {}),
  };
}

const requesterSelect = { id: true, email: true, firstName: true, lastName: true, erasedAt: true } as const;

async function tenantOf(tenantId: string) {
  const t = await basePrisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, slug: true, customDomain: true } });
  if (!t) throw new HttpError(404, 'Organisation not found');
  return t;
}

/** E-mails the person about their request. Problems are logged, never thrown. */
async function mailRequester(tenantId: string, to: { email: string; firstName: string }, subject: string, body: string): Promise<void> {
  if (!mailDelivers()) return;
  try {
    const t = await tenantOf(tenantId);
    await sendMail({ to: to.email, subject, text: `Hello ${to.firstName},\n\n${body}\n\n${t.name}\n${tenantUrl(t)}` });
  } catch (err) {
    logger.warn({ err, tenantId }, 'could not e-mail a data-request requester');
  }
}

const audit = (tenantId: string, userId: string | null, action: string, requestId: string, diffJson: Record<string, unknown>, ctx: RequestContext = {}) =>
  logAuditEvent({ tenantId, userId, action, resourceType: 'DATA_REQUEST', resourceId: requestId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, diffJson });

// --------------------------------------------------------------------------- the person's side

export async function fileRequest(tenantId: string, who: { id: string; email: string; firstName: string }, input: { kind: RequestKind; details?: string }, ctx: RequestContext, now = new Date()) {
  const open = await prisma.dataRequest.count({ where: { tenantId, requesterId: who.id, status: { in: OPEN_STATUSES } } });
  if (open >= MAX_OPEN_PER_PERSON) throw new HttpError(409, `You already have ${MAX_OPEN_PER_PERSON} open requests; wait for an answer or cancel one`);
  const sameKind = await prisma.dataRequest.count({ where: { tenantId, requesterId: who.id, kind: input.kind, status: { in: OPEN_STATUSES } } });
  if (sameKind > 0) throw new HttpError(409, 'You already have an open request of this kind');
  const r = await prisma.dataRequest.create({
    data: { tenantId, requesterId: who.id, kind: input.kind, details: input.details?.trim() || null, receivedAt: now, dueAt: dueAtFor(now) },
  });
  await audit(tenantId, who.id, 'DATA_REQUEST_FILED', r.id, { kind: r.kind, dueAt: iso(r.dueAt) }, ctx);
  const label = KIND_LABEL[input.kind as RequestKind];
  await mailRequester(tenantId, who, 'We received your data request', `We received your request for ${label}. We will answer by ${formatDate(r.dueAt)}. You can follow it, or cancel it while it is open, under "Security & privacy".`);
  const t = await tenantOf(tenantId);
  await mailAdmins(t, `New data request: ${r.kind.toLowerCase().replace(/_/g, ' ')}`, `${who.firstName} (${who.email}) filed a request for ${label}. It is due on ${formatDate(r.dueAt)}. Handle it under Security & compliance in the administration area.`);
  return r;
}

export const myRequests = (tenantId: string, userId: string) =>
  prisma.dataRequest.findMany({ where: { tenantId, requesterId: userId }, orderBy: { receivedAt: 'desc' }, take: 50 });

export async function cancelRequest(tenantId: string, id: string, userId: string, ctx: RequestContext, now = new Date()) {
  const r = await prisma.dataRequest.findFirst({ where: { id, tenantId, requesterId: userId } });
  if (!r) throw new HttpError(404, 'Request not found');
  const done = await prisma.dataRequest.updateMany({ where: { id, tenantId, requesterId: userId, status: { in: OPEN_STATUSES } }, data: { status: 'CANCELLED', closedAt: now, closedById: userId } });
  if (done.count !== 1) throw new HttpError(409, 'This request is already closed');
  await audit(tenantId, userId, 'DATA_REQUEST_CANCELLED', id, { kind: r.kind, before: r.status }, ctx);
  return prisma.dataRequest.findFirstOrThrow({ where: { id, tenantId } });
}

// --------------------------------------------------------------------------- the administrators' queue

export interface QueueFilter {
  status?: string;
  kind?: string;
  /** Only open requests past their deadline. */
  overdue?: boolean;
  /** Only open requests assigned to this administrator. */
  assignedToId?: string;
  page: number;
  limit: number;
}

export async function listRequests(tenantId: string, f: QueueFilter, now = new Date()) {
  const where = {
    tenantId,
    ...(f.status === 'open' ? { status: { in: OPEN_STATUSES } } : f.status ? { status: f.status } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.overdue ? { status: { in: OPEN_STATUSES }, dueAt: { lte: now } } : {}),
    ...(f.assignedToId ? { assignedToId: f.assignedToId } : {}),
  };
  const [rows, total] = await Promise.all([
    // Open requests first, the most urgent on top; closed ones by recency.
    prisma.dataRequest.findMany({ where, orderBy: [{ dueAt: 'asc' }], skip: (f.page - 1) * f.limit, take: f.limit }),
    prisma.dataRequest.count({ where }),
  ]);
  const people = await prisma.user.findMany({ where: { tenantId, id: { in: [...new Set(rows.map((r) => r.requesterId))] } }, select: requesterSelect });
  const byId = new Map(people.map((p) => [p.id, p]));
  const open = await prisma.dataRequest.count({ where: { tenantId, status: { in: OPEN_STATUSES } } });
  const overdue = await prisma.dataRequest.count({ where: { tenantId, status: { in: OPEN_STATUSES }, dueAt: { lte: now } } });
  return { rows: rows.map((r) => requestView(r, { admin: true, requester: byId.get(r.requesterId) ?? null, now })), total, open, overdue };
}

async function openRequestFor(tenantId: string, id: string, admin: { id: string }) {
  const r = await prisma.dataRequest.findFirst({ where: { id, tenantId } });
  if (!r) throw new HttpError(404, 'Request not found');
  if (!OPEN_STATUSES.includes(r.status)) throw new HttpError(409, 'This request is already closed');
  // Whoever filed it cannot also be the one who decides it.
  if (r.requesterId === admin.id) throw new HttpError(403, 'Another administrator has to handle a request you filed yourself');
  return r;
}

/** Takes a request (or hands it to another administrator), or edits its internal notes. A first assignment starts the work. */
export async function updateRequest(tenantId: string, id: string, admin: { id: string }, input: { assignedToId?: string | null; notes?: string | null }, ctx: RequestContext) {
  const r = await openRequestFor(tenantId, id, admin);
  const data: Record<string, unknown> = {};
  if (input.assignedToId !== undefined) {
    if (input.assignedToId !== null) {
      const to = await prisma.user.findFirst({ where: { id: input.assignedToId, tenantId, role: { in: ['TENANT_ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE', erasedAt: null }, select: { id: true } });
      if (!to) throw new HttpError(400, 'The request can only be assigned to an active administrator');
      if (to.id === r.requesterId) throw new HttpError(400, 'A request cannot be assigned to the person who filed it');
    }
    data.assignedToId = input.assignedToId;
    data.status = input.assignedToId === null ? 'OPEN' : 'IN_PROGRESS';
  }
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
  const done = await prisma.dataRequest.updateMany({ where: { id, tenantId, status: { in: OPEN_STATUSES } }, data });
  if (done.count !== 1) throw new HttpError(409, 'This request is already closed');
  if (input.assignedToId !== undefined) await audit(tenantId, admin.id, 'DATA_REQUEST_ASSIGNED', id, { kind: r.kind, assignedToId: input.assignedToId, before: r.assignedToId }, ctx);
  if (input.notes !== undefined) await audit(tenantId, admin.id, 'DATA_REQUEST_NOTE_CHANGED', id, { kind: r.kind }, ctx);
  const after = await prisma.dataRequest.findFirstOrThrow({ where: { id, tenantId } });
  // First time it moves to IN_PROGRESS: tell the person it is being worked on.
  if (r.status === 'OPEN' && after.status === 'IN_PROGRESS') {
    const who = await prisma.user.findFirst({ where: { id: r.requesterId, tenantId, erasedAt: null }, select: requesterSelect });
    if (who) await mailRequester(tenantId, who, 'Your data request is being handled', `An administrator has taken up your request for ${KIND_LABEL[r.kind as RequestKind] ?? 'your data'}. We will answer by ${formatDate(r.dueAt)}.`);
  }
  return after;
}

export interface FulfilInput {
  /** The answer the person receives. */
  resolution?: string;
  /** ACCESS: attach the person's data to the request for download (the default). */
  attachExport?: boolean;
}

export async function fulfilRequest(tenantId: string, id: string, admin: { id: string }, input: FulfilInput, ctx: RequestContext, now = new Date()) {
  const r = await openRequestFor(tenantId, id, admin);
  const kind = r.kind as RequestKind;
  const who = await prisma.user.findFirst({ where: { id: r.requesterId, tenantId }, select: requesterSelect });
  if (!who) throw new HttpError(409, 'The person who filed this request no longer exists in this organisation');
  if (who.erasedAt && kind !== 'ERASURE') throw new HttpError(409, 'The person who filed this request has been erased; reject it instead');
  if (kind === 'ERASURE' && !who.erasedAt) {
    const blocker = await erasureBlocker(who.id, tenantId);
    if (blocker) throw new HttpError(409, blocker);
  }
  if (kind === 'OTHER' && !input.resolution?.trim()) throw new HttpError(400, 'Say in the resolution how this request was answered');
  const exportAttached = kind === 'ACCESS' && input.attachExport !== false;
  const resolution = input.resolution?.trim() || defaultResolution(kind, exportAttached);

  // Claim it first (so two administrators cannot both close it), then do what the kind calls for.
  const claim = await prisma.dataRequest.updateMany({
    where: { id, tenantId, status: { in: OPEN_STATUSES } },
    data: { status: 'FULFILLED', resolution, exportAttached, closedAt: now, closedById: admin.id },
  });
  if (claim.count !== 1) throw new HttpError(409, 'This request is already closed');
  try {
    if (kind === 'ERASURE' && !who.erasedAt) {
      await eraseUser(who.id, tenantId);
      await logAuditEvent({ tenantId, userId: admin.id, action: 'USER_ERASED', resourceType: 'USER', resourceId: who.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, diffJson: { requestedBy: 'data-request', requestId: id } });
    }
    if (kind === 'FERPA_OPT_OUT') await prisma.user.update({ where: { id: who.id }, data: { directoryOptOut: true } });
  } catch (err) {
    await prisma.dataRequest.updateMany({ where: { id, tenantId, status: 'FULFILLED' }, data: { status: r.status, resolution: null, exportAttached: false, closedAt: null, closedById: null } });
    throw err;
  }
  await audit(tenantId, admin.id, 'DATA_REQUEST_FULFILLED', id, { kind, exportAttached }, ctx);
  // `who` was read before any erasure, so the confirmation still reaches an address that is erased by now.
  if (!who.erasedAt) {
    await mailRequester(tenantId, who, 'Your data request has been answered', `Your request for ${KIND_LABEL[kind]} has been completed.\n\n${resolution}${exportAttached ? '\n\nYou can download your data from the request, under "Security & privacy".' : ''}`);
  }
  return prisma.dataRequest.findFirstOrThrow({ where: { id, tenantId } });
}

function defaultResolution(kind: RequestKind, exportAttached: boolean): string {
  switch (kind) {
    case 'ACCESS':
      return exportAttached ? 'The data we hold about you is attached to this request.' : 'We have answered your access request.';
    case 'ERASURE':
      return 'Your account has been erased. Grades and scores stay on record without identifying you.';
    case 'FERPA_OPT_OUT':
      return 'Your name is now hidden from classmates.';
    default:
      return 'We have completed your request.';
  }
}

export async function rejectRequest(tenantId: string, id: string, admin: { id: string }, reason: string, ctx: RequestContext, now = new Date()) {
  const r = await openRequestFor(tenantId, id, admin);
  const claim = await prisma.dataRequest.updateMany({
    where: { id, tenantId, status: { in: OPEN_STATUSES } },
    data: { status: 'REJECTED', resolution: reason.trim(), closedAt: now, closedById: admin.id },
  });
  if (claim.count !== 1) throw new HttpError(409, 'This request is already closed');
  await audit(tenantId, admin.id, 'DATA_REQUEST_REJECTED', id, { kind: r.kind, before: r.status }, ctx);
  const who = await prisma.user.findFirst({ where: { id: r.requesterId, tenantId, erasedAt: null }, select: requesterSelect });
  if (who) await mailRequester(tenantId, who, 'Your data request has been declined', `We could not carry out your request for ${KIND_LABEL[r.kind as RequestKind] ?? 'your data'}.\n\nReason: ${reason.trim()}\n\nIf you disagree, you can contact the organisation or the data protection authority.`);
  return prisma.dataRequest.findFirstOrThrow({ where: { id, tenantId } });
}

// --------------------------------------------------------------------------- the reminder job

export interface DsarJobResult {
  dueSoon: number;
  overdue: number;
}

/**
 * One round: for every organisation, the administrators are e-mailed once about requests that came within
 * DUE_SOON_DAYS of their deadline and once about requests that passed it. Each warning is claimed with a
 * conditional update first, so overlapping rounds never send it twice. `now` is for tests.
 */
export async function runDsarJob(now = new Date()): Promise<DsarJobResult> {
  const result: DsarJobResult = { dueSoon: 0, overdue: 0 };
  const tenants = await basePrisma.tenant.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL'] } }, select: { id: true, name: true, slug: true, customDomain: true } });
  for (const t of tenants) {
    try {
      await runWithTenant(t.id, async () => {
        for (const stage of [2, 1] as const) {
          const due = stage === 1 ? { gt: now, lte: new Date(now.getTime() + DUE_SOON_DAYS * DAY_MS) } : { lte: now };
          const candidates = await prisma.dataRequest.findMany({ where: { tenantId: t.id, status: { in: OPEN_STATUSES }, reminderStage: { lt: stage }, dueAt: due }, orderBy: { dueAt: 'asc' } });
          const claimed: Row[] = [];
          for (const r of candidates) {
            const c = await prisma.dataRequest.updateMany({ where: { id: r.id, tenantId: t.id, status: { in: OPEN_STATUSES }, reminderStage: { lt: stage } }, data: { reminderStage: stage } });
            if (c.count === 1) claimed.push(r);
          }
          if (claimed.length === 0) continue;
          const lines = claimed.map((r) => `- ${r.kind.toLowerCase().replace(/_/g, ' ')}, due ${formatDate(r.dueAt)}`).join('\n');
          await mailAdmins(
            t,
            stage === 1 ? `${claimed.length} data request${claimed.length === 1 ? '' : 's'} due within ${DUE_SOON_DAYS} days` : `${claimed.length} data request${claimed.length === 1 ? ' is' : 's are'} overdue`,
            stage === 1
              ? `These requests need an answer soon:\n\n${lines}\n\nHandle them under Security & compliance.`
              : `These requests are past their deadline:\n\n${lines}\n\nAnswer them as soon as possible: the person and the supervisory authority may hold the organisation to the deadline.`
          );
          for (const r of claimed) await audit(t.id, null, 'DATA_REQUEST_REMINDER_SENT', r.id, { kind: r.kind, stage: stage === 1 ? 'DUE_SOON' : 'OVERDUE', dueAt: iso(r.dueAt) });
          if (stage === 1) result.dueSoon += claimed.length;
          else result.overdue += claimed.length;
        }
      });
    } catch (err) {
      logger.error({ err, tenantId: t.id }, 'data-request job failed for an organisation');
    }
  }
  if (result.dueSoon || result.overdue) logger.info({ ...result }, 'data-request job');
  return result;
}

/** One round under the job lock: null when another process is running it. */
export const runDsarJobLocked = (now?: Date) => withJobLock(DSAR_JOB, () => runDsarJob(now));

/** Starts the periodic job (every DSAR_JOB_INTERVAL_SECONDS; one process at a time across the deployment). */
export const startDsarJob = () => startPeriodicJob(DSAR_JOB, config.DSAR_JOB_INTERVAL_SECONDS, () => runDsarJob());
