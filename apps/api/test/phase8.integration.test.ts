import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { runWithTenant } from '@enterprise-lms/database';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';
import { setMailer, MailMessage } from '../src/lib/mailer';

// Notification e-mail: queuing rules, quiet hours, retries, concurrency and escaping, against a real
// PostgreSQL with the real migrations and the unprivileged role.

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let notify: typeof import('../src/lib/notify.js').notify;
let dispatch: typeof import('../src/lib/email-dispatch.js').dispatchPendingEmails;
let renderEmail: typeof import('../src/lib/email-dispatch.js').renderEmail;
let absoluteLink: typeof import('../src/lib/email-dispatch.js').absoluteLink;
const pw = (slug: string) => `${PASSWORD}-${slug}`;

// ---- capture mailer ----------------------------------------------------------------------------
const sent: MailMessage[] = [];
let failures = 0; // number of upcoming sends that should fail
let failAlways = false;
setMailer({
  async send(m) {
    if (failAlways || failures > 0) {
      if (failures > 0) failures--;
      throw new Error('smtp down');
    }
    sent.push(m);
  },
});

async function seed() {
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'Harvard' } });
  await admin.tenant.create({ data: { id: 't-m', slug: 'mit', name: 'MIT' } });
  await admin.tenant.create({ data: { id: 't-s', slug: 'frozen', name: 'Frozen U', status: 'SUSPENDED' } });
  const user = (id: string, tenantId: string, slug: string, role: any, extra: object = {}) =>
    admin.user.create({
      data: {
        id,
        tenantId,
        email: `${id}@x.edu`,
        firstName: id,
        lastName: 'L',
        role,
        passwordHash: bcrypt.hashSync(pw(slug), 4),
        emailVerified: true,
        ...extra,
      },
    });
  await user('teacher', 't-h', 'harvard', 'INSTRUCTOR');
  for (const s of ['s1', 's2', 's3', 's4', 's5']) await user(s, 't-h', 'harvard', 'STUDENT');
  await user('m1', 't-m', 'mit', 'STUDENT');
  await user('f1', 't-s', 'frozen', 'STUDENT');
  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'C1', status: 'PUBLISHED' } });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'teacher', isPrimary: true } });
  await admin.enrollment.create({ data: { id: 'e1', tenantId: 't-h', courseId: 'c1', userId: 's1', status: 'IN_PROGRESS' } });
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await seed();
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  ({ notify } = await import('../src/lib/notify.js'));
  ({ dispatchPendingEmails: dispatch, renderEmail, absoluteLink } = await import('../src/lib/email-dispatch.js'));
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

beforeEach(async () => {
  sent.length = 0;
  failures = 0;
  failAlways = false;
  await admin.notification.deleteMany();
  await admin.notificationPreference.deleteMany();
  await admin.user.updateMany({ data: { status: 'ACTIVE' } });
});

const queue = (
  tenantId: string,
  userId: string,
  over: Partial<{ category: string; title: string; body: string | null; link: string | null }> = {}
) =>
  runWithTenant(tenantId, () =>
    notify({ tenantId, userId, category: 'GRADE', title: 'Grade posted', body: 'You scored 90.', link: '/courses/c1', ...over })
  );
const statusOf = async (userId: string) => (await admin.notification.findFirst({ where: { userId } }))?.emailStatus;
/** A moment today at the given UTC hour (within a day of the real clock, so never "stale"). */
const at = (hour: number) => {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

// ---------------------------------------------------------------------------
describe('rendering', () => {
  it('only links to same-app paths and https URLs', () => {
    expect(absoluteLink('/courses/c1')).toBe('http://localhost:3000/courses/c1');
    expect(absoluteLink('https://ok.example/x')).toBe('https://ok.example/x');
    for (const bad of ['javascript:alert(1)', '//evil.example', 'http://insecure.example', 'data:text/html,x', null, ''])
      expect(absoluteLink(bad as any), String(bad)).toBeNull();
  });

  it('escapes user-supplied text in the HTML part and keeps headers single-line', () => {
    const m = renderEmail(
      { title: '<script>alert(1)</script> & "q"\nBcc: evil@x.edu', body: '<b>bold</b>\nline2', link: '/a?x=1&y="2"' },
      'Uni <X>'
    );
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<b>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('&amp; &quot;q&quot;');
    expect(m.html).toContain('Uni &lt;X&gt;');
    expect(m.html).toContain('href="http://localhost:3000/a?x=1&amp;y=&quot;2&quot;"');
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject.length).toBeLessThanOrEqual(200);
    expect(m.text).toContain('Open: http://localhost:3000/a');
  });

  it('omits the link line when there is no safe link', () => {
    const m = renderEmail({ title: 'T', body: null, link: 'javascript:alert(1)' }, 'U');
    expect(m.text).not.toContain('Open:');
    expect(m.html).not.toContain('href');
  });
});

