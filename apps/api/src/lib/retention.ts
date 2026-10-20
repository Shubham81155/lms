import { z } from 'zod';
import { Prisma, runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma, prisma } from './prisma';
import { logAuditEvent } from './audit';
import { logger } from './logger';
import { startPeriodicJob, withJobLock } from './job-lock';
import { storage } from './storage';

// Data retention: an organisation can have data it no longer needs removed after N days. Off by default. Only
// classes that nothing else depends on are offered: grades, certificates, submissions, forum posts and the audit
// trail are never touched. A policy in dry-run mode only counts what a run would remove. A run removes at most
// RETENTION_ROW_CAP rows per class (the next run continues) and writes one audit record with the counts.

const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_JOB = 'data-retention';

export const RETENTION_CLASSES = ['notifications', 'tokens', 'proctoring', 'supportAccess', 'infectedFiles'] as const;
export type RetentionClass = (typeof RETENTION_CLASSES)[number];

/** What each class is, and the fewest days it may be kept for (shorter would delete data people still need). */
export const CLASS_INFO: Record<RetentionClass, { label: string; min: number; field: string; what: string }> = {
  notifications: { label: 'Notifications', min: 30, field: 'notificationsDays', what: 'In-app notifications older than this are deleted.' },
  tokens: { label: 'Used and expired tokens', min: 7, field: 'tokensDays', what: 'Password-reset and e-mail confirmation tokens that were used or expired this long ago are deleted.' },
  proctoring: { label: 'Proctoring evidence', min: 30, field: 'proctoringDays', what: 'Snapshot links and event details of proctoring events are cleared; the events (type, severity, time) stay.' },
  supportAccess: { label: 'Support access records', min: 90, field: 'supportAccessDays', what: 'Support passes that ended this long ago, and their hand-off links, are deleted.' },
  infectedFiles: { label: 'Infected uploads', min: 7, field: 'infectedFilesDays', what: 'Files a virus scan found infected are deleted this long after the scan.' },
};

const days = (min: number) => z.number().int().min(min).max(3650).nullable();
export const retentionPolicySchema = z.object({
  enabled: z.boolean(),
  /** While true, a run only counts what it would remove. */
  dryRun: z.boolean(),
  notificationsDays: days(CLASS_INFO.notifications.min),
  tokensDays: days(CLASS_INFO.tokens.min),
  proctoringDays: days(CLASS_INFO.proctoring.min),
  supportAccessDays: days(CLASS_INFO.supportAccess.min),
  infectedFilesDays: days(CLASS_INFO.infectedFiles.min),
});
export type RetentionPolicyInput = z.infer<typeof retentionPolicySchema>;

export interface RetentionCounts {
  /** What was removed (or, in a dry run, would be). */
  counts: Record<RetentionClass, number>;
  /** Rows of a class still waiting because the per-run cap was reached. */
  remaining: Record<RetentionClass, number>;
}

export interface RetentionRunSummary extends RetentionCounts {
  at: string;
  dryRun: boolean;
}

type Policy = NonNullable<Awaited<ReturnType<typeof prisma.retentionPolicy.findFirst>>>;

const zero = (): Record<RetentionClass, number> => ({ notifications: 0, tokens: 0, proctoring: 0, supportAccess: 0, infectedFiles: 0 });

export const policyView = (p: Policy | null) => ({
  enabled: p?.enabled ?? false,
  dryRun: p?.dryRun ?? true,
  notificationsDays: p?.notificationsDays ?? null,
  tokensDays: p?.tokensDays ?? null,
  proctoringDays: p?.proctoringDays ?? null,
  supportAccessDays: p?.supportAccessDays ?? null,
  infectedFilesDays: p?.infectedFilesDays ?? null,
  lastRun: p?.lastRunAt && p.lastRunJson ? ({ at: p.lastRunAt.toISOString(), dryRun: p.lastRunDryRun ?? true, ...(p.lastRunJson as unknown as RetentionCounts) } satisfies RetentionRunSummary) : null,
  rowCap: config.RETENTION_ROW_CAP,
  classes: RETENTION_CLASSES.map((c) => ({ key: c, ...CLASS_INFO[c] })),
});

/** The audit sanitiser redacts any key containing "token", which would blank the counts and days of that class. */
const auditSafe = <T extends Record<string, unknown>>(o: T) => {
  const { tokens, tokensDays, ...rest } = o as Record<string, unknown>;
  return { ...rest, ...(tokens !== undefined ? { expiredLinks: tokens } : {}), ...(tokensDays !== undefined ? { expiredLinksDays: tokensDays } : {}) };
};

export const loadPolicy = (tenantId: string) => prisma.retentionPolicy.findFirst({ where: { tenantId } });

