import { runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma, prisma, runInTenantTransaction } from './prisma';
import { HttpError } from './http';
import { logger } from './logger';
import { logAuditEvent } from './audit';
import { mailDelivers, sendMail } from './mailer';
import { startPeriodicJob, withJobLock } from './job-lock';
import { storage } from './storage';
import { tenantUrl } from './tenant-url';
import { operatorTenant } from './organizations';
import { buildExport, countRows, storedFilesOf, unlinkedTenantDelegates } from './tenant-export';

// Organisation offboarding. Administrators (or the platform operator) can take a full export at any time
// (lib/tenant-export.ts), and schedule the organisation's deletion ORG_DELETION_GRACE_DAYS ahead. The organisation
// stays usable until then and the deletion can be cancelled (one the operator scheduled only by the operator).
// When it is due, the background job takes a final export (kept for the operator), deletes every row and stored
// file of the organisation, and leaves a TenantDeletion tombstone that keeps its address reserved for
// ORG_DELETED_SLUG_HOLD_DAYS. The platform operator's own organisation can never be deleted.
//
// The audit trail is append-only for the runtime role (UPDATE/DELETE revoked on "AuditLog"). The organisation's audit
// rows go with it through the ON DELETE CASCADE from "Tenant": foreign-key actions run with the table owner's rights,
// so the API never deletes audit rows itself and the grant stays revoked. The rows are in the final export, and the
// request, schedule, cancel and deletion are recorded in the platform operator's trail too, which survives.

export const OFFBOARDING_JOB = 'offboarding';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface OffboardingActor {
  tenantId: string;
  userId: string;
  email: string;
  /** The platform operator acting on any organisation. */
  operator: boolean;
  ipAddress?: string;
  userAgent?: string;
}

type ExportRow = {
  id: string; tenantId: string; status: string; isFinal: boolean; sizeBytes: bigint | null; error: string | null;
  createdAt: Date; completedAt: Date | null; expiresAt: Date | null; requestedById: string | null;
};

/** An export as the API shows it. Failure details stay in the log. */
export const exportView = (e: ExportRow) => ({
  id: e.id,
  tenantId: e.tenantId,
  status: e.status as 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED',
  isFinal: e.isFinal,
  sizeBytes: e.sizeBytes === null ? null : Number(e.sizeBytes),
  createdAt: e.createdAt,
  completedAt: e.completedAt,
  expiresAt: e.expiresAt,
  error: e.status === 'FAILED' ? 'The export could not be built. Please try again.' : null,
});

export const isOperatorSlug = (slug: string) => !!config.PLATFORM_OPERATOR_TENANT && slug === config.PLATFORM_OPERATOR_TENANT;

/** Audits in the organisation's trail, and in the operator's when the operator acted. */
async function audit(actor: OffboardingActor | null, tenantId: string, action: string, diffJson: Record<string, unknown>) {
  const entry = { action, resourceType: 'TENANT', resourceId: tenantId, ipAddress: actor?.ipAddress, userAgent: actor?.userAgent, diffJson: { ...diffJson, by: actor ? (actor.operator ? 'PLATFORM_OPERATOR' : 'ADMINISTRATOR') : 'SYSTEM' } };
  const ownTrail = !actor || actor.tenantId === tenantId;
  await runWithTenant(tenantId, () => logAuditEvent({ ...entry, tenantId, userId: ownTrail ? actor?.userId : undefined }));
  if (actor && !ownTrail) await runWithTenant(actor.tenantId, () => logAuditEvent({ ...entry, tenantId: actor.tenantId, userId: actor.userId }));
}

async function adminEmails(tenantId: string): Promise<string[]> {
  const admins = await runWithTenant(tenantId, () =>
    prisma.user.findMany({ where: { tenantId, role: { in: ['TENANT_ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE', erasedAt: null }, select: { email: true } })
  );
  return admins.map((a) => a.email);
}

async function mailAll(to: string[], subject: string, text: string, tenantId: string) {
  if (!mailDelivers()) return;
  for (const address of to) {
    await sendMail({ to: address, subject, text }).catch((err) => logger.warn({ err, tenantId }, 'could not e-mail an administrator about offboarding'));
  }
}

const longDate = (d: Date) => d.toUTCString().replace(/ \d\d:\d\d:\d\d GMT$/, '');

// --------------------------------------------------------------------------- exports

/** Queues a full export. 409 while one is already waiting or being built. */
export async function requestExport(tenantId: string, actor: OffboardingActor) {
  const tenant = await basePrisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, slug: true } });
  if (!tenant) throw new HttpError(404, 'Organisation not found');
  const busy = await basePrisma.tenantExport.findFirst({ where: { tenantId, isFinal: false, status: { in: ['QUEUED', 'RUNNING'] } }, select: { id: true } });
  if (busy) throw new HttpError(409, 'An export is already being prepared');
  const created = await basePrisma.tenantExport.create({ data: { tenantId, requestedById: actor.userId, requestedByTenantId: actor.tenantId } });
  await audit(actor, tenantId, 'TENANT_EXPORT_REQUESTED', { tenant: tenant.slug, exportId: created.id });
  kickOffboardingJob();
  return exportView(created);
}

