import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Background jobs take an advisory lock per run, so only one process does a job at a time.

let db: TestDatabase;
let lock: typeof import('../src/lib/job-lock.js');

beforeAll(async () => {
  db = await startTestDatabase();
  process.env.DATABASE_URL = db.appUrl;
  lock = await import('../src/lib/job-lock.js');
}, 240_000);

afterAll(async () => {
  await db?.stop();
}, 60_000);

describe('withJobLock', () => {
  it('lets one run of a job through at a time, and other jobs alongside it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = lock.withJobLock('expire-trials', async () => {
      await gate;
      return 'first';
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(await lock.withJobLock('expire-trials', async () => 'second')).toBeNull();
    expect(await lock.withJobLock('recheck-domains', async () => 'other')).toBe('other');
    release();
    expect(await first).toBe('first');
    expect(await lock.withJobLock('expire-trials', async () => 'again')).toBe('again');
  });
});