export async function savePolicy(tenantId: string, input: RetentionPolicyInput, userId: string | null, ctx: { ipAddress?: string; userAgent?: string } = {}) {
  const before = await loadPolicy(tenantId);
  const saved = await prisma.retentionPolicy.upsert({ where: { tenantId }, create: { tenantId, ...input, updatedById: userId }, update: { ...input, updatedById: userId } });
  await logAuditEvent({ tenantId, userId, action: 'RETENTION_POLICY_CHANGED', resourceType: 'RETENTION_POLICY', resourceId: tenantId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, diffJson: { before: before ? auditSafe({ ...policyView(before), lastRun: undefined, classes: undefined }) : null, after: auditSafe(input) } });
  return saved;
}

/** Removes (or counts) up to `cap` rows with the given ids in one go; returns what was handled. */
async function inBatches<T extends { id: string }>(find: (take: number) => Promise<T[]>, total: () => Promise<number>, act: (rows: T[]) => Promise<void>, dryRun: boolean, cap: number): Promise<{ done: number; remaining: number }> {
  if (dryRun) return { done: await total(), remaining: 0 };
  const rows = await find(cap);
  if (rows.length) await act(rows);
  // Counted after the removal, so it is what is still waiting.
  return { done: rows.length, remaining: rows.length === cap ? await total() : 0 };
}

/**
 * Applies a policy to its organisation. `dryRun` overrides the policy's own setting (a manual "what would happen"
 * run); `now` and `cap` are for tests. Must run inside the organisation's tenant context.
 */
export async function applyRetention(tenantId: string, policy: Pick<Policy, 'notificationsDays' | 'tokensDays' | 'proctoringDays' | 'supportAccessDays' | 'infectedFilesDays'>, opts: { dryRun: boolean; now?: Date; cap?: number }): Promise<RetentionCounts> {
  const now = opts.now ?? new Date();
  const cap = opts.cap ?? config.RETENTION_ROW_CAP;
  const cutoff = (n: number) => new Date(now.getTime() - n * DAY_MS);
  const out: RetentionCounts = { counts: zero(), remaining: zero() };
  const put = (c: RetentionClass, r: { done: number; remaining: number }) => {
    out.counts[c] += r.done;
    out.remaining[c] += r.remaining;
  };

  if (policy.notificationsDays != null) {
    const where = { tenantId, createdAt: { lt: cutoff(policy.notificationsDays) } };
    put(
      'notifications',
      await inBatches(
        (take) => prisma.notification.findMany({ where, select: { id: true }, take }),
        () => prisma.notification.count({ where }),
        async (rows) => void (await prisma.notification.deleteMany({ where: { tenantId, id: { in: rows.map((r) => r.id) } } })),
        opts.dryRun,
        cap
      )
    );
  }

  if (policy.tokensDays != null) {
    const at = cutoff(policy.tokensDays);
    const where = { tenantId, OR: [{ expiresAt: { lt: at } }, { usedAt: { lt: at } }] };
    put(
      'tokens',
      await inBatches(
        (take) => prisma.passwordResetToken.findMany({ where, select: { id: true }, take }),
        () => prisma.passwordResetToken.count({ where }),
        async (rows) => void (await prisma.passwordResetToken.deleteMany({ where: { tenantId, id: { in: rows.map((r) => r.id) } } })),
        opts.dryRun,
        cap
      )
    );
    put(
      'tokens',
      await inBatches(
        (take) => prisma.emailVerificationToken.findMany({ where, select: { id: true }, take }),
        () => prisma.emailVerificationToken.count({ where }),
        async (rows) => void (await prisma.emailVerificationToken.deleteMany({ where: { tenantId, id: { in: rows.map((r) => r.id) } } })),
        opts.dryRun,
        cap
      )
    );
  }

  if (policy.proctoringDays != null) {
    const where: Prisma.ProctoringLogWhereInput = {
      timestamp: { lt: cutoff(policy.proctoringDays) },
      submission: { quiz: { tenantId } },
      OR: [{ snapshotUrl: { not: null } }, { metadataJson: { not: Prisma.DbNull } }],
    };
    put(
      'proctoring',
      await inBatches(
        (take) => prisma.proctoringLog.findMany({ where, select: { id: true }, take }),
        () => prisma.proctoringLog.count({ where }),
        async (rows) => void (await prisma.proctoringLog.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { snapshotUrl: null, metadataJson: Prisma.DbNull } })),
        opts.dryRun,
        cap
      )
    );
  }

  if (policy.supportAccessDays != null) {
    const at = cutoff(policy.supportAccessDays);
    const passes = { tenantId, OR: [{ revokedAt: { lt: at } }, { expiresAt: { lt: at } }] };
    put(
      'supportAccess',
      await inBatches(
        (take) => prisma.supportPass.findMany({ where: passes, select: { id: true }, take }),
        () => prisma.supportPass.count({ where: passes }),
        async (rows) => {
          const ids = rows.map((r) => r.id);
          await prisma.supportHandoff.deleteMany({ where: { tenantId, passId: { in: ids } } });
          await prisma.supportPass.deleteMany({ where: { tenantId, id: { in: ids } } });
        },
        opts.dryRun,
        cap
      )
    );
  }

  if (policy.infectedFilesDays != null) {
    const where = { tenantId, scanStatus: 'INFECTED', scannedAt: { lt: cutoff(policy.infectedFilesDays) } };
    put(
      'infectedFiles',
      await inBatches(
        (take) => prisma.storedFile.findMany({ where, select: { id: true, storageKey: true }, take }),
        () => prisma.storedFile.count({ where }),
        async (rows) => {
          const gone: string[] = [];
          for (const f of rows) {
            try {
              await storage().delete(f.storageKey);
              gone.push(f.id);
            } catch (err) {
              // Keep the record so the next run tries the bytes again.
              logger.warn({ err, fileId: f.id }, 'Retention could not delete an infected file from storage');
            }
          }
          await prisma.storedFile.deleteMany({ where: { tenantId, id: { in: gone } } });
        },
        opts.dryRun,
        cap
      )
    );
  }

  return out;
}

