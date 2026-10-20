import { basePrisma } from './prisma';
import { logger } from './logger';
import { jobRan } from './metrics';

// Background jobs (trial expiry, scheduled deletions, domain re-checks, ...) run in every API process, so on
// several machines each would do the same work at once. A job takes a PostgreSQL advisory lock for its run:
// whoever gets it does the work, the others skip that round. The lock lives in a transaction that stays open
// while the job runs (the job's own queries use other connections), so it is released even if the process dies.

/** A stable 32-bit key for a job name, the advisory lock's second half (the first is fixed for jobs). */
function lockKey(name: string): number {
  let h = 0;
  for (const c of name) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return h;
}

const JOB_LOCK_NAMESPACE = 7_420_001;

/**
 * Runs `fn` if no other process is running the job `name`; returns its result, or `null` when the lock was
 * taken elsewhere. `maxMs` bounds how long the lock may be held (the holding transaction times out after it).
 */
export async function withJobLock<T>(name: string, fn: () => Promise<T>, maxMs = 10 * 60_000): Promise<T | null> {
  let ran = false;
  try {
    const result = await basePrisma.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${JOB_LOCK_NAMESPACE}::int, ${lockKey(name)}::int) AS locked`;
        if (!row?.locked) return null;
        ran = true;
        return fn();
      },
      { timeout: maxMs, maxWait: 10_000 }
    );
    jobRan(name, ran ? 'ok' : 'skipped');
    return result;
  } catch (err) {
    jobRan(name, 'error');
    throw err;
  }
}

const timers = new Map<string, NodeJS.Timeout>();

/**
 * Runs a job every `intervalSeconds` (0 or less: never), one process at a time across the deployment, skipping a
 * round while this process's previous run is still going. Errors are logged, never thrown.
 */
export function startPeriodicJob(name: string, intervalSeconds: number, fn: () => Promise<unknown>, maxMs?: number): void {
  if (intervalSeconds <= 0 || timers.has(name)) return;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await withJobLock(name, fn, maxMs);
    } catch (err) {
      logger.error({ err, job: name }, 'background job failed');
    } finally {
      running = false;
    }
  }, intervalSeconds * 1000);
  timer.unref();
  timers.set(name, timer);
}

/** Stops every periodic job (tests, shutdown). */
export function stopPeriodicJobs(): void {
  for (const t of timers.values()) clearInterval(t);
  timers.clear();
}
