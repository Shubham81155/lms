import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Inviting people: the account starts INVITED, the emailed link lets the person choose a password
// (which activates the account), and the usual guards apply (admin only, seats, tenant, super admin).

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let mailer: typeof import('../src/lib/mailer.js');
const outbox: { to: string; subject: string; text: string }[] = [];

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'Harvard' } });
  await admin.tenant.create({ data: { id: 't-m', slug: 'mit', name: 'MIT', seatQuota: 2 } });
  const user = (id: string, tenantId: string, role: any, extra: object = {}) =>
    admin.user.create({ data: { id, tenantId, email: `${id}@x.edu`, firstName: id, lastName: 'Lovelace', role, passwordHash: bcrypt.hashSync(`${PASSWORD}-${tenantId}`, 4), emailVerified: true, ...extra } });
  await user('admin', 't-h', 'TENANT_ADMIN');
  await user('super', 't-h', 'SUPER_ADMIN');
  await user('teacher', 't-h', 'INSTRUCTOR');
  await user('student', 't-h', 'STUDENT');
  await user('m-admin', 't-m', 'TENANT_ADMIN');
  await user('m-student', 't-m', 'STUDENT');
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

async function as(who: string, tenant: 'harvard' | 'mit' = 'harvard') {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('x-tenant-id', tenant).send({ email: `${who}@x.edu`, password: `${PASSWORD}-${tenant === 'harvard' ? 't-h' : 't-m'}` });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

const tokenIn = (text: string) => /token=([^&\s]+)/.exec(text)?.[1] ?? '';
const invite = (body: object) => as('admin').then((a) => a.post('/api/v1/users').send(body));

describe('inviting a person', () => {
  it('creates an invited account and emails a link, never exposing credentials', async () => {
    const res = await invite({ email: 'New.Person@X.edu', firstName: 'New', lastName: 'Person', role: 'INSTRUCTOR' });
    expect(res.status).toBe(201);
    expect(res.body.invitationSent).toBe(true);
    expect(res.body.data).toMatchObject({ email: 'new.person@x.edu', role: 'INSTRUCTOR', status: 'INVITED', emailVerified: false });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenVersion|\$2[aby]\$/);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe('new.person@x.edu');
    expect(outbox[0].text).toMatch(/reset-password\?token=.+&invite=1/);
  });

  it('defaults to a learner and rejects bad input', async () => {
    const ok = await invite({ email: 'learner@x.edu', firstName: 'L', lastName: 'Earner' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.role).toBe('STUDENT');
    expect((await invite({ email: 'not-an-email', firstName: 'A', lastName: 'B' })).status).toBe(400);
    expect((await invite({ email: 'a@x.edu', firstName: '', lastName: 'B' })).status).toBe(400);
    expect((await invite({ email: 'a@x.edu', firstName: 'A', lastName: 'B', role: 'WIZARD' })).status).toBe(400);
  });

  it('refuses a second invitation for the same address', async () => {
    expect((await invite({ email: 'dup@x.edu', firstName: 'D', lastName: 'Up' })).status).toBe(201);
    const again = await invite({ email: 'DUP@x.edu', firstName: 'D', lastName: 'Up' });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already exists/);
  });

  it('is for administrators only', async () => {
    for (const who of ['teacher', 'student']) {
      const res = await (await as(who)).post('/api/v1/users').send({ email: `by-${who}@x.edu`, firstName: 'A', lastName: 'B' });
      expect(res.status, who).toBe(403);
    }
    expect((await request(app).post('/api/v1/users').send({ email: 'anon@x.edu', firstName: 'A', lastName: 'B' })).status).toBe(401);
  });

  it('lets only a super administrator invite another one', async () => {
    const byAdmin = await invite({ email: 'boss1@x.edu', firstName: 'B', lastName: 'One', role: 'SUPER_ADMIN' });
    expect(byAdmin.status).toBe(403);
    const bySuper = await (await as('super')).post('/api/v1/users').send({ email: 'boss2@x.edu', firstName: 'B', lastName: 'Two', role: 'SUPER_ADMIN' });
    expect(bySuper.status).toBe(201);
  });

  it('respects the seat quota', async () => {
    const res = await (await as('m-admin', 'mit')).post('/api/v1/users').send({ email: 'extra@x.edu', firstName: 'E', lastName: 'Xtra' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Seat quota of 2/);
  });

  it('keeps the account and says so when the email cannot be sent', async () => {
    mailer.setMailer({
      async send() {
        throw new Error('smtp down');
      },
    });
    const res = await invite({ email: 'nomail@x.edu', firstName: 'N', lastName: 'Mail' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ invitationSent: false, emailConfigured: true });
    expect(await admin.user.findFirst({ where: { email: 'nomail@x.edu' } })).toMatchObject({ status: 'INVITED' });
  });
});

describe('when the server cannot deliver mail', () => {
  const undeliverable = () =>
    mailer.setMailer({
      mode: 'discarded',
      async send(m) {
        outbox.push(m);
      },
    });

  it('does not claim the invitation was sent, and creates no link nobody can receive', async () => {
    undeliverable();
    const res = await invite({ email: 'offline@x.edu', firstName: 'O', lastName: 'Ffline' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ invitationSent: false, emailConfigured: false });
    expect(outbox).toHaveLength(0);
    const person = await admin.user.findFirst({ where: { email: 'offline@x.edu' } });
    expect(person).toMatchObject({ status: 'INVITED' });
    expect(await admin.passwordResetToken.count({ where: { userId: person!.id } })).toBe(0);
  });

  it('says the same when resending, and works again once mail is configured', async () => {
    undeliverable();
    const created = await invite({ email: 'later@x.edu', firstName: 'L', lastName: 'Ater' });
    const a = await as('admin');
    const resend = await a.post(`/api/v1/users/${created.body.data.id}/invite`);
    expect(resend.body.data).toMatchObject({ invitationSent: false, emailConfigured: false });

    mailer.setMailer({ mode: 'smtp', async send(m) { outbox.push(m); } });
    const again = await a.post(`/api/v1/users/${created.body.data.id}/invite`);
    expect(again.body.data).toMatchObject({ invitationSent: true, emailConfigured: true });
    expect(outbox).toHaveLength(1);
  });

  it('shows up in the compliance checks so an administrator can see it before inviting anyone', async () => {
    const a = await as('admin');
    const status = async (mode: 'discarded' | 'console' | 'smtp') => {
      mailer.setMailer({ mode, async send() {} });
      const res = await a.get('/api/v1/admin/compliance');
      expect(res.status).toBe(200);
      return res.body.data.checks.find((c: any) => c.id === 'outbound-email');
    };
    expect(await status('discarded')).toMatchObject({ status: 'FAIL', detail: expect.stringMatching(/SMTP_URL/) });
    expect(await status('console')).toMatchObject({ status: 'WARN' });
    expect(await status('smtp')).toMatchObject({ status: 'PASS' });
  });
});

describe('accepting an invitation', () => {
  it('cannot sign in until the invitation is accepted', async () => {
    await invite({ email: 'pending@x.edu', firstName: 'P', lastName: 'Ending' });
    const res = await request(app).post('/api/v1/auth/login').set('x-tenant-id', 'harvard').send({ email: 'pending@x.edu', password: 'anything-at-all-123' });
    expect(res.status).toBe(401);
  });

  it('activates the account when the person chooses a password, once', async () => {
    await invite({ email: 'joiner@x.edu', firstName: 'J', lastName: 'Oiner' });
    const token = tokenIn(outbox[0].text);

    const done = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'Brand-new-pass-1!' });
    expect(done.status).toBe(200);
    expect(done.body.message).toMatch(/account is ready/);
    expect(await admin.user.findFirst({ where: { email: 'joiner@x.edu' } })).toMatchObject({ status: 'ACTIVE', emailVerified: true });
    expect(await admin.auditLog.count({ where: { action: 'USER_INVITATION_ACCEPTED' } })).toBeGreaterThan(0);

    const login = await request(app).post('/api/v1/auth/login').set('x-tenant-id', 'harvard').send({ email: 'joiner@x.edu', password: 'Brand-new-pass-1!' });
    expect(login.status).toBe(200);

    const replay = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'Another-pass-2!!' });
    expect(replay.status).toBe(400);
  });

  it('does not let a suspended person use an old link', async () => {
    await invite({ email: 'gone@x.edu', firstName: 'G', lastName: 'One' });
    const token = tokenIn(outbox[0].text);
    await admin.user.updateMany({ where: { email: 'gone@x.edu' }, data: { status: 'SUSPENDED' } });
    const res = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'Brand-new-pass-1!' });
    expect(res.status).toBe(400);
    expect(await admin.user.findFirst({ where: { email: 'gone@x.edu' } })).toMatchObject({ status: 'SUSPENDED' });
  });
});

describe('resending an invitation', () => {
  it('cancels the old link and issues a new one', async () => {
    const created = await invite({ email: 'resend@x.edu', firstName: 'R', lastName: 'Esend' });
    const oldToken = tokenIn(outbox[0].text);
    const a = await as('admin');
    const res = await a.post(`/api/v1/users/${created.body.data.id}/invite`);
    expect(res.status).toBe(200);
    expect(res.body.data.invitationSent).toBe(true);
    const newToken = tokenIn(outbox[outbox.length - 1].text);
    expect(newToken).not.toBe(oldToken);
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token: oldToken, password: 'Brand-new-pass-1!' })).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token: newToken, password: 'Brand-new-pass-1!' })).status).toBe(200);
  });

  it('is only for people who have not accepted, administrators, and the same organisation', async () => {
    const a = await as('admin');
    expect((await a.post('/api/v1/users/student/invite')).status).toBe(409);
    expect((await (await as('teacher')).post('/api/v1/users/student/invite')).status).toBe(403);
    expect((await a.post('/api/v1/users/no-such-user/invite')).status).toBe(404);
    expect((await a.post('/api/v1/users/m-student/invite')).status).toBe(404);
  });
});
