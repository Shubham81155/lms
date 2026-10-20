import { runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma, prisma } from './prisma';
import { logger } from './logger';
import { signCallback } from '../routes/integrations.routes';
import { copyleaksConfigured, newScanId, submitCopyleaksScan } from './copyleaks';

// Outbound similarity checks. A text submission is queued (plagiarismStatus = PENDING) when it is
// saved and sent by a sweeper either to Copyleaks (lib/copyleaks.ts) or to PLAGIARISM_SUBMIT_URL,
// signed like the inbound callback. The provider answers later through its callback route. Safe on
// several instances: a row is claimed by moving its nextAttemptAt before the request is made.

/** Seconds to wait before attempt 2, 3, 4, 5. After that the check is marked FAILED. */
export const SUBMIT_RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200];
export const SUBMIT_MAX_ATTEMPTS = SUBMIT_RETRY_DELAYS_SECONDS.length + 1;
const REQUEST_TIMEOUT_MS = 10_000;
const MIN_TEXT_LENGTH = 50;

export const outboundPlagiarismEnabled = () =>
  !!((config.PLAGIARISM_SUBMIT_URL || copyleaksConfigured()) && config.PLAGIARISM_WEBHOOK_SECRET && config.API_PUBLIC_URL);

/** Only substantial written text is worth checking; short answers and file-only submissions are not. */
export const shouldCheckPlagiarism = (text: string | null | undefined) =>
  outboundPlagiarismEnabled() && !!text && text.trim().length >= MIN_TEXT_LENGTH;

const isRetryable = (status: number | null) => status === null || status >= 500 || status === 408 || status === 429;

export async function submitDuePlagiarismChecks(opts: { now?: Date; batch?: number } = {}) {
  const totals = { submitted: 0, retried: 0, failed: 0 };
  if (!outboundPlagiarismEnabled()) return totals;
  const now = opts.now ?? new Date();
  const secret = config.PLAGIARISM_WEBHOOK_SECRET!;
  const tenants = await basePrisma.tenant.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL'] } }, select: { id: true, slug: true } });

  for (const tenant of tenants) {
    try {
      await runWithTenant(tenant.id, async () => {
        const due = await prisma.assignmentSubmission.findMany({
          where: { plagiarismStatus: 'PENDING', plagiarismNextAttemptAt: { lte: now }, assignment: { tenantId: tenant.id } },
          orderBy: { plagiarismNextAttemptAt: 'asc' },
          take: opts.batch ?? 25,
          select: { id: true, userId: true, submissionText: true, plagiarismAttempts: true, plagiarismNextAttemptAt: true, plagiarismScanId: true, assignmentId: true },
        });
        for (const s of due) {
          // Claim: only the instance that moves nextAttemptAt proceeds. A Copyleaks scan id is fixed here,
          // before the first attempt, and kept for the retries.
          const scanId = copyleaksConfigured() ? (s.plagiarismScanId ?? newScanId(s.id, now)) : null;
          const claimedUntil = new Date(now.getTime() + 10 * 60_000);
          const claimed = await prisma.assignmentSubmission.updateMany({
            where: { id: s.id, plagiarismStatus: 'PENDING', plagiarismNextAttemptAt: s.plagiarismNextAttemptAt },
            data: { plagiarismNextAttemptAt: claimedUntil, plagiarismScanId: scanId },
          });
          if (claimed.count !== 1) continue;
          // The outcome is written only while the row is still the one claimed: a learner who hands in again
          // meanwhile re-queues it (new nextAttemptAt, no scan id), and that new text must still be sent.
          const stillClaimed = { id: s.id, plagiarismStatus: 'PENDING', plagiarismNextAttemptAt: claimedUntil, plagiarismScanId: scanId };

          const attempts = s.plagiarismAttempts + 1;
          const status = scanId
            ? await submitCopyleaksScan({ scanId, submissionId: s.id, tenantSlug: tenant.slug, text: s.submissionText ?? '' })
            : await postToSubmitUrl(secret, tenant.slug, s);

          if (status !== null && status >= 200 && status < 300) {
            await prisma.assignmentSubmission.updateMany({ where: stillClaimed, data: { plagiarismStatus: 'SUBMITTED', plagiarismAttempts: attempts, plagiarismNextAttemptAt: null } });
            totals.submitted++;
          } else if (isRetryable(status) && attempts < SUBMIT_MAX_ATTEMPTS) {
            const delay = SUBMIT_RETRY_DELAYS_SECONDS[attempts - 1];
            await prisma.assignmentSubmission.updateMany({ where: stillClaimed, data: { plagiarismAttempts: attempts, plagiarismNextAttemptAt: new Date(Date.now() + delay * 1000) } });
            totals.retried++;
          } else {
            await prisma.assignmentSubmission.updateMany({ where: stillClaimed, data: { plagiarismStatus: 'FAILED', plagiarismAttempts: attempts, plagiarismNextAttemptAt: null } });
            totals.failed++;
          }
        }
      });
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, 'plagiarism submission sweep failed for tenant');
    }
  }
  return totals;
}

/** Sends one check to PLAGIARISM_SUBMIT_URL; returns the HTTP status, or null when no answer came. */
async function postToSubmitUrl(secret: string, tenantSlug: string, s: { id: string; assignmentId: string; userId: string; submissionText: string | null }) {
  const body = JSON.stringify({
    submissionId: s.id,
    assignmentId: s.assignmentId,
    authorId: s.userId,
    text: s.submissionText ?? '',
    callbackUrl: `${config.API_PUBLIC_URL!.replace(/\/+$/, '')}/api/v1/integrations/plagiarism/${tenantSlug}`,
  });
  const ts = String(Math.floor(Date.now() / 1000));
  try {
    const res = await fetch(config.PLAGIARISM_SUBMIT_URL!, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', 'x-lms-timestamp': ts, 'x-lms-signature': `sha256=${signCallback(secret, ts, body)}` },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return res.status;
  } catch (err) {
    logger.warn({ err, submissionId: s.id }, 'plagiarism submission request failed');
    return null;
  }
}

let timer: NodeJS.Timeout | null = null;

/** Starts the background sender; a tick is skipped while the previous one is still running. */
export function startPlagiarismSubmitWorker(): void {
  const seconds = config.PLAGIARISM_SUBMIT_INTERVAL_SECONDS;
  if (seconds <= 0 || timer || !outboundPlagiarismEnabled()) return;
  let running = false;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await submitDuePlagiarismChecks();
      if (r.submitted || r.retried || r.failed) logger.info(r, 'plagiarism submissions processed');
    } finally {
      running = false;
    }
  }, seconds * 1000);
  timer.unref();
}
