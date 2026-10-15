import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import http from 'http';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';
import { totp, base32Decode } from '../src/lib/totp';

// Engagement (notifications, forums, calendar, gamification), intelligence (xAPI LRS, proctoring,
// early warning) and scale (MFA, SCIM, webhooks, features, usage, export, LTI) against a real
// PostgreSQL with the real migrations and the unprivileged lms_app role.

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
// These modules create the Prisma client on import, so they load only once DATABASE_URL is set.
let nextStreak: typeof import('../src/lib/gamification.js').nextStreak;
let inQuietHours: typeof import('../src/lib/notify.js').inQuietHours;
let scoreRisk: typeof import('../src/lib/risk.js').scoreRisk;
let assessProctoring: typeof import('../src/lib/risk.js').assessProctoring;
let resolveFeatures: typeof import('../src/lib/features.js').resolveFeatures;
let signPayload: typeof import('../src/lib/webhooks.js').signPayload;
let encryptSecret: typeof import('../src/lib/mfa.js').encryptSecret;
const pw = (slug: string) => `${PASSWORD}-${slug}`;

async function seed() {
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'Harvard', tier: 'ENTERPRISE' } });
  await admin.tenant.create({ data: { id: 't-m', slug: 'mit', name: 'MIT', tier: 'STARTER' } });
  const user = (id: string, tenantId: string, slug: string, role: any, extra: object = {}) =>
    admin.user.create({
      data: { id, tenantId, email: `${id}@x.edu`, firstName: id, lastName: `Last${id}`, role, passwordHash: bcrypt.hashSync(pw(slug), 4), emailVerified: true, ...extra },
    });
  await user('admin', 't-h', 'harvard', 'TENANT_ADMIN');
  await user('auditor', 't-h', 'harvard', 'AUDITOR');
  await user('teacher', 't-h', 'harvard', 'INSTRUCTOR');
  await user('teacher2', 't-h', 'harvard', 'INSTRUCTOR');
  for (const s of ['s1', 's2', 's3', 's4']) await user(s, 't-h', 'harvard', 'STUDENT');
  await user('m-admin', 't-m', 'mit', 'TENANT_ADMIN');
  await user('m-student', 't-m', 'mit', 'STUDENT');

  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'Course c1', status: 'PUBLISHED', allowSelfEnroll: true, passingGradePercent: 50 } });
  await admin.course.create({ data: { id: 'm1', tenantId: 't-m', code: 'M1', title: 'MIT course', status: 'PUBLISHED' } });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'teacher', isPrimary: true } });
  for (const [id, u] of [['e-s1', 's1'], ['e-s3', 's3'], ['e-s4', 's4']]) {
    await admin.enrollment.create({ data: { id, tenantId: 't-h', courseId: 'c1', userId: u, status: 'IN_PROGRESS', progressPercent: 10 } });
  }
  await admin.enrollment.create({ data: { id: 'e-m', tenantId: 't-m', courseId: 'm1', userId: 'm-student' } });

  await admin.quiz.create({
    data: {
      id: 'q-proc', tenantId: 't-h', courseId: 'c1', title: 'Proctored', requireProctoring: true, maxAttempts: 2, passingPercent: 50,
      questions: { create: [{ id: 'qq1', questionText: '2+2?', questionType: 'MULTIPLE_CHOICE', points: 1, optionsJson: [{ id: 'a', text: '4', isCorrect: true }, { id: 'b', text: '5', isCorrect: false }] }] },
    },
  });
  await admin.quiz.create({ data: { id: 'q-plain', tenantId: 't-h', courseId: 'c1', title: 'Plain', maxAttempts: 3, passingPercent: 50,
    questions: { create: [{ id: 'qq2', questionText: '1+1?', questionType: 'MULTIPLE_CHOICE', points: 1, optionsJson: [{ id: 'a', text: '2', isCorrect: true }, { id: 'b', text: '3', isCorrect: false }] }] } } });
  await admin.quizSubmission.create({ data: { id: 'sub-open', quizId: 'q-proc', userId: 's1', maxScore: 1, answersJson: {} } });
  await admin.quizSubmission.create({ data: { id: 'sub-done', quizId: 'q-proc', userId: 's3', maxScore: 1, score: 0, submittedAt: new Date(), attemptNumber: 1, answersJson: {} } });
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await seed();
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  ({ nextStreak } = await import('../src/lib/gamification.js'));
  ({ inQuietHours } = await import('../src/lib/notify.js'));
  ({ scoreRisk, assessProctoring } = await import('../src/lib/risk.js'));
  ({ resolveFeatures } = await import('../src/lib/features.js'));
  ({ signPayload } = await import('../src/lib/webhooks.js'));
  ({ encryptSecret } = await import('../src/lib/mfa.js'));
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