/**
 * Runs the organisation's policy now and records the run (summary on the policy, one audit entry). A manual run
 * may ask for a dry run; a policy that is not enabled is only ever run dry.
 */
export async function runRetention(tenantId: string, opts: { dryRun?: boolean; userId?: string | null; scheduled?: boolean; now?: Date; ctx?: { ipAddress?: string; userAgent?: string } } = {}): Promise<RetentionRunSummary> {
  const policy = await loadPolicy(tenantId);
  if (!policy) throw Object.assign(new Error('No retention policy'), { noPolicy: true });
  const dryRun = !policy.enabled || (opts.dryRun ?? policy.dryRun);
  const now = opts.now ?? new Date();
  const result = await applyRetention(tenantId, policy, { dryRun, now });
  const summary: RetentionRunSummary = { at: now.toISOString(), dryRun, ...result };
  await prisma.retentionPolicy.update({ where: { tenantId }, data: { lastRunAt: now, lastRunDryRun: dryRun, lastRunJson: { counts: result.counts, remaining: result.remaining } as unknown as Prisma.InputJsonValue } });
  await logAuditEvent({
    tenantId,
    userId: opts.userId ?? null,
    action: dryRun ? 'RETENTION_DRY_RUN' : 'RETENTION_RUN',
    resourceType: 'RETENTION_POLICY',
    resourceId: tenantId,
    ipAddress: opts.ctx?.ipAddress,
    userAgent: opts.ctx?.userAgent,
    diffJson: { by: opts.scheduled ? 'SCHEDULE' : 'ADMINISTRATOR', counts: auditSafe(result.counts), remaining: auditSafe(result.remaining) },
  });
  return summary;
}

export interface RetentionJobResult {
  organisations: number;
  removed: number;
}

/**
 * One round: every organisation with an enabled policy is run once. At most once a day each (a restart or an
 * overlapping process does not run a policy twice within 20 hours). `now` is for tests.
 */
export async function runRetentionJob(now = new Date()): Promise<RetentionJobResult> {
  const result: RetentionJobResult = { organisations: 0, removed: 0 };
  const tenants = await basePrisma.tenant.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL'] } }, select: { id: true } });
  for (const t of tenants) {
    try {
      await runWithTenant(t.id, async () => {
        const policy = await loadPolicy(t.id);
        if (!policy?.enabled) return;
        if (policy.lastRunAt && now.getTime() - policy.lastRunAt.getTime() < 20 * 60 * 60 * 1000) return;
        // Claim the run: a conditional update on the last-run time, so only one process proceeds.
        const claim = await prisma.retentionPolicy.updateMany({ where: { tenantId: t.id, lastRunAt: policy.lastRunAt }, data: { lastRunAt: now } });
        if (claim.count !== 1) return;
        const summary = await runRetention(t.id, { scheduled: true, now });
        result.organisations++;
        result.removed += summary.dryRun ? 0 : Object.values(summary.counts).reduce((a, b) => a + b, 0);
      });
    } catch (err) {
      logger.error({ err, tenantId: t.id }, 'retention job failed for an organisation');
    }
  }
  if (result.organisations) logger.info({ ...result }, 'retention job');
  return result;
}

/** One round under the job lock: null when another process is running it. */
export const runRetentionJobLocked = (now?: Date) => withJobLock(RETENTION_JOB, () => runRetentionJob(now));

/** Starts the periodic job (every RETENTION_JOB_INTERVAL_SECONDS; one process at a time across the deployment). */
export const startRetentionJob = () => startPeriodicJob(RETENTION_JOB, config.RETENTION_JOB_INTERVAL_SECONDS, () => runRetentionJob());
