import { findRlsBypassReason } from '@enterprise-lms/database';
import { config } from './config';
import { logger } from './lib/logger';
import { basePrisma } from './lib/prisma';
import { stopPeriodicJobs } from './lib/job-lock';
import { startEmailDispatcher } from './lib/email-dispatch';
import { startDigestJob } from './lib/digest';
import { startWebhookRetryWorker } from './lib/webhooks';
import { startFileScanSweep } from './lib/virus-scan';
import { startPlagiarismSubmitWorker } from './lib/plagiarism-submit';
import { startCustomDomainRecheck } from './lib/custom-domain-recheck';
import { startOffboardingJob } from './lib/offboarding';
import { startTrialJob } from './lib/trial';
import { startDsarJob } from './lib/data-requests';
import { startBreachJob } from './lib/breaches';
import { startRetentionJob } from './lib/retention';
import { startBillingJob } from './lib/billing';

/**
 * Starts all background jobs and returns a single stop function that clears all worker timers.
 */
export function startAllWorkers(): () => void {
  const stops = [
    startEmailDispatcher(),
    startDigestJob(),
    startWebhookRetryWorker(),
    startPlagiarismSubmitWorker(),
    startFileScanSweep(),
    startCustomDomainRecheck(),
    startOffboardingJob(),
    startTrialJob(),
    startDsarJob(),
    startBreachJob(),
    startRetentionJob(),
    startBillingJob(),
  ];

  return () => {
    for (const stop of stops) {
      try {
        stop();
      } catch (err) {
        logger.warn({ err }, 'error stopping background worker');
      }
    }
    stopPeriodicJobs();
  };
}

async function verifyWorkerDatabase(): Promise<void> {
  try {
    const reason = await findRlsBypassReason(basePrisma);
    if (!reason) return;
    const message = `Row-level security is NOT enforced: ${reason}. Connect the worker (DATABASE_URL) as the non-privileged lms_app role.`;
    if (config.NODE_ENV === 'production') {
      logger.fatal(message);
      process.exit(1);
    }
    logger.warn(`${message} Tenant isolation currently relies on application queries only.`);
  } catch (error) {
    logger.warn({ err: error }, 'Could not verify row-level security (is the database reachable?)');
    if (config.NODE_ENV === 'production') process.exit(1);
  }
}

if (require.main === module) {
  verifyWorkerDatabase().then(() => {
    const stopWorkers = startAllWorkers();
    // Worker intervals are .unref()'d when hosted inside the API process; keep the standalone worker alive until signalled.
    const keepAlive = setInterval(() => {}, 60_000);
    logger.info('Enterprise LMS background workers started');

    let shuttingDown = false;
    const shutdown = (signal: NodeJS.Signals) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ signal }, 'worker shutdown signal received');
      clearInterval(keepAlive);
      stopWorkers();
      basePrisma
        .$disconnect()
        .catch((err) => logger.warn({ err }, 'error disconnecting Prisma during worker shutdown'))
        .finally(() => process.exit(0));
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  });
}