// ---------------------------------------------------------------------------
describe('what gets queued', () => {
  it('queues e-mail for important categories by default', async () => {
    for (const c of ['GRADE', 'EXAM', 'COURSE', 'SYSTEM', 'LIVE']) {
      await admin.notification.deleteMany();
      await queue('t-h', 's1', { category: c });
      expect(await statusOf('s1'), c).toBe('PENDING');
    }
  });

  it('keeps forum chatter in-app only', async () => {
    await queue('t-h', 's1', { category: 'FORUM' });
    expect(await statusOf('s1')).toBe('NONE');
    expect((await dispatch()).sent).toBe(0);
  });

  it('honours the user’s e-mail, in-app and muted-category choices', async () => {
    await admin.notificationPreference.create({ data: { tenantId: 't-h', userId: 's2', emailEnabled: false } });
    await queue('t-h', 's2');
    expect(await statusOf('s2')).toBe('NONE'); // in-app kept, no e-mail

    await admin.notificationPreference.create({ data: { tenantId: 't-h', userId: 's3', inAppEnabled: false } });
    expect(await queue('t-h', 's3')).toBeNull(); // nothing created at all
    expect(await admin.notification.count({ where: { userId: 's3' } })).toBe(0);

    await admin.notificationPreference.create({ data: { tenantId: 't-h', userId: 's4', mutedCategories: ['GRADE'] } });
    expect(await queue('t-h', 's4')).toBeNull();
  });

  it('is driven by real events and the preferences endpoint', async () => {
    const teacher = request.agent(app);
    await teacher
      .post('/api/v1/auth/login')
      .set('x-tenant-id', 'harvard')
      .send({ email: 'teacher@x.edu', password: pw('harvard') });
    const s1 = request.agent(app);
    await s1
      .post('/api/v1/auth/login')
      .set('x-tenant-id', 'harvard')
      .send({ email: 's1@x.edu', password: pw('harvard') });

    expect(
      (await teacher.post('/api/v1/analytics/at-risk/nudge').send({ courseId: 'c1', userId: 's1', message: 'Catch up!' })).status
    ).toBe(201);
    expect(await statusOf('s1')).toBe('PENDING');

    const prefs = await s1.get('/api/v1/notifications/preferences');
    expect(prefs.body.data.emailedCategories).toEqual(['GRADE', 'EXAM', 'COURSE', 'SYSTEM', 'LIVE']);
    expect((await s1.put('/api/v1/notifications/preferences').send({ emailEnabled: false })).body.data.emailEnabled).toBe(false);
    await admin.notification.deleteMany();
    await teacher.post('/api/v1/analytics/at-risk/nudge').send({ courseId: 'c1', userId: 's1' });
    expect(await statusOf('s1')).toBe('NONE');
  });
});