/** The organisation's exports, newest first (final ones only for the operator). */
export async function listExports(tenantId: string, opts: { includeFinal: boolean }) {
  const rows = await basePrisma.tenantExport.findMany({
    where: { tenantId, ...(opts.includeFinal ? {} : { isFinal: false }) },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return rows.map(exportView);
}

/** A READY export that this caller may download, or 404. Administrators: their organisation's ordinary exports. */
export async function downloadableExport(exportId: string, who: { tenantId: string; operator: boolean }) {
  const e = await basePrisma.tenantExport.findUnique({ where: { id: exportId } });
  if (!e || (!who.operator && (e.tenantId !== who.tenantId || e.isFinal))) throw new HttpError(404, 'Export not found');
  if (e.status === 'EXPIRED' || (e.expiresAt && e.expiresAt.getTime() <= Date.now())) throw new HttpError(410, 'This export has expired. Request a new one.');
  if (e.status !== 'READY' || !e.storageKey) throw new HttpError(409, 'This export is not ready yet');
  return e;
}

/** Audits a download (in the organisation's trail; the tombstone's operator trail for a deleted one). */
export async function auditDownload(e: { id: string; tenantId: string; isFinal: boolean }, actor: OffboardingActor) {
  const exists = await basePrisma.tenant.findUnique({ where: { id: e.tenantId }, select: { id: true } });
  const entry = { action: 'TENANT_EXPORT_DOWNLOADED', resourceType: 'TENANT', resourceId: e.tenantId, ipAddress: actor.ipAddress, userAgent: actor.userAgent, diffJson: { exportId: e.id, isFinal: e.isFinal } };
  if (exists) await runWithTenant(e.tenantId, () => logAuditEvent({ ...entry, tenantId: e.tenantId, userId: actor.tenantId === e.tenantId ? actor.userId : undefined }));
  if (actor.tenantId !== e.tenantId || !exists) await runWithTenant(actor.tenantId, () => logAuditEvent({ ...entry, tenantId: actor.tenantId, userId: actor.userId }));
}

// --------------------------------------------------------------------------- scheduled deletion

export async function offboardingState(tenantId: string, opts: { operator: boolean }) {
  const t = await basePrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, slug: true, name: true, deletionScheduledAt: true, deletionRequestedAt: true, deletionRequestedBy: true, deletionByOperator: true },
  });
  if (!t) throw new HttpError(404, 'Organisation not found');
  return {
    tenantId: t.id,
    slug: t.slug,
    name: t.name,
    /** The platform operator's own organisation cannot be deleted. */
    deletable: !isOperatorSlug(t.slug),
    graceDays: config.ORG_DELETION_GRACE_DAYS,
    deletion: t.deletionScheduledAt
      ? {
          scheduledAt: t.deletionScheduledAt,
          requestedAt: t.deletionRequestedAt,
          requestedBy: t.deletionRequestedBy,
          byOperator: t.deletionByOperator,
          canCancel: opts.operator || !t.deletionByOperator,
        }
      : null,
    exports: await listExports(tenantId, { includeFinal: opts.operator }),
  };
}

