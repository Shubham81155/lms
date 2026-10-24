import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Digest e-mails (lib/digest.ts): when one is due (time zones, DAILY/WEEKLY), what goes in it, the signed
// unsubscribe link, the preferences API, and the job: claimed once, suspended and read-only organisations skipped.
// Real PostgreSQL and RLS; mail goes to a test double.

const PASSWORD = 'CorrectHorse1!';
const DAY = 24 * 60 * 60 * 1000;
/** A Monday, 10:00 UTC: past the default send hour (08:00) of the default WEEKLY digest (Monday). */
const MONDAY = new Date('2026-11-09T10:00:00Z');
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let mailer: typeof import('../src/lib/mailer.js');
let digest: typeof import('../src/lib/digest.js');
const outbox: { to: string; subject: string; text: string; html?: string; headers?: Record<string, string> }[] = [];

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-a', slug: 'acme', name: 'Acme College', tier: 'ENTERPRISE' } });
  await admin.tenant.create({ data: { id: 't-s', slug: 'sus', name: 'Suspended', tier: 'ENTERPRISE', status: 'SUSPENDED' } });
  await admin.tenant.create({
    data: {
      id: 't-r',
      slug: 'ro',
      name: 'Read only',
      tier: 'ENTERPRISE',
      status: 'TRIAL',
      trialEndsAt: new Date(MONDAY.getTime() - DAY),
      trialExpiredAt: new Date(MONDAY.getTime() - DAY),
    },
  });
  for (const [t, n] of [
    ['t-a', 'a'],
    ['t-s', 's'],
    ['t-r', 'r'],
  ] as const)
    await user(`${n}-student`, t, 'STUDENT');
  await user('a-erased', 't-a', 'STUDENT', { erasedAt: new Date() });
  await user('a-locked', 't-a', 'STUDENT', { status: 'LOCKED' });
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  mailer = await import('../src/lib/mailer.js');
  digest = await import('../src/lib/digest.js');
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

beforeEach(async () => {
  outbox.length = 0;
  mailer.setMailer({
    mode: 'smtp',
    async send(m) {
      outbox.push(m);
    },
  });
  await admin.notificationPreference.deleteMany();
  await admin.notification.deleteMany();
});

function user(id: string, tenantId: string, role: any, over: object = {}) {
  return admin.user.create({
    data: {
      id,
      tenantId,
      email: `${id}@x.edu`,
      firstName: id,
      lastName: 'L',
      role,
      passwordHash: bcrypt.hashSync(PASSWORD, 4),
      emailVerified: true,
      ...over,
    },
  });
}

async function as(who: string, tenant: string) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .set('x-tenant-id', tenant)
    .send({ email: `${who}@x.edu`, password: PASSWORD });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

const sched = (over: Partial<import('../src/lib/digest.js').DigestSchedule> = {}) => ({
  digestFrequency: 'WEEKLY',
  digestHour: 8,
  digestWeekday: 1,
  timezone: 'UTC',
  lastDigestAt: null,
  ...over,
});

describe('when a digest is due', () => {
  it("waits for the chosen hour in the person's own time zone", () => {
    const noon = new Date('2026-11-09T12:00:00Z'); // 17:30 in Kolkata, 07:00 in New York
    expect(digest.digestDue(sched({ digestFrequency: 'DAILY', digestHour: 8 }), noon)).toBe(true);
    expect(digest.digestDue(sched({ digestFrequency: 'DAILY', digestHour: 8, timezone: 'America/New_York' }), noon)).toBe(false);
    expect(digest.digestDue(sched({ digestFrequency: 'DAILY', digestHour: 18, timezone: 'Asia/Kolkata' }), noon)).toBe(false);
    expect(digest.digestDue(sched({ digestFrequency: 'DAILY', digestHour: 17, timezone: 'Asia/Kolkata' }), noon)).toBe(true);
  });

  it('is at most one a day, and OFF is never', () => {
    const earlier = new Date('2026-11-09T08:30:00Z');
    expect(digest.digestDue(sched({ digestFrequency: 'DAILY', lastDigestAt: earlier }), MONDAY)).toBe(false);
    expect(digest.digestDue(sched({ digestFrequency: 'DAILY', lastDigestAt: new Date(earlier.getTime() - DAY) }), MONDAY)).toBe(true);
    expect(digest.digestDue(sched({ digestFrequency: 'OFF' }), MONDAY)).toBe(false);
  });

  it('WEEKLY goes out on its weekday, and catches up eight days after the last one', () => {
    expect(digest.digestDue(sched(), MONDAY)).toBe(true);
    expect(digest.digestDue(sched({ digestWeekday: 2 }), MONDAY)).toBe(false);
    expect(digest.digestDue(sched({ digestWeekday: 2, lastDigestAt: new Date(MONDAY.getTime() - 8 * DAY) }), MONDAY)).toBe(true);
    expect(digest.digestDue(sched({ digestWeekday: 2, lastDigestAt: new Date(MONDAY.getTime() - 3 * DAY) }), MONDAY)).toBe(false);
  });

  it('treats an unknown time zone as UTC', () => {
    expect(digest.digestDue(sched({ timezone: 'Not/AZone' }), MONDAY)).toBe(true);
  });
});