// ---------------------------------------------------------------------------
describe('sending', () => {
  it('sends once, marks the row, and never re-sends', async () => {
    await queue('t-h', 's1', { title: 'Midterm graded', body: 'Score: 91', link: '/courses/c1/gradebook' });
    const r = await dispatch();
    expect(r).toMatchObject({ sent: 1, failed: 0, held: 0, dropped: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 's1@x.edu', subject: 'Midterm graded' });
    expect(sent[0].text).toContain('Score: 91');
    expect(sent[0].text).toContain('Open: http://localhost:3000/courses/c1/gradebook');
    expect(sent[0].text).toContain('Harvard');
    const row = (await admin.notification.findFirst({ where: { userId: 's1' } }))!;
    expect(row).toMatchObject({ emailStatus: 'SENT', emailAttempts: 1 });
    expect(row.emailedAt).toBeTruthy();

    expect((await dispatch()).sent).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('sends each person’s mail to their own address, tenant by tenant', async () => {
    await queue('t-h', 's1');
    await queue('t-m', 'm1', { title: 'MIT notice' });
    const r = await dispatch();
    expect(r.sent).toBe(2);
    expect(sent.map((m) => m.to).sort()).toEqual(['m1@x.edu', 's1@x.edu']);
    expect(sent.find((m) => m.to === 'm1@x.edu')!.text).toContain('MIT');
  });

  it('skips suspended tenants entirely', async () => {
    await queue('t-s', 'f1');
    expect((await dispatch()).sent).toBe(0);
    expect(await statusOf('f1')).toBe('PENDING');
  });

  it('puts the in-app notification and the e-mail on the same record', async () => {
    await queue('t-h', 's1');
    await dispatch();
    const s1 = request.agent(app);
    await s1
      .post('/api/v1/auth/login')
      .set('x-tenant-id', 'harvard')
      .send({ email: 's1@x.edu', password: pw('harvard') });
    const list = await s1.get('/api/v1/notifications');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].emailStatus).toBeUndefined(); // delivery bookkeeping is not exposed
  });
});