/** Schedules the organisation's deletion; `confirmSlug` must be its address. Administrators are e-mailed. */
export async function scheduleDeletion(tenantId: string, confirmSlug: string, actor: OffboardingActor) {
  const t = await basePrisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, slug: true, name: true, customDomain: true, deletionScheduledAt: true } });
  if (!t) throw new HttpError(404, 'Organisation not found');
  if (isOperatorSlug(t.slug)) throw new HttpError(409, "The platform operator's organisation cannot be deleted");
  if (confirmSlug.trim().toLowerCase() !== t.slug) throw new HttpError(400, `Type the organisation's address, ${t.slug}, to confirm`);
  if (t.deletionScheduledAt) throw new HttpError(409, 'The deletion is already scheduled');

  const now = new Date();
  const scheduledAt = new Date(now.getTime() + config.ORG_DELETION_GRACE_DAYS * DAY_MS);
  const updated = await basePrisma.tenant.updateMany({
    where: { id: tenantId, deletionScheduledAt: null },
    data: {
      deletionScheduledAt: scheduledAt,
      deletionRequestedAt: now,
      deletionRequestedBy: `${actor.email} (${actor.operator ? 'platform operator' : 'administrator'})`,
      deletionByOperator: actor.operator,
    },
  });
  if (!updated.count) throw new HttpError(409, 'The deletion is already scheduled');
  await audit(actor, tenantId, 'TENANT_DELETION_SCHEDULED', { tenant: t.slug, scheduledAt });

  const who = actor.operator ? 'the platform operator' : actor.email;
  await mailAll(
    await adminEmails(tenantId),
    `${t.name} will be deleted on ${longDate(scheduledAt)}`,
    `Hello,\n\n${who} has scheduled ${t.name} and all its data (people, courses, grades, files) for deletion on ${scheduledAt.toUTCString()}.\n\nUntil then the organisation works as usual. To keep a copy of the data, request a full export in the admin area; to stop the deletion, cancel it there${actor.operator ? ' (a deletion the platform operator scheduled can only be cancelled by the operator: reply to your platform provider)' : ''}:\n\n${tenantUrl(t)}/admin\n\nAfter the deletion nothing can be recovered.`,
    tenantId
  );
  return offboardingState(tenantId, { operator: actor.operator });
}

/** Cancels a scheduled deletion. Only the operator cancels one the operator scheduled. */
export async function cancelDeletion(tenantId: string, actor: OffboardingActor) {
  const t = await basePrisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, slug: true, name: true, deletionScheduledAt: true, deletionByOperator: true } });
  if (!t) throw new HttpError(404, 'Organisation not found');
  if (!t.deletionScheduledAt) throw new HttpError(409, 'No deletion is scheduled');
  if (t.deletionByOperator && !actor.operator) throw new HttpError(403, 'The platform operator scheduled this deletion; only the operator can cancel it');
  const cleared = await basePrisma.tenant.updateMany({
    where: { id: tenantId, deletionScheduledAt: t.deletionScheduledAt },
    data: { deletionScheduledAt: null, deletionRequestedAt: null, deletionRequestedBy: null, deletionByOperator: false },
  });
  if (!cleared.count) throw new HttpError(409, 'The deletion has changed meanwhile; reload and try again');
  await audit(actor, tenantId, 'TENANT_DELETION_CANCELLED', { tenant: t.slug, wasScheduledAt: t.deletionScheduledAt });
  await mailAll(
    await adminEmails(tenantId),
    `The deletion of ${t.name} has been cancelled`,
    `Hello,\n\n${actor.operator ? 'The platform operator' : actor.email} has cancelled the deletion of ${t.name} that was scheduled for ${t.deletionScheduledAt.toUTCString()}. Nothing will be deleted.`,
    tenantId
  );
  return offboardingState(tenantId, { operator: actor.operator });
}

/** For the operator: deletions waiting, and organisations already deleted with their final export. */
export async function offboardingOverview() {
  const [scheduled, deleted] = await Promise.all([
    basePrisma.tenant.findMany({
      where: { deletionScheduledAt: { not: null } },
      orderBy: { deletionScheduledAt: 'asc' },
      select: { id: true, slug: true, name: true, deletionScheduledAt: true, deletionRequestedBy: true, deletionByOperator: true },
    }),
    basePrisma.tenantDeletion.findMany({ orderBy: { deletedAt: 'desc' }, take: 100 }),
  ]);
  const finals = await basePrisma.tenantExport.findMany({ where: { id: { in: deleted.flatMap((d) => (d.finalExportId ? [d.finalExportId] : [])) } } });
  return {
    scheduled: scheduled.map((t) => ({ tenantId: t.id, slug: t.slug, name: t.name, scheduledAt: t.deletionScheduledAt!, requestedBy: t.deletionRequestedBy, byOperator: t.deletionByOperator })),
    deleted: deleted.map((d) => {
      const final = finals.find((f) => f.id === d.finalExportId);
      return {
        id: d.id, tenantId: d.tenantId, slug: d.slug, name: d.name, deletedAt: d.deletedAt, requestedBy: d.requestedBy,
        slugHeldUntil: d.slugHeldUntil, summary: d.summaryJson, finalExport: final ? exportView(final) : null,
      };
    }),
  };
}