describe('the unsubscribe token', () => {
  it('round-trips and rejects tampering', () => {
    const t = digest.signUnsubscribeToken('t-a', 'a-student');
    expect(digest.verifyUnsubscribeToken(t)).toEqual({ tenantId: 't-a', userId: 'a-student' });
    const [payload, mac] = t.split('.');
    expect(digest.verifyUnsubscribeToken(`${Buffer.from('t-a.someone-else').toString('base64url')}.${mac}`)).toBeNull();
    expect(digest.verifyUnsubscribeToken(`${payload}.${mac.slice(0, -2)}xx`)).toBeNull();
    expect(digest.verifyUnsubscribeToken(`${payload}.`)).toBeNull();
    expect(digest.verifyUnsubscribeToken('garbage')).toBeNull();
    expect(digest.verifyUnsubscribeToken(`${t}.extra`)).toBeNull();
  });
});

describe('the message', () => {
  const input = (over: Partial<import('../src/lib/digest.js').DigestInput> = {}): import('../src/lib/digest.js').DigestInput => ({
    tenantName: 'Acme <College>',
    base: 'https://acme.example.com',
    firstName: 'Ann',
    timezone: 'UTC',
    frequency: 'WEEKLY',
    sections: [...digest.DIGEST_SECTIONS],
    now: MONDAY,
    notifications: [],
    deadlines: [],
    announcements: [],
    liveSessions: [],
    unsubscribeUrl: 'https://acme.example.com/unsubscribe?token=abc',
    oneClickUrl: 'https://acme.example.com/api/v1/notifications/unsubscribe?token=abc',
    ...over,
  });

  it('is null when there is nothing to report', () => {
    expect(digest.buildDigest(input())).toBeNull();
  });

  it('is null when what there is lies in sections the person switched off', () => {
    const m = digest.buildDigest(
      input({ sections: ['grades'], announcements: [{ title: 'Hello', courseTitle: 'Bio', createdAt: MONDAY, link: '/courses/c1' }] })
    );
    expect(m).toBeNull();
  });

  it('lists sections in order, escapes HTML, links on the organisation address and carries the unsubscribe link', () => {
    const m = digest.buildDigest(
      input({
        deadlines: [
          { kind: 'Quiz', title: 'Later', courseTitle: 'Bio', dueAt: new Date('2026-11-14T10:00:00Z'), link: '/quizzes/q2' },
          {
            kind: 'Assignment',
            title: 'Essay <b>1</b>',
            courseTitle: 'Bio',
            dueAt: new Date('2026-11-11T10:00:00Z'),
            link: '/courses/c1/assignments',
          },
        ],
        notifications: [
          { category: 'GRADE', title: 'Graded: Essay', body: 'You got 9/10', link: '/courses/c1/grades' },
          { category: 'FORUM', title: 'Re: question', body: null, link: 'javascript:alert(1)' },
          { category: 'SYSTEM', title: 'Maintenance', body: null, link: null },
        ],
      })
    )!;
    expect(m.items).toBe(5);
    expect(m.subject).toBe('Your weekly summary from Acme <College>');
    expect(m.text.indexOf('Essay <b>1</b>')).toBeLessThan(m.text.indexOf('Later')); // soonest first
    expect(m.text.indexOf('DUE IN THE NEXT 7 DAYS')).toBeLessThan(m.text.indexOf('NEW GRADES'));
    expect(m.text).toContain('https://acme.example.com/courses/c1/grades');
    expect(m.text).not.toContain('javascript:');
    expect(m.text).toContain('https://acme.example.com/unsubscribe?token=abc');
    expect(m.html).toContain('Essay &lt;b&gt;1&lt;/b&gt;');
    expect(m.html).not.toContain('<b>1</b>');
    expect(m.html).toContain('Acme &lt;College&gt;');
    expect(m.html).not.toContain('javascript:');
    expect(m.html).toContain('href="https://acme.example.com/unsubscribe?token=abc"');
  });

  it('caps a section and says how many more there are', () => {
    const many = Array.from({ length: 14 }, (_, n) => ({ category: 'FORUM', title: `Reply ${n}`, body: null, link: null }));
    const m = digest.buildDigest(input({ notifications: many }))!;
    expect(m.text).toContain('...and 4 more');
    expect(m.text).not.toContain('Reply 10');
  });
});