async function as(who: string, tenant: 'harvard' | 'mit' = 'harvard') {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('x-tenant-id', tenant).send({ email: `${who}@x.edu`, password: pw(tenant) });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

const until = async (fn: () => Promise<boolean>, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

// ---------------------------------------------------------------------------
describe('pure helpers', () => {
  it('computes RFC 6238 TOTP (SHA-1 test vector)', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(totp(secret, 59_000)).toBe('287082');
    expect(totp(secret, 1_111_111_109_000)).toBe('081804');
  });

  it('extends, keeps or restarts a streak', () => {
    const d = (s: string) => new Date(`${s}T12:00:00Z`);
    expect(nextStreak(null, d('2026-01-05'), 0)).toBe(1);
    expect(nextStreak(d('2026-01-05'), d('2026-01-05'), 4)).toBe(4);
    expect(nextStreak(d('2026-01-04'), d('2026-01-05'), 4)).toBe(5);
    expect(nextStreak(d('2026-01-02'), d('2026-01-05'), 4)).toBe(1);
  });

  it('handles quiet hours that wrap past midnight', () => {
    expect(inQuietHours(23, 22, 7)).toBe(true);
    expect(inQuietHours(3, 22, 7)).toBe(true);
    expect(inQuietHours(12, 22, 7)).toBe(false);
    expect(inQuietHours(9, 9, 17)).toBe(true);
    expect(inQuietHours(17, 9, 17)).toBe(false);
    expect(inQuietHours(5, null, null)).toBe(false);
  });

  it('scores risk and flags proctoring', () => {
    expect(scoreRisk({ progressPercent: 90, failedQuizzes: 0, avgQuizPercent: 90, daysInactive: 1, proctoringFlags: 0, plagiarismMax: null }).level).toBe('LOW');
    expect(scoreRisk({ progressPercent: 10, failedQuizzes: 2, avgQuizPercent: 40, daysInactive: 9, proctoringFlags: 0, plagiarismMax: null }).level).toBe('HIGH');
    expect(assessProctoring([{ severity: 'HIGH' }, { severity: 'HIGH' }]).flagged).toBe(false);
    expect(assessProctoring([{ severity: 'HIGH' }, { severity: 'HIGH' }, { severity: 'HIGH' }]).flagged).toBe(true);
    expect(assessProctoring(Array(12).fill({ severity: 'LOW' })).flagged).toBe(true);
  });

  it('applies plan defaults and per-tenant overrides to features', () => {
    expect(resolveFeatures('STARTER', null).scim).toBe(false);
    expect(resolveFeatures('ENTERPRISE', null).scim).toBe(true);
    expect(resolveFeatures('ENTERPRISE', { scim: false, bogus: true }).scim).toBe(false);
    expect(resolveFeatures('STARTER', { webhooks: true }).webhooks).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('notifications', () => {
  it('delivers, lists, counts and marks read, only for the owner', async () => {
    const teacher = await as('teacher');
    expect((await teacher.post('/api/v1/analytics/at-risk/nudge').send({ courseId: 'c1', userId: 's1', message: 'Catch up!' })).status).toBe(201);

    const s1 = await as('s1');
    const list = await s1.get('/api/v1/notifications');
    expect(list.status).toBe(200);
    expect(list.body.unreadCount).toBeGreaterThanOrEqual(1);
    const n = list.body.data.find((x: any) => x.body === 'Catch up!');
    expect(n).toBeTruthy();

    // Another user cannot read or delete it.
    const s2 = await as('s2');
    expect((await s2.post(`/api/v1/notifications/${n.id}/read`)).status).toBe(404);
    expect((await s2.delete(`/api/v1/notifications/${n.id}`)).status).toBe(404);
    expect((await s2.get('/api/v1/notifications')).body.data.find((x: any) => x.id === n.id)).toBeUndefined();

    expect((await s1.post(`/api/v1/notifications/${n.id}/read`)).status).toBe(200);
    const unread = await s1.get('/api/v1/notifications?unreadOnly=true');
    expect(unread.body.data.find((x: any) => x.id === n.id)).toBeUndefined();

    expect((await s1.post('/api/v1/notifications/read-all')).status).toBe(200);
    expect((await s1.get('/api/v1/notifications')).body.unreadCount).toBe(0);
    expect((await s1.delete(`/api/v1/notifications/${n.id}`)).status).toBe(204);
  });

  it('honours muted categories and validates preferences', async () => {
    const s3 = await as('s3');
    const put = await s3.put('/api/v1/notifications/preferences').send({ mutedCategories: ['COURSE'], quietStartHour: 22, quietEndHour: 7, timezone: 'Asia/Kolkata' });
    expect(put.status).toBe(200);
    expect(put.body.data.mutedCategories).toEqual(['COURSE']);
    expect((await s3.get('/api/v1/notifications/preferences')).body.data.timezone).toBe('Asia/Kolkata');

    await (await as('teacher')).post('/api/v1/analytics/at-risk/nudge').send({ courseId: 'c1', userId: 's3' });
    expect((await s3.get('/api/v1/notifications')).body.data).toHaveLength(0); // muted

    expect((await s3.put('/api/v1/notifications/preferences').send({ timezone: 'Mars/Olympus' })).status).toBe(400);
    expect((await s3.put('/api/v1/notifications/preferences').send({ quietStartHour: 25 })).status).toBe(400);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/notifications')).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('discussion forums', () => {
  let threadId: string;
  let postId: string;

  it('lets enrolled learners post and keeps outsiders out', async () => {
    const s1 = await as('s1');
    const created = await s1.post('/api/v1/courses/c1/threads').send({ title: 'How does Raft elect a leader?', body: 'I am confused', category: 'Consensus' });
    expect(created.status).toBe(201);
    threadId = created.body.data.id;

    const s2 = await as('s2'); // not enrolled
    expect((await s2.get('/api/v1/courses/c1/threads')).status).toBe(403);
    expect((await s2.post('/api/v1/courses/c1/threads').send({ title: 'sneaky', body: 'x' })).status).toBe(403);
    expect((await s2.get(`/api/v1/threads/${threadId}`)).status).toBe(403);
    expect((await (await as('m-student', 'mit')).get(`/api/v1/threads/${threadId}`)).status).toBe(404); // other tenant
  });

  it('abbreviates learner names for learners but not for staff', async () => {
    const s4 = await as('s4');
    const asLearner = (await s4.get('/api/v1/courses/c1/threads')).body.data[0];
    expect(asLearner.author.name).toBe('s1 L.');

    const teacher = await as('teacher');
    const asStaff = (await teacher.get('/api/v1/courses/c1/threads')).body.data[0];
    expect(asStaff.author.name).toBe('s1 Lasts1');
  });

  it('threads replies, notifies the author and validates input', async () => {
    const teacher = await as('teacher');
    const reply = await teacher.post(`/api/v1/threads/${threadId}/posts`).send({ body: 'Randomised election timeouts.' });
    expect(reply.status).toBe(201);
    postId = reply.body.data.id;

    const nested = await (await as('s4')).post(`/api/v1/threads/${threadId}/posts`).send({ body: 'Thanks!', parentId: postId });
    expect(nested.status).toBe(201);
    expect((await teacher.post(`/api/v1/threads/${threadId}/posts`).send({ body: 'x', parentId: 'nope' })).status).toBe(400);
    expect((await teacher.post(`/api/v1/threads/${threadId}/posts`).send({ body: '' })).status).toBe(400);

    const notes = (await (await as('s1')).get('/api/v1/notifications?category=FORUM')).body.data;
    expect(notes.some((n: any) => n.title.includes('New reply'))).toBe(true);

    const detail = await (await as('s1')).get(`/api/v1/threads/${threadId}`);
    expect(detail.body.data.posts).toHaveLength(2);
  });

  it('toggles votes and counts them once per user', async () => {
    const s1 = await as('s1');
    const up = await s1.post('/api/v1/votes').send({ targetType: 'POST', targetId: postId });
    expect(up.body.data).toMatchObject({ voted: true, upvotes: 1 });
    const up2 = await (await as('s4')).post('/api/v1/votes').send({ targetType: 'POST', targetId: postId });
    expect(up2.body.data.upvotes).toBe(2);
    const off = await s1.post('/api/v1/votes').send({ targetType: 'POST', targetId: postId });
    expect(off.body.data).toMatchObject({ voted: false, upvotes: 1 });
    expect((await (await as('s2')).post('/api/v1/votes').send({ targetType: 'POST', targetId: postId })).status).toBe(403);
    expect((await s1.post('/api/v1/votes').send({ targetType: 'POST', targetId: 'missing' })).status).toBe(404);
  });

  it('lets only course staff endorse, pin, lock and hide', async () => {
    const s1 = await as('s1');
    const teacher = await as('teacher');
    expect((await s1.post(`/api/v1/posts/${postId}/endorse`)).status).toBe(403);
    expect((await (await as('teacher2')).post(`/api/v1/posts/${postId}/endorse`)).status).toBe(403); // not assigned
    expect((await teacher.post(`/api/v1/posts/${postId}/endorse`)).body.data.endorsed).toBe(true);

    expect((await s1.patch(`/api/v1/threads/${threadId}/moderate`).send({ pinned: true })).status).toBe(403);
    expect((await teacher.patch(`/api/v1/threads/${threadId}/moderate`).send({})).status).toBe(400);
    expect((await teacher.patch(`/api/v1/threads/${threadId}/moderate`).send({ pinned: true, locked: true })).status).toBe(200);

    expect((await s1.post(`/api/v1/threads/${threadId}/posts`).send({ body: 'locked?' })).status).toBe(409);
    expect((await teacher.post(`/api/v1/threads/${threadId}/posts`).send({ body: 'staff may still reply' })).status).toBe(201);
    expect((await teacher.patch(`/api/v1/threads/${threadId}/moderate`).send({ locked: false })).status).toBe(200);
  });

  it('runs the report and moderation queue, and hides content from learners', async () => {
    const s4 = await as('s4');
    expect((await s4.post('/api/v1/flags').send({ targetType: 'POST', targetId: postId, reason: 'Spam' })).status).toBe(201);
    expect((await s4.post('/api/v1/flags').send({ targetType: 'POST', targetId: postId, reason: 'Spam' })).status).toBe(409);

    const teacher = await as('teacher');
    expect((await s4.get('/api/v1/courses/c1/flags')).status).toBe(403);
    const queue = await teacher.get('/api/v1/courses/c1/flags');
    expect(queue.body.data).toHaveLength(1);
    expect((await teacher.post(`/api/v1/flags/${queue.body.data[0].id}/resolve`)).status).toBe(200);
    expect((await teacher.get('/api/v1/courses/c1/flags')).body.data).toHaveLength(0);

    expect((await teacher.patch(`/api/v1/posts/${postId}/moderate`).send({ hidden: true })).status).toBe(200);
    expect((await (await as('s1')).get(`/api/v1/threads/${threadId}`)).body.data.posts.map((p: any) => p.id)).not.toContain(postId);
    expect((await teacher.get(`/api/v1/threads/${threadId}`)).body.data.posts.map((p: any) => p.id)).toContain(postId);

    await teacher.patch(`/api/v1/threads/${threadId}/moderate`).send({ hidden: true });
    expect((await s4.get(`/api/v1/threads/${threadId}`)).status).toBe(404);
    expect((await s4.get('/api/v1/courses/c1/threads')).body.data).toHaveLength(0);
    expect((await teacher.get('/api/v1/courses/c1/threads?includeHidden=true')).body.data).toHaveLength(1);
    await teacher.patch(`/api/v1/threads/${threadId}/moderate`).send({ hidden: false });
  });

  it('lets auditors read but not write', async () => {
    const auditor = await as('auditor');
    expect((await auditor.get('/api/v1/courses/c1/threads')).status).toBe(200);
    expect((await auditor.post('/api/v1/courses/c1/threads').send({ title: 'nope', body: 'x' })).status).toBe(403);
  });

  it('does not make unrelated root-level API paths require a login', async () => {
    const res = await request(app).get('/api/v1/certificates/verify/CERT-NONE?tenant=harvard');
    expect(res.status).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('calendar', () => {
  const start = new Date(Date.now() + 3 * 86_400_000);
  const end = new Date(start.getTime() + 3_600_000);
  let eventId: string;

  it('lets course editors schedule and enrolled learners see it', async () => {
    const teacher = await as('teacher');
    const res = await teacher.post('/api/v1/calendar/events').send({ title: 'Midterm', category: 'EXAM', courseId: 'c1', startsAt: start, endsAt: end, timezone: 'Europe/London' });
    expect(res.status).toBe(201);
    eventId = res.body.data.id;

    const mine = await (await as('s1')).get('/api/v1/calendar/events');
    expect(mine.body.data.map((e: any) => e.id)).toContain(eventId);
    expect(mine.body.nextDeadline?.id).toBe(eventId);
    expect((await (await as('s2')).get('/api/v1/calendar/events')).body.data.map((e: any) => e.id)).not.toContain(eventId);
    expect((await (await as('s2')).get('/api/v1/calendar/events?courseId=c1')).body.data).toEqual([]);
  });

  it('enforces who may create, change and delete events', async () => {
    const body = { title: 'X', category: 'LAB', courseId: 'c1', startsAt: start, endsAt: end };
    expect((await (await as('s1')).post('/api/v1/calendar/events').send(body)).status).toBe(403);
    expect((await (await as('teacher2')).post('/api/v1/calendar/events').send(body)).status).toBe(403);
    expect((await (await as('teacher')).post('/api/v1/calendar/events').send({ ...body, courseId: undefined })).status).toBe(403); // tenant-wide: admin only
    expect((await (await as('teacher')).post('/api/v1/calendar/events').send({ ...body, endsAt: new Date(start.getTime() - 1000) })).status).toBe(400);
    expect((await (await as('teacher')).post('/api/v1/calendar/events').send({ ...body, timezone: 'Nowhere/City' })).status).toBe(400);

    expect((await (await as('teacher2')).patch(`/api/v1/calendar/events/${eventId}`).send({ title: 'hijack' })).status).toBe(403);
    expect((await (await as('teacher')).patch(`/api/v1/calendar/events/${eventId}`).send({ title: 'Midterm (moved)' })).status).toBe(200);
    expect((await (await as('teacher')).patch(`/api/v1/calendar/events/${eventId}`).send({ endsAt: new Date(start.getTime() - 1000) })).status).toBe(400);
  });

  it('shows tenant-wide events to everyone and exports valid iCalendar', async () => {
    const admin1 = await as('admin');
    const all = await admin1.post('/api/v1/calendar/events').send({ title: 'Campus closed, holiday', category: 'DEADLINE', startsAt: start, endsAt: end });
    expect(all.status).toBe(201);
    expect((await (await as('s2')).get('/api/v1/calendar/events')).body.data.map((e: any) => e.id)).toContain(all.body.data.id);

    const ics = await (await as('s1')).get('/api/v1/calendar/export.ics');
    expect(ics.status).toBe(200);
    expect(ics.headers['content-type']).toMatch(/text\/calendar/);
    expect(ics.text).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics.text).toContain('BEGIN:VEVENT');
    expect(ics.text).toContain('Campus closed\\, holiday'); // comma escaped
    expect(ics.text).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(ics.text.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('deletes events and never crosses tenants', async () => {
    expect((await (await as('m-admin', 'mit')).get('/api/v1/calendar/events')).body.data).toEqual([]);
    expect((await (await as('m-admin', 'mit')).delete(`/api/v1/calendar/events/${eventId}`)).status).toBe(404);
    expect((await (await as('teacher')).delete(`/api/v1/calendar/events/${eventId}`)).status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
describe('gamification', () => {
  it('claims a daily streak once and awards XP', async () => {
    const s4 = await as('s4');
    const first = await s4.post('/api/v1/gamification/checkin');
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ alreadyClaimed: false, streakDays: 1 });
    expect(first.body.data.awarded).toBeGreaterThan(0);
    const second = await s4.post('/api/v1/gamification/checkin');
    expect(second.body.data).toMatchObject({ alreadyClaimed: true, awarded: 0, xp: first.body.data.xp });
    const me = await s4.get('/api/v1/gamification/me');
    expect(me.body.data.level).toBe(1);
    expect(me.body.data.recent[0].source).toBe('DAILY_STREAK');
  });

  it('awards quiz XP exactly once and records xAPI for the attempt', async () => {
    const s1 = await as('s1');
    const before = (await s1.get('/api/v1/gamification/me')).body.data.xp;
    const r1 = await s1.post('/api/v1/quizzes/q-plain/submit').send({ answers: { qq2: 'a' } });
    expect(r1.status).toBe(201);
    expect(r1.body.data.passed).toBe(true);
    const r2 = await s1.post('/api/v1/quizzes/q-plain/submit').send({ answers: { qq2: 'a' } });
    expect(r2.status).toBe(201);
    const after = (await s1.get('/api/v1/gamification/me')).body.data;
    expect(after.xp - before).toBe(100 + 0); // quiz XP once; streak is claimed separately
    expect(after.streakDays).toBeGreaterThanOrEqual(1);

    const stmts = await (await as('teacher')).get('/api/v1/analytics/xapi/stream?actorEmail=s1@x.edu&verb=http://adlnet.gov/expapi/verbs/passed');
    expect(stmts.body.total).toBeGreaterThanOrEqual(2);
    expect(stmts.body.statements[0].verb.display['en-US']).toBe('passed');
  });

  it('shows an abbreviated cohort leaderboard to course members only', async () => {
    const board = await (await as('s4')).get('/api/v1/gamification/leaderboard?courseId=c1');
    expect(board.status).toBe(200);
    expect(board.body.data[0].rank).toBe(1);
    expect(board.body.data.every((r: any) => /^s\d L\.$/.test(r.name))).toBe(true);
    expect(board.body.data.some((r: any) => r.isMe)).toBe(true);
    expect(JSON.stringify(board.body)).not.toContain('@x.edu');
    expect((await (await as('s2')).get('/api/v1/gamification/leaderboard?courseId=c1')).status).toBe(403);
    expect((await (await as('s4')).get('/api/v1/gamification/leaderboard')).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('xAPI learning record store', () => {
  const stmt = (mbox: string, id?: string) => ({
    ...(id ? { id } : {}),
    actor: { mbox: `mailto:${mbox}`, name: 'Someone' },
    verb: { id: 'http://adlnet.gov/expapi/verbs/experienced', display: { 'en-US': 'experienced' } },
    object: { id: 'https://learn.example.edu/xapi/activities/lecture-1' },
  });

  it('stores a learner’s own statement and refuses other actors', async () => {
    const s3 = await as('s3');
    const own = await s3.post('/api/v1/xapi/statements').send(stmt('s3@x.edu'));
    expect(own.status).toBe(201);
    expect(own.body.statementId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await s3.post('/api/v1/xapi/statements').send(stmt('s1@x.edu'))).status).toBe(403);
    expect((await s3.post('/api/v1/xapi/statements').send({ actor: {}, verb: {}, object: {} })).status).toBe(400);
    expect((await s3.post('/api/v1/xapi/statements').send({ ...stmt('s3@x.edu'), id: 'not-a-uuid' })).status).toBe(400);
    expect((await request(app).post('/api/v1/xapi/statements').send(stmt('s3@x.edu'))).status).toBe(401);
  });

  it('is idempotent on id, rejects conflicting reuse, and accepts batches', async () => {
    const id = crypto.randomUUID();
    const s3 = await as('s3');
    expect((await s3.post('/api/v1/xapi/statements').send(stmt('s3@x.edu', id))).body.stored).toBe(1);
    const again = await s3.post('/api/v1/xapi/statements').send(stmt('s3@x.edu', id));
    expect(again.status).toBe(201);
    expect(again.body.stored).toBe(0);
    const clash = { ...stmt('s3@x.edu', id), verb: { id: 'http://adlnet.gov/expapi/verbs/failed' } };
    expect((await s3.post('/api/v1/xapi/statements').send(clash)).status).toBe(409);

    const batch = await s3.post('/api/v1/xapi/statements').send([stmt('s3@x.edu'), stmt('s3@x.edu')]);
    expect(batch.status).toBe(200);
    expect(batch.body.statementIds).toHaveLength(2);
    expect((await s3.post('/api/v1/xapi/statements').send([])).status).toBe(400);
    expect((await s3.post('/api/v1/xapi/statements').send(Array(51).fill(stmt('s3@x.edu')))).status).toBe(400);
  });

  it('scopes the stream: learners see only their own, staff see the tenant, tenants are isolated', async () => {
    const own = await (await as('s3')).get('/api/v1/analytics/xapi/stream?limit=100');
    expect(own.body.statements.every((s: any) => s.actor.mbox === 'mailto:s3@x.edu')).toBe(true);
    const asLearnerAskingForOthers = await (await as('s3')).get('/api/v1/analytics/xapi/stream?actorEmail=s1@x.edu');
    expect(asLearnerAskingForOthers.body.statements.every((s: any) => s.actor.mbox === 'mailto:s3@x.edu')).toBe(true);

    const staff = await (await as('teacher')).get('/api/v1/analytics/xapi/stream?limit=100');
    const actors = new Set(staff.body.statements.map((s: any) => s.actor.mbox));
    expect(actors.size).toBeGreaterThan(1);
    expect((await (await as('m-admin', 'mit')).get('/api/v1/analytics/xapi/stream')).body.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('proctoring telemetry', () => {
  const ev = (severity: string, eventType = 'TAB_SWITCH') => ({ submissionId: 'sub-open', eventType, severity });

  it('records events for the test taker’s own open attempt only', async () => {
    const s1 = await as('s1');
    const ok = await s1.post('/api/v1/proctoring/events').send(ev('LOW'));
    expect(ok.status).toBe(201);
    expect(ok.body.flagged).toBe(false);
    expect((await (await as('s4')).post('/api/v1/proctoring/events').send(ev('HIGH'))).status).toBe(404); // someone else's
    expect((await s1.post('/api/v1/proctoring/events').send({ ...ev('HIGH'), eventType: 'MADE_UP' })).status).toBe(400);
    expect((await s1.post('/api/v1/proctoring/events').send({ ...ev('HIGH'), snapshotUrl: 'javascript:alert(1)' })).status).toBe(400);
    expect((await (await as('s3')).post('/api/v1/proctoring/events').send({ submissionId: 'sub-done', eventType: 'TAB_SWITCH', severity: 'HIGH' })).status).toBe(409);
  });

  it('flags after repeated HIGH events and alerts the course staff once', async () => {
    const s1 = await as('s1');
    expect((await s1.post('/api/v1/proctoring/events').send(ev('HIGH', 'MULTIPLE_FACES'))).body.flagged).toBe(false);
    expect((await s1.post('/api/v1/proctoring/events').send(ev('HIGH', 'MULTIPLE_FACES'))).body.flagged).toBe(false);
    const third = await s1.post('/api/v1/proctoring/events').send(ev('HIGH', 'FACE_NOT_DETECTED'));
    expect(third.body.flagged).toBe(true);
    await s1.post('/api/v1/proctoring/events').send(ev('HIGH'));

    const teacher = await as('teacher');
    const alerts = (await teacher.get('/api/v1/notifications?category=EXAM')).body.data.filter((n: any) => n.title.includes('Proctoring flag'));
    expect(alerts).toHaveLength(1); // not re-sent for events after the flag

    const report = await teacher.get('/api/v1/quizzes/q-proc/proctoring');
    expect(report.status).toBe(200);
    expect(report.body.data[0]).toMatchObject({ submissionId: 'sub-open', flagged: true });
    expect((await s1.get('/api/v1/quizzes/q-proc/proctoring')).status).toBe(403);
  });

  it('rejects events for quizzes without proctoring', async () => {
    await admin.quizSubmission.create({ data: { id: 'sub-plain', quizId: 'q-plain', userId: 's4', maxScore: 1, answersJson: {} } });
    expect((await (await as('s4')).post('/api/v1/proctoring/events').send({ submissionId: 'sub-plain', eventType: 'TAB_SWITCH', severity: 'LOW' })).status).toBe(400);
  });

  it('shows course staff a feed of recent events and open attempts, scoped to their courses', async () => {
    const feed = await (await as('teacher')).get('/api/v1/analytics/proctoring');
    expect(feed.status).toBe(200);
    expect(feed.body.openAttempts).toBe(1); // s1's open attempt at the proctored quiz
    expect(feed.body.data.length).toBeGreaterThanOrEqual(4);
    expect(feed.body.data[0]).toMatchObject({ student: 's1 Lasts1', quiz: 'Proctored' });
    const times = feed.body.data.map((e: any) => new Date(e.timestamp).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times); // newest first
    expect((await (await as('teacher')).get('/api/v1/analytics/proctoring?limit=2')).body.data).toHaveLength(2);

    expect((await (await as('teacher2')).get('/api/v1/analytics/proctoring')).body).toMatchObject({ openAttempts: 0, data: [] }); // not assigned to c1
    expect((await (await as('admin')).get('/api/v1/analytics/proctoring')).body.data.length).toBe(feed.body.data.length);
    expect((await (await as('m-admin', 'mit')).get('/api/v1/analytics/proctoring')).body.data).toEqual([]);
    expect((await (await as('s1')).get('/api/v1/analytics/proctoring')).status).toBe(403);
    expect((await request(app).get('/api/v1/analytics/proctoring')).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('early-warning analytics', () => {
  it('lists genuinely at-risk learners for course staff only', async () => {
    const teacher = await as('teacher');
    const res = await teacher.get('/api/v1/analytics/at-risk?courseId=c1');
    expect(res.status).toBe(200);
    const ids = res.body.data.map((l: any) => l.id);
    expect(ids).toContain('s3'); // flagged-free but failed attempt + never active
    expect(ids).not.toContain('s1'); // active and passing
    expect(res.body.data.every((l: any) => l.reasons.length > 0)).toBe(true);

    expect((await (await as('s1')).get('/api/v1/analytics/at-risk?courseId=c1')).status).toBe(403);
    expect((await (await as('teacher2')).get('/api/v1/analytics/at-risk?courseId=c1')).status).toBe(403);
    expect((await teacher.get('/api/v1/analytics/at-risk')).status).toBe(400);
  });

  it('only nudges learners enrolled in the staff member’s course', async () => {
    const teacher = await as('teacher');
    expect((await teacher.post('/api/v1/analytics/at-risk/nudge').send({ courseId: 'c1', userId: 's2' })).status).toBe(404);
    expect((await (await as('s1')).post('/api/v1/analytics/at-risk/nudge').send({ courseId: 'c1', userId: 's4' })).status).toBe(403);
  });

  it('computes cohort analytics from live data, not placeholders', async () => {
    const res = await (await as('teacher')).get('/api/v1/analytics/cohort');
    expect(res.status).toBe(200);
    expect(res.body.metrics.totalEnrolled).toBe(3);
    expect(JSON.stringify(res.body)).not.toContain('Liam Johnson');
    expect(res.body.atRiskLearners.length).toBeGreaterThan(0);
    expect(res.body.itemAnalysis.some((i: any) => i.questionId === 'qq2')).toBe(true);
    expect((await (await as('s1')).get('/api/v1/analytics/cohort')).status).toBe(403);
    expect((await (await as('m-admin', 'mit')).get('/api/v1/analytics/cohort')).body.metrics.totalEnrolled).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('multi-factor authentication', () => {
  it('enrols with proof of possession, enforces the code at login, and supports recovery codes', async () => {
    const s2 = await as('s2');
    expect((await s2.post('/api/v1/auth/mfa/enable').send({ code: '123456' })).status).toBe(400); // no setup yet

    const setup = await s2.post('/api/v1/auth/mfa/setup');
    expect(setup.status).toBe(200);
    const { secret, otpauthUrl } = setup.body.data;
    expect(otpauthUrl).toContain(`secret=${secret}`);

    // The secret is encrypted at rest.
    const stored = await admin.user.findUnique({ where: { id: 's2' } });
    expect(stored?.mfaSecret).toBeTruthy();
    expect(stored?.mfaSecret).not.toContain(secret);
    expect(stored?.mfaEnabled).toBe(false);

    expect((await s2.post('/api/v1/auth/mfa/enable').send({ code: '000000' })).status).toBe(400);
    const enable = await s2.post('/api/v1/auth/mfa/enable').send({ code: totp(secret) });
    expect(enable.status).toBe(200);
    const recovery: string[] = enable.body.data.recoveryCodes;
    expect(recovery).toHaveLength(8);

    // Password alone is no longer enough.
    const fresh = request.agent(app);
    const login = (extra: object = {}) => fresh.post('/api/v1/auth/login').set('x-tenant-id', 'harvard').send({ email: 's2@x.edu', password: pw('harvard'), ...extra });
    const noCode = await login();
    expect(noCode.status).toBe(401);
    expect(noCode.body.mfaRequired).toBe(true);
    expect(noCode.headers['set-cookie']).toBeUndefined();
    expect((await login({ mfaCode: '000000' })).status).toBe(401);
    expect((await login({ mfaCode: totp(secret) })).status).toBe(200);

    // A recovery code works exactly once.
    expect((await login({ mfaCode: recovery[0] })).status).toBe(200);
    expect((await login({ mfaCode: recovery[0] })).status).toBe(401);

    // Disabling needs both password and a code.
    const authed = await as('s2').catch(() => null);
    expect(authed).toBeNull(); // plain login helper now fails: MFA is enforced everywhere
    const session = request.agent(app);
    await session.post('/api/v1/auth/login').set('x-tenant-id', 'harvard').send({ email: 's2@x.edu', password: pw('harvard'), mfaCode: totp(secret) });
    expect((await session.post('/api/v1/auth/mfa/disable').send({ password: 'wrong-password', code: totp(secret) })).status).toBe(401);
    expect((await session.post('/api/v1/auth/mfa/disable').send({ password: pw('harvard'), code: recovery[1] })).status).toBe(200);
    expect((await admin.user.findUnique({ where: { id: 's2' } }))?.mfaSecret).toBeNull();
    expect((await login()).status).toBe(200);
  });

  it('counts wrong second-factor codes towards lockout', async () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    await admin.user.update({ where: { id: 's3' }, data: { mfaEnabled: true, mfaSecret: encryptSecret(secret) } });
    const agent = request.agent(app);
    const attempt = () => agent.post('/api/v1/auth/login').set('x-tenant-id', 'harvard').send({ email: 's3@x.edu', password: pw('harvard'), mfaCode: '000000' });
    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401); // MAX_FAILED_LOGINS = 3
    expect((await attempt()).status).toBe(423);
    await admin.user.update({ where: { id: 's3' }, data: { mfaEnabled: false, mfaSecret: null, lockedUntil: null, failedLoginCount: 0 } });
  });
});

// ---------------------------------------------------------------------------
describe('feature flags, usage metering and tenant export', () => {
  it('derives features from the plan and lets admins override them', async () => {
    const harvard = await as('admin');
    expect((await harvard.get('/api/v1/admin/features')).body.data).toMatchObject({ scim: true, webhooks: true, sso: true });
    const mit = await as('m-admin', 'mit');
    expect((await mit.get('/api/v1/admin/features')).body.data).toMatchObject({ scim: false, webhooks: false, lti13: false });

    const put = await mit.put('/api/v1/admin/features').send({ webhooks: true });
    expect(put.body.data.webhooks).toBe(true);
    expect((await request(app).get('/api/v1/tenant/config').set('x-tenant-id', 'mit')).body.features.webhooks).toBe(true);
    expect((await mit.put('/api/v1/admin/features').send({ bogus: true })).status).toBe(400);
    expect((await mit.put('/api/v1/admin/features').send({})).status).toBe(400);
    await mit.put('/api/v1/admin/features').send({ webhooks: false });
  });

  it('is administrator-only', async () => {
    for (const who of ['teacher', 's1', 'auditor']) {
      const a = await as(who);
      expect((await a.get('/api/v1/admin/features')).status, who).toBe(403);
      expect((await a.get('/api/v1/admin/usage')).status, who).toBe(403);
      expect((await a.get('/api/v1/admin/export')).status, who).toBe(403);
    }
  });

  it('reports usage and enforces a seat quota floor', async () => {
    const harvard = await as('admin');
    const usage = (await harvard.get('/api/v1/admin/usage')).body.data;
    expect(usage.seats.used).toBe(8);
    expect(usage.seats.byRole.STUDENT).toBe(4);
    expect(usage.totals.courses).toBe(1);
    expect(usage.last30Days.xapiStatements).toBeGreaterThan(0);
    expect((await harvard.put('/api/v1/admin/usage/quota').send({ seatQuota: 3 })).status).toBe(409);
    expect((await harvard.put('/api/v1/admin/usage/quota').send({ seatQuota: 8 })).body.data.seatQuota).toBe(8);
    expect((await harvard.get('/api/v1/admin/usage')).body.data.seats.remaining).toBe(0);
  });

  it('exports tenant data without credentials and audits it', async () => {
    const res = await (await as('admin')).get('/api/v1/admin/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body.users).toHaveLength(8);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|mfaSecret|\$2[aby]\$/);
    expect(res.body.users.every((u: any) => !u.email.startsWith('m-'))).toBe(true); // no other tenant
    expect(await admin.auditLog.count({ where: { tenantId: 't-h', action: 'TENANT_DATA_EXPORTED' } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('SCIM 2.0 provisioning', () => {
  let token: string;
  let scimId: string;
  const scim = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, tok: string | null = token) => {
    const r = (request(app) as any)[method](`/api/v1/scim/v2${path}`).set('content-type', 'application/scim+json');
    return tok ? r.set('authorization', `Bearer ${tok}`) : r;
  };

  beforeAll(async () => {
    // Free the seats the quota test consumed so SCIM can provision.
    await admin.tenant.update({ where: { id: 't-h' }, data: { seatQuota: null } });
  });

  it('mints a token once, stores only its hash, and gates the feature by plan', async () => {
    const harvard = await as('admin');
    const res = await harvard.post('/api/v1/admin/scim-tokens').send({ label: 'Okta' });
    expect(res.status).toBe(201);
    token = res.body.data.token;
    expect(token.length).toBeGreaterThan(30);
    const rows = await admin.scimToken.findMany({ where: { tenantId: 't-h' } });
    expect(rows[0].tokenHash).not.toBe(token);
    expect(JSON.stringify((await harvard.get('/api/v1/admin/scim-tokens')).body)).not.toContain(token);
    expect((await (await as('m-admin', 'mit')).post('/api/v1/admin/scim-tokens').send({ label: 'x' })).status).toBe(403); // STARTER
    expect((await (await as('teacher')).post('/api/v1/admin/scim-tokens').send({ label: 'x' })).status).toBe(403);
  });

  it('rejects missing and bogus tokens', async () => {
    expect((await scim('get', '/Users', null)).status).toBe(401);
    expect((await scim('get', '/Users', 'nope')).status).toBe(401);
    const sp = await scim('get', '/ServiceProviderConfig');
    expect(sp.status).toBe(200);
    expect(sp.headers['content-type']).toMatch(/scim\+json/);
  });

  it('creates, finds and rejects duplicate users (scim+json bodies)', async () => {
    const body = { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'New.Person@x.edu', externalId: 'okta-123', name: { givenName: 'New', familyName: 'Person' }, active: true };
    const created = await scim('post', '/Users').send(JSON.stringify(body));
    expect(created.status).toBe(201);
    scimId = created.body.id;
    expect(created.body).toMatchObject({ userName: 'new.person@x.edu', active: true, externalId: 'okta-123' });

    const row = await admin.user.findUnique({ where: { id: scimId } });
    expect(row).toMatchObject({ role: 'STUDENT', passwordHash: null, emailVerified: true, idpProvider: 'SCIM', tenantId: 't-h' });

    const dup = await scim('post', '/Users').send(JSON.stringify(body));
    expect(dup.status).toBe(409);
    expect(dup.body.scimType).toBe('uniqueness');
    expect((await scim('post', '/Users').send(JSON.stringify({ userName: 'not-an-email' }))).status).toBe(400);

    const found = await scim('get', '/Users?filter=userName eq "new.person@x.edu"');
    expect(found.body.totalResults).toBe(1);
    expect((await scim('get', '/Users?filter=name.givenName co "x"')).status).toBe(400);
    expect((await scim('get', `/Users/${scimId}`)).body.id).toBe(scimId);
    expect((await scim('get', '/Users/missing')).status).toBe(404);
  });

  it('deactivates via both Okta and Entra PATCH shapes and blocks sign-in', async () => {
    const okta = await scim('patch', `/Users/${scimId}`).send(JSON.stringify({ schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', path: 'active', value: false }] }));
    expect(okta.status).toBe(200);
    expect(okta.body.active).toBe(false);
    expect((await admin.user.findUnique({ where: { id: scimId } }))?.status).toBe('SUSPENDED');

    const entra = await scim('patch', `/Users/${scimId}`).send(JSON.stringify({ Operations: [{ op: 'Replace', value: { active: 'True' } }] }));
    expect(entra.body.active).toBe(true);
    expect((await scim('patch', `/Users/${scimId}`).send(JSON.stringify({ Operations: [{ op: 'replace', path: 'role', value: 'SUPER_ADMIN' }] }))).status).toBe(400);
    expect((await scim('patch', `/Users/${scimId}`).send(JSON.stringify({ Operations: [{ op: 'remove', path: 'active' }] }))).status).toBe(400);
    expect((await scim('put', `/Users/${scimId}`).send(JSON.stringify({ userName: 'someone.else@x.edu' }))).status).toBe(400);
  });

  it('never lets SCIM touch administrators or other tenants', async () => {
    expect((await scim('patch', '/Users/admin').send(JSON.stringify({ Operations: [{ op: 'replace', path: 'active', value: false }] }))).status).toBe(403);
    expect((await scim('delete', '/Users/admin')).status).toBe(403);
    expect((await scim('get', '/Users/m-student')).status).toBe(404);
    const list = await scim('get', '/Users?count=100');
    expect(list.body.Resources.every((r: any) => !r.userName.startsWith('m-'))).toBe(true);
  });

  it('deprovisions by suspending (history kept) and respects the seat quota', async () => {
    expect((await scim('delete', `/Users/${scimId}`)).status).toBe(204);
    expect((await admin.user.findUnique({ where: { id: scimId } }))?.status).toBe('SUSPENDED');
    const login = await request(app).post('/api/v1/auth/login').set('x-tenant-id', 'harvard').send({ email: 'new.person@x.edu', password: 'whatever-123' });
    expect(login.status).toBe(401);

    await admin.tenant.update({ where: { id: 't-h' }, data: { seatQuota: 8 } });
    const full = await scim('post', '/Users').send(JSON.stringify({ userName: 'overflow@x.edu' }));
    expect(full.status).toBe(409);
    await admin.tenant.update({ where: { id: 't-h' }, data: { seatQuota: null } });
  });

  it('stops working once the token is revoked', async () => {
    const harvard = await as('admin');
    const id = (await harvard.get('/api/v1/admin/scim-tokens')).body.data[0].id;
    expect((await harvard.delete(`/api/v1/admin/scim-tokens/${id}`)).status).toBe(204);
    expect((await scim('get', '/Users')).status).toBe(401);
    expect((await harvard.delete(`/api/v1/admin/scim-tokens/${id}`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('webhooks', () => {
  let server: http.Server;
  let url: string;
  const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  const hits: Record<string, number> = {};
  let endpointId: string;
  let secret: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        hits[req.url ?? ''] = (hits[req.url ?? ''] ?? 0) + 1;
        res.statusCode = req.url === '/fail' || (req.url === '/flaky' && hits['/flaky'] === 1) ? 500 : req.url === '/gone' ? 410 : 200;
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('creates endpoints, shows the secret once, and validates input', async () => {
    const harvard = await as('admin');
    const res = await harvard.post('/api/v1/admin/webhooks').send({ url: `${url}/hook`, events: ['enrollment.completed', 'quiz.submitted', 'webhook.test'] });
    expect(res.status).toBe(201);
    endpointId = res.body.data.id;
    secret = res.body.data.secret;
    expect(secret).toMatch(/^whsec_/);
    expect(JSON.stringify((await harvard.get('/api/v1/admin/webhooks')).body)).not.toContain(secret);

    expect((await harvard.post('/api/v1/admin/webhooks').send({ url: 'ftp://x.example/hook', events: ['quiz.submitted'] })).status).toBe(400);
    expect((await harvard.post('/api/v1/admin/webhooks').send({ url: `${url}/h`, events: ['nope'] })).status).toBe(400);
    expect((await harvard.post('/api/v1/admin/webhooks').send({ url: `${url}/h`, events: [] })).status).toBe(400);
    expect((await (await as('teacher')).get('/api/v1/admin/webhooks')).status).toBe(403);
    expect((await (await as('m-admin', 'mit')).post('/api/v1/admin/webhooks').send({ url: `${url}/h`, events: ['quiz.submitted'] })).status).toBe(403); // plan gate
  });

  it('delivers a correctly signed test event and records it', async () => {
    const res = await (await as('admin')).post(`/api/v1/admin/webhooks/${endpointId}/test`);
    expect(res.body.data).toMatchObject({ success: true, statusCode: 200 });
    const hit = received.find((r) => r.headers['x-lms-event'] === 'webhook.test')!;
    expect(hit).toBeTruthy();
    const expected = signPayload(secret, String(hit.headers['x-lms-timestamp']), hit.body);
    expect(hit.headers['x-lms-signature']).toBe(`sha256=${expected}`);
    expect(JSON.parse(hit.body)).toMatchObject({ event: 'webhook.test', tenantId: 't-h' });
    const deliveries = await (await as('admin')).get(`/api/v1/admin/webhooks/${endpointId}/deliveries`);
    expect(deliveries.body.data[0]).toMatchObject({ success: true, event: 'webhook.test' });
  });

  it('fires on real events without blocking, only for subscribed endpoints', async () => {
    const before = received.length;
    // s4 finishes the course: progress 100 by staff.
    const done = await (await as('teacher')).patch('/api/v1/enrollments/e-s4/progress').send({ progressPercent: 100, finalGrade: 90 });
    expect(done.status).toBe(200);
    expect(await until(async () => received.some((r, i) => i >= before && r.headers['x-lms-event'] === 'enrollment.completed'))).toBe(true);
    // certificate.issued is not subscribed, so it must not have been delivered.
    expect(received.some((r) => r.headers['x-lms-event'] === 'certificate.issued')).toBe(false);

    const hit = received.find((r) => r.headers['x-lms-event'] === 'enrollment.completed')!;
    expect(JSON.parse(hit.body).data).toMatchObject({ userId: 's4', courseId: 'c1', finalGrade: 90 });

    // The completion also produced a notification, XP, an xAPI statement.
    const s4 = await as('s4');
    expect((await s4.get('/api/v1/notifications?category=COURSE')).body.data.some((n: any) => n.title.includes('completed'))).toBe(true);
    expect((await s4.get('/api/v1/gamification/me')).body.data.recent.some((r: any) => r.source === 'COURSE_COMPLETE')).toBe(true);
    expect((await s4.get('/api/v1/analytics/xapi/stream?verb=http://adlnet.gov/expapi/verbs/completed')).body.total).toBe(1);

    // Re-sending progress does not re-notify or re-award.
    await (await as('teacher')).patch('/api/v1/enrollments/e-s4/progress').send({ progressPercent: 100 });
    expect((await s4.get('/api/v1/gamification/me')).body.data.recent.filter((r: any) => r.source === 'COURSE_COMPLETE')).toHaveLength(1);
  });

  it('records failures and survives an unreachable receiver', async () => {
    const harvard = await as('admin');
    const bad = await harvard.post('/api/v1/admin/webhooks').send({ url: `${url}/fail`, events: ['webhook.test'] });
    const r = await harvard.post(`/api/v1/admin/webhooks/${bad.body.data.id}/test`);
    expect(r.body.data).toMatchObject({ success: false, statusCode: 500 });
    const dead = await harvard.post('/api/v1/admin/webhooks').send({ url: 'http://127.0.0.1:1/nothing', events: ['webhook.test'] });
    const r2 = await harvard.post(`/api/v1/admin/webhooks/${dead.body.data.id}/test`);
    expect(r2.body.data.success).toBe(false);
    expect(r2.body.data.error).toBeTruthy();
  });

  it('updates, deletes and keeps endpoints private to their tenant', async () => {
    const harvard = await as('admin');
    expect((await harvard.patch(`/api/v1/admin/webhooks/${endpointId}`).send({ isActive: false })).body.data.isActive).toBe(false);
    expect((await harvard.patch(`/api/v1/admin/webhooks/${endpointId}`).send({})).status).toBe(400);
    const mit = await as('m-admin', 'mit');
    expect((await mit.get('/api/v1/admin/webhooks')).body.data).toEqual([]);
    expect((await mit.delete(`/api/v1/admin/webhooks/${endpointId}`)).status).toBe(404);
    expect((await harvard.delete(`/api/v1/admin/webhooks/${endpointId}`)).status).toBe(204);
  });

  describe('retries', () => {
    const create = async (path: string) =>
      (await (await as('admin')).post('/api/v1/admin/webhooks').send({ url: `${url}${path}`, events: ['user.provisioned'] })).body.data.id as string;
    const rows = (id: string) => admin.webhookDelivery.findMany({ where: { endpointId: id }, orderBy: { attempt: 'asc' } });

    it('retries a failed delivery later, records each attempt, and clears the queued payload', async () => {
      const { dispatchWebhook, retryDueWebhooks } = await import('../src/lib/webhooks.js');
      const { runWithTenant } = await import('@enterprise-lms/database');
      const id = await create('/flaky');
      await runWithTenant('t-h', () => dispatchWebhook('t-h', 'user.provisioned', { userId: 'x' }));

      let r = await rows(id);
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ attempt: 1, success: false, statusCode: 500 });
      expect(r[0].payload).toContain('user.provisioned');
      expect(r[0].nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

      // Not due yet: nothing happens.
      expect(await retryDueWebhooks()).toEqual({ retried: 0, dropped: 0 });
      // Due: the retry succeeds and carries the attempt number.
      expect(await retryDueWebhooks({ now: new Date(Date.now() + 60_000) })).toMatchObject({ retried: 1 });
      r = await rows(id);
      expect(r.map((x) => [x.attempt, x.success])).toEqual([[1, false], [2, true]]);
      expect(r[0]).toMatchObject({ payload: null, nextAttemptAt: null });
      expect(received.filter((x) => x.headers['x-lms-attempt'] === '2')).toHaveLength(1);
      // Nothing is retried twice.
      expect(await retryDueWebhooks({ now: new Date(Date.now() + 3_600_000) })).toEqual({ retried: 0, dropped: 0 });
    });

    it('does not retry when the receiver refuses the event (4xx)', async () => {
      const { dispatchWebhook } = await import('../src/lib/webhooks.js');
      const { runWithTenant } = await import('@enterprise-lms/database');
      const id = await create('/gone');
      await runWithTenant('t-h', () => dispatchWebhook('t-h', 'user.provisioned', { userId: 'y' }));
      const r = await rows(id);
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ success: false, statusCode: 410, nextAttemptAt: null, payload: null });
    });

    it('gives up after the last attempt and drops retries for deleted endpoints', async () => {
      const { dispatchWebhook, retryDueWebhooks, MAX_ATTEMPTS } = await import('../src/lib/webhooks.js');
      const { runWithTenant } = await import('@enterprise-lms/database');
      const id = await create('/fail');
      await runWithTenant('t-h', () => dispatchWebhook('t-h', 'user.provisioned', { userId: 'z' }));
      for (let i = 1; i < MAX_ATTEMPTS + 2; i++) await retryDueWebhooks({ now: new Date(Date.now() + i * 4_000_000) });
      const r = await rows(id);
      expect(r).toHaveLength(MAX_ATTEMPTS);
      expect(r.every((x) => x.nextAttemptAt === null)).toBe(true);

      // An endpoint switched off while a retry is queued: the retry is dropped, not sent.
      await admin.webhookEndpoint.deleteMany({ where: { url: { startsWith: url } } });
      const off = await create('/fail');
      await runWithTenant('t-h', () => dispatchWebhook('t-h', 'user.provisioned', { userId: 'w' }));
      await (await as('admin')).patch(`/api/v1/admin/webhooks/${off}`).send({ isActive: false });
      expect(await retryDueWebhooks({ now: new Date(Date.now() + 4_000_000) })).toEqual({ retried: 0, dropped: 1 });
      expect(await rows(off)).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
describe('LTI 1.3 launch', () => {
  let jwksServer: http.Server;
  let jwksUrl: string;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const CLAIM = 'https://purl.imsglobal.org/spec/lti/claim';

  beforeAll(async () => {
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
    jwksServer = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((r) => jwksServer.listen(0, '127.0.0.1', r));
    jwksUrl = `http://127.0.0.1:${(jwksServer.address() as any).port}/jwks`;
    await admin.ltiDeployment.create({
      data: { tenantId: 't-h', clientId: 'client-1', deploymentId: 'dep-1', issuer: 'https://platform.example.edu', authLoginUrl: 'https://p/login', authTokensUrl: 'https://p/token', keySetUrl: jwksUrl },
    });
  });
  afterAll(() => new Promise<void>((r) => jwksServer.close(() => r())));

  const token = (over: Record<string, unknown> = {}, key: crypto.KeyObject = privateKey) =>
    jwt.sign(
      { iss: 'https://platform.example.edu', aud: 'client-1', sub: 'u1', email: 's4@x.edu', nonce: 'n-1', [`${CLAIM}/version`]: '1.3.0', [`${CLAIM}/deployment_id`]: 'dep-1', [`${CLAIM}/target_link_uri`]: 'https://lms/courses/c1', ...over },
      key,
      { algorithm: 'RS256', keyid: 'k1', expiresIn: '5m' }
    );
  const launch = (id_token: string) => request(app).post('/api/v1/lti/launch').set('x-tenant-id', 'harvard').send({ id_token });

  it('verifies the platform signature and signs the matching user in', async () => {
    const res = await launch(token());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'authenticated', targetLinkUri: 'https://lms/courses/c1', user: { id: 's4' } });
    expect(res.body.sessionToken).toBeUndefined(); // the old stub token is gone
    expect(String(res.headers['set-cookie'])).toContain('lms_token');
  });

  it('refuses forged, mismatched or incomplete launches', async () => {
    expect((await launch(token({}, other.privateKey))).status).toBe(401); // wrong signing key
    expect((await launch(token({ aud: 'other-client' }))).status).toBe(401); // unknown deployment
    expect((await launch(token({ [`${CLAIM}/deployment_id`]: 'dep-9' }))).status).toBe(401);
    expect((await launch(token({ nonce: undefined }))).status).toBe(401);
    expect((await launch(token({ email: 'nobody@x.edu' }))).status).toBe(403); // no auto-provisioning
    expect((await launch(token({ email: undefined }))).status).toBe(403);
    expect((await launch('a.b.c')).status).toBe(400);
    expect((await launch(jwt.sign({ iss: 'x' }, 'secret'))).status).toBe(401); // HS256 not accepted
    const expired = jwt.sign({ iss: 'https://platform.example.edu', aud: 'client-1', nonce: 'n', email: 's4@x.edu', [`${CLAIM}/version`]: '1.3.0', [`${CLAIM}/deployment_id`]: 'dep-1' }, privateKey, { algorithm: 'RS256', keyid: 'k1', expiresIn: -60 });
    expect((await launch(expired)).status).toBe(401);
  });

  it('does not accept launches into a tenant that lacks the deployment', async () => {
    const res = await request(app).post('/api/v1/lti/launch').set('x-tenant-id', 'mit').send({ id_token: token() });
    expect(res.status).toBe(403); // STARTER plan has LTI off
  });
});

// ---------------------------------------------------------------------------
describe('row-level security on the new tables', () => {
  it('hides every tenant’s engagement and telemetry rows from the other tenant', async () => {
    const mit = new PrismaClient({ datasourceUrl: db.appUrl });
    try {
      // No tenant context set: the unprivileged role sees nothing, even though rows exist.
      for (const table of ['notification', 'forumThread', 'forumPost', 'forumVote', 'forumFlag', 'calendarEvent', 'userGamification', 'xpEvent', 'xapiStatement', 'webhookEndpoint', 'webhookDelivery', 'notificationPreference'] as const) {
        const adminCount = await (admin as any)[table].count();
        const appCount = await (mit as any)[table].count();
        expect(appCount, `${table} (admin sees ${adminCount})`).toBe(0);
      }
    } finally {
      await mit.$disconnect();
    }
  });
});

// ---------------------------------------------------------------------------
describe('forum replies are paged', () => {
  it('serves replies a page at a time with a cursor, in order, without gaps or repeats', async () => {
    const s1 = await as('s1');
    const t = await s1.post('/api/v1/courses/c1/threads').send({ title: 'Paging', body: 'many replies' });
    const id = t.body.data.id;
    for (let i = 0; i < 5; i++) expect((await s1.post(`/api/v1/threads/${id}/posts`).send({ body: `reply ${i}` })).status).toBe(201);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: any = await s1.get(`/api/v1/threads/${id}?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      expect(res.body.data.posts.length).toBeLessThanOrEqual(2);
      seen.push(...res.body.data.posts.map((p: any) => p.body));
      cursor = res.body.data.nextCursor;
      pages++;
    } while (cursor);

    expect(seen).toEqual(['reply 0', 'reply 1', 'reply 2', 'reply 3', 'reply 4']);
    expect(pages).toBe(3);
    expect((await s1.get(`/api/v1/threads/${id}?limit=0`)).status).toBe(400);
    expect((await s1.get(`/api/v1/threads/${id}`)).body.data.nextCursor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('notification responses match the API description', () => {
  it('list, preferences and bulk actions have the documented shape', async () => {
    const { NotificationItem, NotificationPreferences, NotificationPreferencesDetail, Pagination } = await import('../src/openapi/docs.js');
    const { z } = await import('zod');
    const s1 = await as('s1');

    const list = await s1.get('/api/v1/notifications');
    expect(list.status).toBe(200);
    const shape = z.object({ data: z.array(NotificationItem), unreadCount: z.number(), pagination: Pagination });
    expect(shape.safeParse(list.body).success, JSON.stringify(shape.safeParse(list.body))).toBe(true);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(Object.keys(list.body.data[0]).sort()).toEqual(Object.keys(NotificationItem.shape).sort()); // nothing internal leaks

    const prefs = await s1.get('/api/v1/notifications/preferences');
    expect(NotificationPreferencesDetail.safeParse(prefs.body.data).success, JSON.stringify(prefs.body)).toBe(true);
    const saved = await s1.put('/api/v1/notifications/preferences').send({ mutedCategories: ['GRADE'], timezone: 'Asia/Kolkata' });
    expect(saved.status).toBe(200);
    expect(NotificationPreferences.safeParse(saved.body.data).success, JSON.stringify(saved.body)).toBe(true);

    const first = list.body.data[0].id;
    const one = await s1.post(`/api/v1/notifications/${first}/read`);
    expect(z.object({ id: z.string(), read: z.literal(true) }).safeParse(one.body.data).success).toBe(true);
    const all = await s1.post('/api/v1/notifications/read-all');
    expect(z.object({ updated: z.number() }).safeParse(all.body.data).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('forum responses match the API description', () => {
  it('list, create, detail, reply, vote and report have the documented shapes', async () => {
    const docs = await import('../src/openapi/docs.js');
    const { z } = await import('zod');
    const s1 = await as('s1');

    const created = await s1.post('/api/v1/courses/c1/threads').send({ title: 'Contract thread', body: 'checking the shapes' });
    expect(created.status).toBe(201);
    expect(z.object({ data: docs.ForumThreadRecord }).safeParse(created.body).success, JSON.stringify(created.body)).toBe(true);
    const id = created.body.data.id;

    const list = await s1.get('/api/v1/courses/c1/threads');
    const parsedList = z.object({ data: z.array(docs.ForumThreadItem), pagination: docs.Pagination }).safeParse(list.body);
    expect(parsedList.success, JSON.stringify(parsedList)).toBe(true);

    const teacher = await as('teacher');
    const reply = await teacher.post(`/api/v1/threads/${id}/posts`).send({ body: 'a reply' });
    expect(reply.status).toBe(201);
    expect(z.object({ data: docs.ForumPostRecord }).safeParse(reply.body).success, JSON.stringify(reply.body)).toBe(true);

    const detail = await s1.get(`/api/v1/threads/${id}`);
    const parsedDetail = z.object({ data: docs.ForumThreadDetail }).safeParse(detail.body);
    expect(parsedDetail.success, JSON.stringify(parsedDetail)).toBe(true);
    expect(detail.body.data.posts).toHaveLength(1);

    const vote = await s1.post('/api/v1/votes').send({ targetType: 'THREAD', targetId: id });
    expect(z.object({ data: z.object({ targetType: z.enum(['THREAD', 'POST']), targetId: z.string(), voted: z.boolean(), upvotes: z.number() }) }).safeParse(vote.body).success, JSON.stringify(vote.body)).toBe(true);
    const flag = await (await as('s2')).post('/api/v1/flags').send({ targetType: 'THREAD', targetId: id, reason: 'testing' });
    expect(flag.status === 201 || flag.status === 403, JSON.stringify(flag.body)).toBe(true);
  });
});