/**
 * Deletes a due organisation: final export first (nothing is deleted without one), then every row in one
 * transaction (courses first: Course -> Term is ON DELETE RESTRICT, so the cascade from Tenant could hit a term
 * before its courses; tables with tenantId but no foreign key, such as SupportPass, by tenantId; everything else
 * cascades from "Tenant", "AuditLog" included, as the table owner), the
 * tombstone, then the stored files. Returns false when there was nothing (or not yet anything) to do.
 */
export async function deleteOrganisation(tenantId: string, now = new Date()): Promise<boolean> {
  const t = await basePrisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, slug: true, name: true, deletionScheduledAt: true, deletionRequestedBy: true } });
  if (!t?.deletionScheduledAt || t.deletionScheduledAt.getTime() > now.getTime()) return false;
  if (isOperatorSlug(t.slug)) {
    logger.error({ tenantId }, "refusing to delete the platform operator's organisation; its deletion is cleared");
    await basePrisma.tenant.update({ where: { id: tenantId }, data: { deletionScheduledAt: null, deletionRequestedAt: null, deletionRequestedBy: null, deletionByOperator: false } });
    return false;
  }

  // 1. The final export (an earlier attempt's is reused).
  let final = await basePrisma.tenantExport.findFirst({ where: { tenantId, isFinal: true, status: { in: ['QUEUED', 'RUNNING', 'READY'] } }, orderBy: { createdAt: 'desc' } });
  if (!final) final = await basePrisma.tenantExport.create({ data: { tenantId, isFinal: true } });
  if (final.status !== 'READY') {
    if (final.status === 'RUNNING') await basePrisma.tenantExport.update({ where: { id: final.id }, data: { status: 'QUEUED' } });
    if ((await buildExport(final.id)) !== 'READY') {
      logger.error({ tenantId, exportId: final.id }, 'the final export failed; the organisation is not deleted (retried next round)');
      return false;
    }
    final = await basePrisma.tenantExport.findUniqueOrThrow({ where: { id: final.id } });
  }

  // 2. What is about to go, and who to tell.
  const rowCounts = await countRows(tenantId);
  const files = await storedFilesOf(tenantId);
  const admins = await adminEmails(tenantId);
  const otherExports = await basePrisma.tenantExport.findMany({ where: { tenantId, isFinal: false, storageKey: { not: null } }, select: { id: true, storageKey: true } });
  const slugHeldUntil = new Date(now.getTime() + config.ORG_DELETED_SLUG_HOLD_DAYS * DAY_MS);

  // 3. The rows, and the tombstone, together. A cancel that got in first wins (the row is locked and re-checked).
  const deleted = await runInTenantTransaction(
    tenantId,
    async (tx) => {
      const [row] = await tx.$queryRaw<{ deletionScheduledAt: Date | null }[]>`SELECT "deletionScheduledAt" FROM "Tenant" WHERE "id" = ${tenantId} FOR UPDATE`;
      if (!row?.deletionScheduledAt || row.deletionScheduledAt.getTime() > now.getTime()) return false;
      await tx.course.deleteMany({ where: { tenantId } });
      // Tables with tenantId but no foreign key to Tenant (SupportPass, SupportHandoff, ...) do not cascade.
      for (const delegate of unlinkedTenantDelegates()) await (tx as any)[delegate].deleteMany({ where: { tenantId } });
      await tx.tenant.delete({ where: { id: tenantId } });
      await tx.tenantDeletion.create({
        data: {
          tenantId, slug: t.slug, name: t.name, deletedAt: now, requestedBy: t.deletionRequestedBy, finalExportId: final!.id, finalExportKey: final!.storageKey,
          slugHeldUntil, summaryJson: { rows: rowCounts, files: files.length },
        },
      });
      return true;
    },
    { timeout: 30 * 60_000, maxWait: 30_000 }
  );
  if (!deleted) return false;

  // 4. Stored bytes: uploads, SCORM files and the ordinary exports. A failure is logged and counted, not retried.
  let filesFailed = 0;
  for (const key of [...files.map((f) => f.key), ...otherExports.map((e) => e.storageKey!)]) {
    await storage()
      .delete(key)
      .catch((err) => {
        filesFailed++;
        logger.warn({ err, tenantId, key }, 'deleted organisation: a stored file could not be removed');
      });
  }
  await basePrisma.tenantExport.updateMany({ where: { id: { in: otherExports.map((e) => e.id) } }, data: { status: 'EXPIRED', storageKey: null } });
  await basePrisma.tenantDeletion.update({ where: { tenantId }, data: { summaryJson: { rows: rowCounts, files: files.length, filesNotRemoved: filesFailed } } });

  const op = await operatorTenant();
  if (op) {
    await runWithTenant(op.id, () =>
      logAuditEvent({ tenantId: op.id, action: 'TENANT_DELETED', resourceType: 'TENANT', resourceId: tenantId, diffJson: { tenant: t.slug, name: t.name, finalExportId: final!.id, slugHeldUntil, by: 'SYSTEM' } })
    );
  }
  logger.info({ tenantId, slug: t.slug, rows: rowCounts, files: files.length, filesFailed }, 'organisation deleted');
  await mailAll(admins, `${t.name} has been deleted`, `Hello,\n\n${t.name} and all its data have been deleted from the learning platform, as scheduled. Its address stays reserved until ${slugHeldUntil.toUTCString()}.`, tenantId);
  return true;
}