describe('the job', () => {
  /** Course c1 in Acme with an assignment due on Thursday, an announcement and an unread grade notice. */
  async function seedAcme() {
    await admin.course.create({ data: { id: 'c1', tenantId: 't-a', code: 'BIO-1', title: 'Cell Biology', status: 'PUBLISHED' } });
    await admin.enrollment.create({ data: { tenantId: 't-a', courseId: 'c1', userId: 'a-student', status: 'ENROLLED' } });
    await admin.assignment.create({
      data: {
        id: 'as1',
        tenantId: 't-a',
        courseId: 'c1',
        title: 'Lab report',
        instructions: 'Write it',
        dueDate: new Date('2026-11-12T10:00:00Z'),
      },
    });
    await admin.announcement.create({
      data: { tenantId: 't-a', courseId: 'c1', title: 'Welcome back', body: 'Hi', createdAt: new Date('2026-11-08T10:00:00Z') },
    });
    await admin.notification.create({
      data: {
        tenantId: 't-a',
        userId: 'a-student',
        category: 'GRADE',
        title: 'Graded: Quiz 1',
        createdAt: new Date('2026-11-08T11:00:00Z'),
      },
    });
  }

  beforeEach(async () => {
    await admin.course.deleteMany(); // cascades to enrolments, assignments, announcements, extensions
    await seedAcme();
  });

  it('sends one digest to a person who never set anything (WEEKLY by default), with one-click unsubscribe headers', async () => {
    const r = await digest.runDigestJob(MONDAY);
    expect(r).toMatchObject({ sent: 1, failed: 0 });
    expect(outbox).toHaveLength(1);
    const m = outbox[0];
    expect(m.to).toBe('a-student@x.edu');
    expect(m.text).toContain('Lab report');
    expect(m.text).toContain('Welcome back');
    expect(m.text).toContain('Graded: Quiz 1');
    expect(m.headers?.['List-Unsubscribe']).toMatch(/^<.*\/api\/v1\/notifications\/unsubscribe\?token=.+>$/);
    expect(m.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const pref = await admin.notificationPreference.findUniqueOrThrow({ where: { userId: 'a-student' } });
    expect(pref.lastDigestAt?.getTime()).toBe(MONDAY.getTime());
  });

  it('does not send twice in one period, and not again the same day when run by two instances at once', async () => {
    await digest.runDigestJob(MONDAY);
    expect(outbox).toHaveLength(1);
    expect(await digest.runDigestJob(new Date(MONDAY.getTime() + 3_600_000))).toMatchObject({ sent: 0 });

    await admin.notificationPreference.update({ where: { userId: 'a-student' }, data: { lastDigestAt: null } });
    outbox.length = 0;
    await Promise.all([digest.runDigestJob(MONDAY), digest.runDigestJob(MONDAY), digest.runDigestJob(MONDAY)]);
    expect(outbox).toHaveLength(1);
  });

  it('records the period without sending when there is nothing to report', async () => {
    await admin.course.deleteMany();
    await admin.notification.deleteMany();
    const r = await digest.runDigestJob(MONDAY);
    expect(r).toMatchObject({ sent: 0, empty: 1 });
    expect(outbox).toHaveLength(0);
    expect((await admin.notificationPreference.findUniqueOrThrow({ where: { userId: 'a-student' } })).lastDigestAt).not.toBeNull();
  });

  it('leaves out what was already e-mailed on its own and what has been read', async () => {
    await admin.notification.create({
      data: {
        tenantId: 't-a',
        userId: 'a-student',
        category: 'GRADE',
        title: 'Mailed already',
        emailStatus: 'SENT',
        createdAt: new Date('2026-11-08T11:00:00Z'),
      },
    });
    await admin.notification.create({
      data: {
        tenantId: 't-a',
        userId: 'a-student',
        category: 'FORUM',
        title: 'Seen already',
        readAt: new Date(),
        createdAt: new Date('2026-11-08T11:00:00Z'),
      },
    });
    await admin.notification.create({
      data: { tenantId: 't-a', userId: 'a-student', category: 'FORUM', title: 'Too old', createdAt: new Date('2026-10-01T11:00:00Z') },
    });
    await admin.notification.create({
      data: { tenantId: 't-a', userId: 'a-student', category: 'FORUM', title: 'Fresh reply', createdAt: new Date('2026-11-08T11:00:00Z') },
    });
    await digest.runDigestJob(MONDAY);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].text).toContain('Fresh reply');
    for (const left of ['Mailed already', 'Seen already', 'Too old']) expect(outbox[0].text).not.toContain(left);
  });

  it("honours sections, OFF, and the person's own deadline extension; skips work already handed in", async () => {
    await admin.assignment.create({
      data: {
        id: 'as2',
        tenantId: 't-a',
        courseId: 'c1',
        title: 'Done already',
        instructions: 'x',
        dueDate: new Date('2026-11-12T10:00:00Z'),
      },
    });
    await admin.assignmentSubmission.create({ data: { assignmentId: 'as2', userId: 'a-student', submissionText: 'x' } });
    await admin.assignment.create({
      data: {
        id: 'as3',
        tenantId: 't-a',
        courseId: 'c1',
        title: 'Extended past the week',
        instructions: 'x',
        dueDate: new Date('2026-11-10T10:00:00Z'),
      },
    });
    await admin.deadlineExtension.create({
      data: {
        tenantId: 't-a',
        userId: 'a-student',
        assignmentId: 'as3',
        dueAt: new Date('2026-12-20T10:00:00Z'),
        grantedById: 'a-student',
      },
    });
    await admin.notificationPreference.create({ data: { tenantId: 't-a', userId: 'a-student', digestSections: ['deadlines'] } });
    await digest.runDigestJob(MONDAY);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].text).toContain('Lab report');
    for (const left of ['Done already', 'Extended past the week', 'Welcome back', 'Graded: Quiz 1'])
      expect(outbox[0].text).not.toContain(left);

    outbox.length = 0;
    await admin.notificationPreference.update({ where: { userId: 'a-student' }, data: { lastDigestAt: null, digestFrequency: 'OFF' } });
    await digest.runDigestJob(MONDAY);
    expect(outbox).toHaveLength(0);
  });

  it('sends nothing for suspended or read-only organisations, erased or locked people, or when mail would be dropped', async () => {
    await admin.notification.createMany({
      data: ['t-s:s-student', 't-r:r-student', 't-a:a-erased', 't-a:a-locked'].map((k) => ({
        tenantId: k.split(':')[0],
        userId: k.split(':')[1],
        category: 'FORUM',
        title: 'Reply',
        createdAt: new Date('2026-11-08T11:00:00Z'),
      })),
    });
    await digest.runDigestJob(MONDAY);
    expect(
      outbox.map((m) => m.to).filter((to) => ['s-student', 'r-student', 'a-erased', 'a-locked'].some((u) => to.startsWith(u)))
    ).toEqual([]);
    expect(
      await admin.notificationPreference.count({ where: { userId: { in: ['s-student', 'r-student', 'a-erased', 'a-locked'] } } })
    ).toBe(0);

    outbox.length = 0;
    await admin.notificationPreference.deleteMany();
    mailer.setMailer({ mode: 'discarded', async send() {} });
    expect(await digest.runDigestJob(MONDAY)).toMatchObject({ sent: 0, empty: 0, failed: 0 });
    expect(await admin.notificationPreference.count()).toBe(0); // nobody's period was used up
  });

  it('counts a failed send and carries on with the others, without a retry loop', async () => {
    await admin.notification.create({
      data: { tenantId: 't-a', userId: 'a-student', category: 'FORUM', title: 'Reply', createdAt: new Date('2026-11-08T11:00:00Z') },
    });
    mailer.setMailer({
      mode: 'smtp',
      async send() {
        throw new Error('mailbox full');
      },
    });
    expect(await digest.runDigestJob(MONDAY)).toMatchObject({ sent: 0, failed: 1 });
    expect(await digest.runDigestJob(new Date(MONDAY.getTime() + 3_600_000))).toMatchObject({ sent: 0, failed: 0 });
  });
});

