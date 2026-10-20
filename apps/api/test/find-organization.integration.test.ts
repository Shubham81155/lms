import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// "Find my organisation": an e-mail address is sent the sign-in links of the organisations where it has an
// account, and the answer never says whether it has any. Real PostgreSQL and RLS (users are tenant-scoped).

let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let mailer: typeof import('../src/lib/mailer.js');
const outbox: { to: string; subject: string; text: string }[] = [];

beforeAll(async () => {
  process.env.PLATFORM_OPERATOR_TENANT = 'ops';
  process.env.DEFAULT_TENANT_SLUG = 'default-tenant';
  process.env.TENANT_BASE_DOMAIN = 'lms.test';
  process.env.FIND_ORG_RATE_LIMIT_MAX = '100';
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  const tenant = (id: string, slug: string, name: string, extra: object = {}) => admin.tenant.create({ data: { id, slug, name, ...extra } });
  await tenant('t-op', 'ops', 'Operator');
  await tenant('t-h', 'harvard', 'Harvard', { customDomain: 'learn.harvard.edu' });
  await tenant('t-y', 'yale', 'Yale');
  await tenant('t-tr', 'trial-college', 'Trial College', { status: 'TRIAL' });
  await tenant('t-s', 'shut-college', 'Shut College', { status: 'SUSPENDED' });
  await tenant('t-a', 'old-college', 'Old College', { status: 'ARCHIVED' });
  await tenant('t-o', 'other-college', 'Other College');
  let n = 0;
  const user = (tenantId: string, email: string, status: any = 'ACTIVE') =>
    admin.user.create({ data: { id: `u${++n}`, tenantId, email, firstName: 'Ann', lastName: 'Lee', role: 'STUDENT', status, emailVerified: true } });
  await user('t-op', 'ann@example.edu');
  await user('t-h', 'ann@example.edu');
  await user('t-y', 'ann@example.edu', 'INVITED');
  await user('t-tr', 'ann@example.edu');
  await user('t-s', 'ann@example.edu');
  await user('t-a', 'ann@example.edu');
  await user('t-o', 'ann@example.edu', 'SUSPENDED');
  await user('t-o', 'bob@example.edu');
  await user('t-y', 'cat@example.edu');
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  mailer = await import('../src/lib/mailer.js');
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

beforeEach(() => {
  outbox.length = 0;
  mailer.setMailer({
    async send(m) {
      outbox.push(m);
    },
  });
});

const find = (body: object) => request(app).post('/api/v1/organizations/find').send(body);
/** The mail is sent after the answer, so wait for it. */
const mailArrives = (count = 1) => vi.waitFor(() => expect(outbox).toHaveLength(count));

describe('finding my organisation', () => {
  it('e-mails the sign-in links of the organisations where the address has an active or invited account', async () => {
    const res = await find({ email: '  Ann@Example.EDU ' });
    expect(res.status).toBe(202);
    await mailArrives();
    expect(outbox[0]).toMatchObject({ to: 'ann@example.edu', subject: 'Your organisations on the learning platform' });
    const text = outbox[0].text;
    // In name order; the custom domain is the address of an organisation that has one.
    expect(text).toContain('Harvard\nhttp://learn.harvard.edu/login');
    expect(text).toContain('Trial College\nhttp://trial-college.lms.test/login');
    expect(text).toContain('Yale\nhttp://yale.lms.test/login');
    expect(text.indexOf('Harvard')).toBeLessThan(text.indexOf('Trial College'));
    expect(text.indexOf('Trial College')).toBeLessThan(text.indexOf('Yale'));
    // Not the operator, suspended or archived organisations, nor one where the account is suspended.
    for (const left of ['Operator', 'ops.lms.test', 'Shut College', 'Old College', 'Other College']) expect(text).not.toContain(left);
  });

  it('answers an address without accounts exactly the same, and sends it nothing', async () => {
    const known = await find({ email: 'bob@example.edu' });
    const unknown = await find({ email: 'nobody@example.edu' });
    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    expect(unknown.body).toEqual({ message: expect.stringContaining('If this e-mail address has an account') });
    await mailArrives();
    expect(outbox.map((m) => m.to)).toEqual(['bob@example.edu']);
    expect(outbox[0].text).toContain('Other College\nhttp://other-college.lms.test/login');
  });

  it('sends one address at most 3 e-mails an hour, with the same answer throughout', async () => {
    const answers = [];
    for (let i = 0; i < 5; i++) answers.push(await find({ email: 'cat@example.edu' }));
    expect(answers.map((r) => r.status)).toEqual([202, 202, 202, 202, 202]);
    expect(new Set(answers.map((r) => JSON.stringify(r.body))).size).toBe(1);
    await mailArrives(3);
    // Another address is not held back by it.
    await find({ email: 'bob@example.edu' });
    await mailArrives(4);
    expect(outbox.filter((m) => m.to === 'cat@example.edu')).toHaveLength(3);
  });

  it('refuses a malformed request', async () => {
    expect((await find({})).status).toBe(400);
    expect((await find({ email: 'not-an-address' })).status).toBe(400);
    expect((await find({ email: `${'a'.repeat(250)}@x.edu` })).status).toBe(400);
    expect(outbox).toHaveLength(0);
  });
});