// ---------------------------------------------------------------------------
describe('quiet hours', () => {
  it('holds mail during the quiet window and sends it afterwards', async () => {
    await admin.notificationPreference.create({
      data: { tenantId: 't-h', userId: 's1', quietStartHour: 22, quietEndHour: 7, timezone: 'UTC' },
    });
    await queue('t-h', 's1');

    expect(await dispatch({ now: at(23) })).toMatchObject({ sent: 0, held: 1 });
    expect(await dispatch({ now: at(3) })).toMatchObject({ sent: 0, held: 1 });
    expect(await statusOf('s1')).toBe('PENDING'); // waiting, not lost
    expect(sent).toHaveLength(0);

    expect(await dispatch({ now: at(8) })).toMatchObject({ sent: 1, held: 0 });
    expect(sent).toHaveLength(1);
  });

  it('evaluates the window in the user’s own time zone', async () => {
    await admin.notificationPreference.create({
      data: { tenantId: 't-h', userId: 's2', quietStartHour: 22, quietEndHour: 7, timezone: 'Asia/Kolkata' },
    });
    await queue('t-h', 's2');
    // 17:00 UTC is 22:30 in Kolkata: quiet. 03:00 UTC is 08:30 there: not quiet, although 03:00 UTC itself is.
    expect((await dispatch({ now: at(17) })).held).toBe(1);
    expect((await dispatch({ now: at(3) })).sent).toBe(1);
  });

  it('does not hold users who have no quiet hours', async () => {
    await queue('t-h', 's1');
    expect((await dispatch({ now: at(2) })).sent).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('changes after queuing', () => {
  it('cancels mail for people who were deactivated or opted out in the meantime', async () => {
    await queue('t-h', 's1');
    await queue('t-h', 's2');
    await admin.user.update({ where: { id: 's1' }, data: { status: 'SUSPENDED' } });
    await admin.notificationPreference.create({ data: { tenantId: 't-h', userId: 's2', emailEnabled: false } });
    expect(await dispatch()).toMatchObject({ sent: 0, dropped: 2 });
    expect(await statusOf('s1')).toBe('NONE');
    expect(await statusOf('s2')).toBe('NONE');
    expect(sent).toHaveLength(0);
  });

  it('drops mail that has waited more than 48 hours', async () => {
    await queue('t-h', 's1');
    await admin.notification.updateMany({ data: { createdAt: new Date(Date.now() - 49 * 3_600_000) } });
    expect(await dispatch()).toMatchObject({ sent: 0, dropped: 1 });
    expect(sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('failures and concurrency', () => {
  it('retries a transient failure on the next run', async () => {
    await queue('t-h', 's1');
    failures = 1;
    expect(await dispatch()).toMatchObject({ sent: 0, failed: 1 });
    const row = (await admin.notification.findFirst({ where: { userId: 's1' } }))!;
    expect(row).toMatchObject({ emailStatus: 'PENDING', emailAttempts: 1 });
    expect(await dispatch()).toMatchObject({ sent: 1, failed: 0 });
    expect(await statusOf('s1')).toBe('SENT');
  });

  it('gives up after five attempts and then stops trying', async () => {
    await queue('t-h', 's1');
    failAlways = true;
    for (let i = 0; i < 5; i++) expect((await dispatch()).failed).toBe(1);
    expect(await statusOf('s1')).toBe('FAILED');
    failAlways = false;
    expect(await dispatch()).toMatchObject({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });

  it('never sends the same notification twice when runs overlap', async () => {
    for (const s of ['s1', 's2', 's3', 's4', 's5']) await queue('t-h', s, { title: `For ${s}` });
    const runs = await Promise.all([dispatch(), dispatch(), dispatch()]);
    expect(runs.reduce((n, r) => n + r.sent, 0)).toBe(5);
    expect(sent).toHaveLength(5);
    expect(new Set(sent.map((m) => m.to)).size).toBe(5);
    expect(await admin.notification.count({ where: { emailStatus: 'SENT' } })).toBe(5);
  });

  it('respects the batch size', async () => {
    for (const s of ['s1', 's2', 's3', 's4', 's5']) await queue('t-h', s);
    expect((await dispatch({ batch: 2 })).sent).toBe(2);
    expect((await dispatch({ batch: 2 })).sent).toBe(2);
    expect((await dispatch({ batch: 2 })).sent).toBe(1);
    expect((await dispatch({ batch: 2 })).sent).toBe(0);
  });

  it('keeps going when one tenant has trouble', async () => {
    await queue('t-h', 's1');
    await queue('t-m', 'm1');
    failures = 1; // the first send fails; the other tenant's still goes out
    const r = await dispatch();
    expect(r.sent + r.failed).toBe(2);
    expect(r.sent).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('student to-do list', () => {
  const day = 86_400_000;
  const login = async (who: string, tenant = 'harvard') => {
    const a = request.agent(app);
    const r = await a
      .post('/api/v1/auth/login')
      .set('x-tenant-id', tenant)
      .send({ email: `${who}@x.edu`, password: pw(tenant) });
    expect(r.status).toBe(200);
    return a;
  };

  beforeAll(async () => {
    const asg = (id: string, title: string, dueMs: number | null, courseId = 'c1') =>
      admin.assignment.create({
        data: { id, tenantId: 't-h', courseId, title, instructions: 'x', dueDate: dueMs === null ? null : new Date(Date.now() + dueMs) },
      });
    await asg('t-late', 'Late lab', -2 * day);
    await asg('t-a', 'Essay A', day);
    await asg('t-b', 'Essay B', 3 * day);
    await asg('t-pending', 'Pending essay', 2 * day);
    await asg('t-none', 'Reading response', null);
    await asg('t-graded', 'Graded already', day);
    await admin.assignmentSubmission.create({ data: { id: 'ts-pending', assignmentId: 't-pending', userId: 's1', submissionText: 'x' } });
    await admin.assignmentSubmission.create({
      data: { id: 'ts-graded', assignmentId: 't-graded', userId: 's1', submissionText: 'x', grade: 5, gradedAt: new Date() },
    });

    const quiz = (id: string, title: string, maxAttempts: number, questions: boolean) =>
      admin.quiz.create({
        data: {
          id,
          tenantId: 't-h',
          courseId: 'c1',
          title,
          maxAttempts,
          requireProctoring: id === 'tq-d',
          ...(questions
            ? { questions: { create: [{ id: `${id}-q`, questionText: 'Q?', questionType: 'TRUE_FALSE', correctAnswer: 'true' }] } }
            : {}),
        },
      });
    await quiz('tq-a', 'Quiz A', 2, true);
    await quiz('tq-b', 'Quiz B', 1, true);
    await quiz('tq-c', 'Quiz C (empty)', 1, false);
    await quiz('tq-d', 'Quiz D', 1, true);
    const sub = (id: string, quizId: string, done: boolean) =>
      admin.quizSubmission.create({
        data: { id, quizId, userId: 's1', maxScore: 1, answersJson: {}, ...(done ? { submittedAt: new Date(), score: 0 } : {}) },
      });
    await sub('tqs-a', 'tq-a', true);
    await sub('tqs-b', 'tq-b', true);
    await sub('tqs-d', 'tq-d', false); // attempt in progress

    // Work that must never appear for s1: a draft course, a dropped enrolment, another tenant.
    await admin.course.create({ data: { id: 'c-draft', tenantId: 't-h', code: 'D1', title: 'Draft', status: 'DRAFT' } });
    await admin.course.create({ data: { id: 'c-dropped', tenantId: 't-h', code: 'X1', title: 'Dropped', status: 'PUBLISHED' } });
    await admin.enrollment.create({ data: { id: 'e-draft', tenantId: 't-h', courseId: 'c-draft', userId: 's1', status: 'ENROLLED' } });
    await admin.enrollment.create({ data: { id: 'e-dropped', tenantId: 't-h', courseId: 'c-dropped', userId: 's1', status: 'DROPPED' } });
    await asg('t-draft', 'Draft course work', day, 'c-draft');
    await asg('t-dropped', 'Dropped course work', day, 'c-dropped');
    await admin.course.create({ data: { id: 'cm', tenantId: 't-m', code: 'M1', title: 'MIT', status: 'PUBLISHED' } });
    await admin.enrollment.create({ data: { id: 'em', tenantId: 't-m', courseId: 'cm', userId: 'm1', status: 'ENROLLED' } });
    await admin.assignment.create({ data: { id: 't-mit', tenantId: 't-m', courseId: 'cm', title: 'MIT only', instructions: 'x' } });
  });

  it('lists the learner’s own upcoming work, soonest first, with quizzes after assignments', async () => {
    const res = await (await login('s1')).get('/api/v1/enrollments/todo');
    expect(res.status).toBe(200);
    expect(res.body.data.map((i: any) => i.title)).toEqual([
      'Late lab',
      'Essay A',
      'Pending essay',
      'Essay B',
      'Reading response',
      'Quiz A',
      'Quiz D',
    ]);
    const by = Object.fromEntries(res.body.data.map((i: any) => [i.title, i]));
    expect(by['Late lab']).toMatchObject({ type: 'ASSIGNMENT', overdue: true, submitted: false, course: { code: 'C1' } });
    expect(by['Essay A'].overdue).toBe(false);
    expect(by['Pending essay']).toMatchObject({ submitted: true, overdue: false }); // submitted, awaiting a grade
    expect(by['Reading response'].dueAt).toBeNull();
    expect(by['Quiz A']).toMatchObject({ type: 'QUIZ', attemptsRemaining: 1, hasOpenAttempt: false });
    expect(by['Quiz D']).toMatchObject({ attemptsRemaining: 0, hasOpenAttempt: true, requireProctoring: true });
  });

  it('leaves out graded work, used-up quizzes, empty quizzes, drafts, dropped courses and other tenants', async () => {
    const titles = (await (await login('s1')).get('/api/v1/enrollments/todo')).body.data.map((i: any) => i.title);
    for (const hidden of ['Graded already', 'Quiz B', 'Quiz C (empty)', 'Draft course work', 'Dropped course work', 'MIT only']) {
      expect(titles, hidden).not.toContain(hidden);
    }
  });

  it('is private to the caller and requires a login', async () => {
    expect((await (await login('s2')).get('/api/v1/enrollments/todo')).body.data).toEqual([]); // not enrolled anywhere
    expect((await (await login('m1', 'mit')).get('/api/v1/enrollments/todo')).body.data.map((i: any) => i.title)).toEqual(['MIT only']);
    expect((await request(app).get('/api/v1/enrollments/todo')).status).toBe(401);
  });
});