// --------------------------------------------------------------------------- the background job

export interface OffboardingRunResult {
  built: number;
  failed: number;
  expired: number;
  deleted: number;
}

/** Expires exports past their date: the file is removed and the export is EXPIRED. */
async function expireExports(now: Date): Promise<number> {
  const due = await basePrisma.tenantExport.findMany({ where: { status: { in: ['READY', 'FAILED'] }, expiresAt: { lte: now } }, take: 200 });
  let n = 0;
  for (const e of due) {
    if (e.storageKey) {
      try {
        await storage().delete(e.storageKey);
      } catch (err) {
        logger.warn({ err, exportId: e.id }, 'could not remove an expired export; retried next round');
        continue;
      }
    }
    await basePrisma.tenantExport.update({ where: { id: e.id }, data: { status: 'EXPIRED', storageKey: null } });
    if (e.isFinal) await basePrisma.tenantDeletion.updateMany({ where: { finalExportId: e.id }, data: { finalExportKey: null } });
    n++;
  }
  return n;
}

/**
 * One round: builds queued exports, expires old ones, and carries out due deletions. Runs under the job lock
 * (startOffboardingJob), so an export still RUNNING at the start was left by a process that died: it is re-queued.
 */
export async function runOffboardingJobs(opts: { now?: Date; budgetMs?: number } = {}): Promise<OffboardingRunResult> {
  const now = opts.now ?? new Date();
  const stopAt = Date.now() + (opts.budgetMs ?? 50 * 60_000);
  const result: OffboardingRunResult = { built: 0, failed: 0, expired: 0, deleted: 0 };
  await basePrisma.tenantExport.updateMany({ where: { status: 'RUNNING' }, data: { status: 'QUEUED', startedAt: null } });

  while (Date.now() < stopAt) {
    const next = await basePrisma.tenantExport.findFirst({ where: { status: 'QUEUED', isFinal: false }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!next) break;
    const status = await buildExport(next.id);
    if (status === 'READY') result.built++;
    else if (status === 'FAILED') result.failed++;
  }
  result.expired = await expireExports(now);

  const due = await basePrisma.tenant.findMany({ where: { deletionScheduledAt: { lte: now } }, orderBy: { deletionScheduledAt: 'asc' }, select: { id: true } });
  for (const t of due) {
    if (Date.now() >= stopAt) break;
    try {
      if (await deleteOrganisation(t.id, now)) result.deleted++;
    } catch (err) {
      logger.error({ err, tenantId: t.id }, 'organisation deletion failed; retried next round');
    }
  }
  if (result.built || result.failed || result.expired || result.deleted) logger.info({ job: OFFBOARDING_JOB, ...result }, 'offboarding round');
  return result;
}

const JOB_MAX_MS = 60 * 60_000;

/** Starts the round every OFFBOARDING_JOB_INTERVAL_SECONDS (0: never). */
export function startOffboardingJob(): void {
  startPeriodicJob(OFFBOARDING_JOB, config.OFFBOARDING_JOB_INTERVAL_SECONDS, () => runOffboardingJobs(), JOB_MAX_MS);
}

/** Runs a round now (a new export need not wait for the next tick); skipped when another process has the lock. */
export function kickOffboardingJob(): void {
  if (config.NODE_ENV === 'test' || config.OFFBOARDING_JOB_INTERVAL_SECONDS <= 0) return;
  setImmediate(() => {
    withJobLock(OFFBOARDING_JOB, () => runOffboardingJobs(), JOB_MAX_MS).catch((err) => logger.error({ err, job: OFFBOARDING_JOB }, 'background job failed'));
  });
}