describe('the API', () => {
  it('reads defaults, saves digest settings (and the inactive channels), and rejects bad values', async () => {
    const a = await as('a-student', 'acme');
    const read = await a.get('/api/v1/notifications/preferences');
    expect(read.body.data).toMatchObject({
      digestFrequency: 'WEEKLY',
      digestHour: 8,
      digestWeekday: 1,
      digestSections: ['deadlines', 'announcements', 'grades', 'forum', 'live'],
      smsEnabled: false,
      pushEnabled: false,
      lastDigestAt: null,
    });

    const put = await a.put('/api/v1/notifications/preferences').send({
      digestFrequency: 'DAILY',
      digestHour: 18,
      digestWeekday: 5,
      digestSections: ['grades', 'grades', 'live'],
      timezone: 'Asia/Kolkata',
    });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({
      digestFrequency: 'DAILY',
      digestHour: 18,
      digestWeekday: 5,
      digestSections: ['grades', 'live'],
      timezone: 'Asia/Kolkata',
    });
    expect((await a.get('/api/v1/notifications/preferences')).body.data.digestFrequency).toBe('DAILY');

    for (const bad of [{ digestFrequency: 'HOURLY' }, { digestHour: 24 }, { digestWeekday: 7 }, { digestSections: ['everything'] }]) {
      expect((await a.put('/api/v1/notifications/preferences').send(bad)).status).toBe(400);
    }
  });

  it("keeps one person's settings from another's", async () => {
    await user('a-other', 't-a', 'STUDENT');
    const a = await as('a-student', 'acme');
    await a.put('/api/v1/notifications/preferences').send({ digestFrequency: 'OFF' });
    const other = await as('a-other', 'acme');
    expect((await other.get('/api/v1/notifications/preferences')).body.data.digestFrequency).toBe('WEEKLY');
  });

  it('unsubscribes through the signed link without signing in; a bad or forged link does nothing', async () => {
    const token = digest.signUnsubscribeToken('t-a', 'a-student');
    const check = await request(app).get('/api/v1/notifications/unsubscribe').query({ token });
    expect(check.status).toBe(200);
    expect(check.body.data).toEqual({ organisation: 'Acme College', digestFrequency: 'WEEKLY' });
    expect(await admin.notificationPreference.count({ where: { userId: 'a-student' } })).toBe(0); // GET changes nothing

    const done = await request(app)
      .post('/api/v1/notifications/unsubscribe')
      .query({ token })
      .type('form')
      .send('List-Unsubscribe=One-Click');
    expect(done.status).toBe(200);
    expect(done.body.data.digestFrequency).toBe('OFF');
    expect((await admin.notificationPreference.findUniqueOrThrow({ where: { userId: 'a-student' } })).digestFrequency).toBe('OFF');
    expect(await digest.runDigestJob(MONDAY)).toMatchObject({ sent: 0 });

    const forged = `${Buffer.from('t-a.a-other').toString('base64url')}.${token.split('.')[1]}`;
    expect((await request(app).post('/api/v1/notifications/unsubscribe').query({ token: forged })).status).toBe(400);
    expect((await request(app).get('/api/v1/notifications/unsubscribe').query({ token: 'nonsense-token' })).status).toBe(400);
    expect((await request(app).post('/api/v1/notifications/unsubscribe')).status).toBe(400);
    const gone = digest.signUnsubscribeToken('t-a', 'nobody');
    expect((await request(app).post('/api/v1/notifications/unsubscribe').query({ token: gone })).status).toBe(400);
  });
});
