import { runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma, prisma } from './prisma';
import { logger } from './logger';
import { logAuditEvent } from './audit';
import { sendMail } from './mailer';
import { startPeriodicJob } from './job-lock';
import { subdomainOrigin, tenantUrl } from './tenant-url';
import { checkTxt, clearedRecheck, removalDate, txtRecordName, txtRecordValue } from './custom-domain';

// A verified custom domain must keep its TXT record: whoever controls the domain now may not be the organisation
// that proved it. Each live domain is re-checked once per CUSTOM_DOMAIN_RECHECK_INTERVAL_SECONDS. A definite
// failure (no record, or a different value) starts a grace period and the administrators are warned once; still
// failing after CUSTOM_DOMAIN_RECHECK_GRACE_DAYS, the domain is removed and the organisation falls back to its
// subdomain. A passing DNS problem (timeout, SERVFAIL) neither starts nor ends the grace period; a success ends it.

export const RECHECK_JOB = 'recheck-custom-domains';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecheckOptions {
  now?: Date;
  /** Domains looked up at once. */
  batchSize?: number;
  /** Pause between batches, so DNS servers are not flooded. */
  pauseMs?: number;
  /** A domain checked more recently than this is skipped (defaults to CUSTOM_DOMAIN_RECHECK_INTERVAL_SECONDS). */
  intervalSeconds?: number;
  /** Stops starting batches after this long; the rest are due next round. */
  budgetMs?: number;
}

export interface RecheckResult {
  checked: number;
  ok: number;
  /** Lookups that failed without an answer (do not count towards removal). */
  transient: number;
  failing: number;
  warned: number;
  removed: number;
}

type Live = {
  id: string; slug: string; name: string; customDomain: string; customDomainLiveToken: string;
  customDomainFailingSince: Date | null; customDomainWarnedAt: Date | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mailAdmins(tenantId: string, subject: string, text: string) {
  const admins = await runWithTenant(tenantId, () =>
    prisma.user.findMany({ where: { tenantId, role: { in: ['TENANT_ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE', erasedAt: null }, select: { email: true } })
  );
  for (const a of admins) {
    await sendMail({ to: a.email, subject, text }).catch((err) => logger.warn({ err, tenantId }, 'could not e-mail an administrator about the custom domain'));
  }
}

const audit = (t: Live, action: string, diffJson: Record<string, unknown>) =>
  runWithTenant(t.id, () => logAuditEvent({ tenantId: t.id, action, resourceType: 'TENANT', resourceId: t.id, diffJson: { tenant: t.slug, live: t.customDomain, by: 'SYSTEM', ...diffJson } }));

const adminLink = (t: { slug: string; customDomain: string | null }) => `${tenantUrl(t)}/admin#admin-domain`;
const days = (ms: number) => Math.max(1, Math.ceil(ms / DAY_MS));

async function recheckOne(t: Live, now: Date, result: RecheckResult) {
  const check = await checkTxt(t.customDomain, t.customDomainLiveToken);
  result.checked++;
  // Only the domain checked is changed: a removal or a new domain in the meantime wins.
  const same = { id: t.id, customDomain: t.customDomain, customDomainLiveToken: t.customDomainLiveToken };

  if (check.ok) {
    result.ok++;
    const saved = await basePrisma.tenant.updateMany({ where: same, data: { ...clearedRecheck, customDomainRecheckedAt: now } });
    if (saved.count && t.customDomainFailingSince) await audit(t, 'CUSTOM_DOMAIN_RECHECK_RECOVERED', { failingSince: t.customDomainFailingSince });
    return;
  }
  if (!check.definite) {
    result.transient++;
    await basePrisma.tenant.updateMany({ where: same, data: { customDomainRecheckedAt: now, customDomainRecheckError: check.error } });
    return;
  }

  result.failing++;
  const failingSince = t.customDomainFailingSince ?? now;
  const removesAt = removalDate(failingSince);
  const record = `${txtRecordName(t.customDomain)} = ${txtRecordValue(t.customDomainLiveToken)}`;

  if (removesAt.getTime() <= now.getTime()) {
    const removed = await basePrisma.tenant.updateMany({
      where: { ...same, customDomainFailingSince: failingSince },
      data: { customDomain: null, customDomainVerifiedAt: null, customDomainLiveToken: null, ...clearedRecheck },
    });
    if (!removed.count) return;
    result.removed++;
    await audit(t, 'CUSTOM_DOMAIN_REMOVED_UNVERIFIED', { failingSince, error: check.error });
    const fallback = subdomainOrigin(t.slug) ?? tenantUrl({ slug: t.slug });
    await mailAdmins(
      t.id,
      `${t.customDomain} no longer works for ${t.name}`,
      `Hello,\n\nThe DNS record that proves ${t.name} controls ${t.customDomain} has been missing since ${failingSince.toUTCString()}, so ${t.customDomain} has been removed from the organisation. People can still sign in at ${fallback}, and links in e-mails use that address from now on.\n\n${check.error}\n\nTo use ${t.customDomain} again, add it in the admin area (${fallback}/admin#admin-domain) and verify it with the TXT record shown there.`
    );
    return;
  }

  await basePrisma.tenant.updateMany({ where: same, data: { customDomainRecheckedAt: now, customDomainRecheckError: check.error, customDomainFailingSince: failingSince } });
  if (t.customDomainWarnedAt) return;
  // Claimed before sending, so the warning goes out once whatever else runs.
  const claimed = await basePrisma.tenant.updateMany({ where: { ...same, customDomainWarnedAt: null }, data: { customDomainWarnedAt: now } });
  if (!claimed.count) return;
  result.warned++;
  const left = days(removesAt.getTime() - now.getTime());
  await audit(t, 'CUSTOM_DOMAIN_RECHECK_FAILING', { error: check.error, removesAt });
  await mailAdmins(
    t.id,
    `Action needed: the verification record of ${t.customDomain} is missing`,
    `Hello,\n\n${t.name} uses ${t.customDomain}, but the DNS record that proves the organisation controls it is missing or wrong:\n\n${check.error}\n\nAdd it back within ${left} day${left === 1 ? '' : 's'} (by ${removesAt.toUTCString()}), or ${t.customDomain} will be removed and people will have to use ${subdomainOrigin(t.slug) ?? 'the platform address'} instead. The record is:\n\n${record}\n\nYou can see it and check it in the admin area: ${adminLink(t)}`
  );
}

/**
 * Re-checks the TXT record of every live custom domain that is due (verified with a token, not checked within
 * the interval), oldest first, in small batches with a pause between them.
 */
export async function recheckCustomDomains(opts: RecheckOptions = {}): Promise<RecheckResult> {
  const now = opts.now ?? new Date();
  const batchSize = opts.batchSize ?? 10;
  const pauseMs = opts.pauseMs ?? 2_000;
  const dueBefore = new Date(now.getTime() - (opts.intervalSeconds ?? config.CUSTOM_DOMAIN_RECHECK_INTERVAL_SECONDS) * 1000);
  const result: RecheckResult = { checked: 0, ok: 0, transient: 0, failing: 0, warned: 0, removed: 0 };
  const seen = new Set<string>();
  const stopAt = Date.now() + (opts.budgetMs ?? 20 * 60_000);

  while (Date.now() < stopAt) {
    const due = (await basePrisma.tenant.findMany({
      where: {
        customDomain: { not: null },
        customDomainLiveToken: { not: null },
        status: { not: 'ARCHIVED' },
        id: { notIn: [...seen] },
        OR: [{ customDomainRecheckedAt: null }, { customDomainRecheckedAt: { lte: dueBefore } }],
      },
      select: { id: true, slug: true, name: true, customDomain: true, customDomainLiveToken: true, customDomainFailingSince: true, customDomainWarnedAt: true },
      orderBy: [{ customDomainRecheckedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: batchSize,
    })) as Live[];
    if (!due.length) break;
    if (seen.size && pauseMs > 0) await sleep(pauseMs);
    for (const t of due) seen.add(t.id);
    await Promise.all(
      due.map((t) => recheckOne(t, now, result).catch((err) => logger.warn({ err, tenantId: t.id }, 'could not re-check a custom domain')))
    );
  }
  if (result.checked) logger.info({ job: RECHECK_JOB, ...result }, 'custom domains re-checked');
  return result;
}

/**
 * Starts the re-check. The job runs at least hourly (or every interval, when shorter) and checks only the domains
 * that are due, so each domain is looked up about once per interval however many there are.
 */
export function startCustomDomainRecheck(): void {
  const interval = config.CUSTOM_DOMAIN_RECHECK_INTERVAL_SECONDS;
  startPeriodicJob(RECHECK_JOB, Math.min(interval, 3600), () => recheckCustomDomains(), 30 * 60_000);
}
