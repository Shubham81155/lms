import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Live classes: scheduling, authorisation, join tokens, the media server's signed webhooks and
// attendance, against a real PostgreSQL. (Audio/video itself runs on LiveKit and is not exercised.)

const PASSWORD = 'CorrectHorse1!';
const LK_URL = 'wss://live.example.org';
const LK_KEY = 'APIkeyForTests';
const LK_SECRET = 'live-secret-'.padEnd(48, 'x');
const pw = (slug: string) => `${PASSWORD}-${slug}`;

let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let lk: typeof import('../src/lib/livekit.js');

async function seed() {
  for (const [id, slug] of [
    ['t-h', 'harvard'],
    ['t-m', 'mit'],
  ])
    await admin.tenant.create({ data: { id, slug, name: slug } });
  const user = (id: string, tenantId: string, slug: string, role: any) =>
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
      },
    });
  await user('admin', 't-h', 'harvard', 'TENANT_ADMIN');
  await user('teacher', 't-h', 'harvard', 'INSTRUCTOR');
  await user('teacher2', 't-h', 'harvard', 'INSTRUCTOR');
  await user('ta', 't-h', 'harvard', 'TEACHING_ASSISTANT');
  await user('auditor', 't-h', 'harvard', 'AUDITOR');
  for (const s of ['s1', 's2', 's3', 'sdrop']) await user(s, 't-h', 'harvard', 'STUDENT');
  await user('m-teacher', 't-m', 'mit', 'INSTRUCTOR');

  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'Course 1', status: 'PUBLISHED' } });
  await admin.course.create({ data: { id: 'c2', tenantId: 't-h', code: 'C2', title: 'Course 2', status: 'PUBLISHED' } });
  await admin.course.create({ data: { id: 'm1', tenantId: 't-m', code: 'M1', title: 'MIT', status: 'PUBLISHED' } });
  await admin.courseInstructor.createMany({
    data: [
      { courseId: 'c1', userId: 'teacher', isPrimary: true },
      { courseId: 'c1', userId: 'ta' },
      { courseId: 'c2', userId: 'teacher2', isPrimary: true },
      { courseId: 'm1', userId: 'm-teacher' },
    ],
  });
  for (const s of ['s1', 's2'])
    await admin.enrollment.create({ data: { id: `e-${s}`, tenantId: 't-h', courseId: 'c1', userId: s, status: 'IN_PROGRESS' } });
  await admin.enrollment.create({ data: { id: 'e-drop', tenantId: 't-h', courseId: 'c1', userId: 'sdrop', status: 'DROPPED' } });
  await admin.enrollment.create({ data: { id: 'e-s1c2', tenantId: 't-h', courseId: 'c2', userId: 's3', status: 'ENROLLED' } });
}

beforeAll(async () => {
  process.env.LIVEKIT_URL = LK_URL;
  process.env.LIVEKIT_API_KEY = LK_KEY;
  process.env.LIVEKIT_API_SECRET = LK_SECRET;
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await seed();
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  lk = await import('../src/lib/livekit.js');
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

async function as(who: string, tenant: 'harvard' | 'mit' = 'harvard') {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .set('x-tenant-id', tenant)
    .send({ email: `${who}@x.edu`, password: pw(tenant) });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

const inFuture = (ms: number) => new Date(Date.now() + ms).toISOString();
const decode = (token: string) => jwt.verify(token, LK_SECRET, { algorithms: ['HS256'], issuer: LK_KEY }) as any;

/** Signs a webhook the way the media server does. */
function signedWebhook(body: object | string, over: { secret?: string; key?: string; sha?: string; expiresIn?: number } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const token = jwt.sign(
    { iss: over.key ?? LK_KEY, sha256: over.sha ?? crypto.createHash('sha256').update(raw).digest('base64') },
    over.secret ?? LK_SECRET,
    { algorithm: 'HS256', expiresIn: over.expiresIn ?? 300 }
  );
  return { raw, token };
}
const hook = (body: object | string, over: Parameters<typeof signedWebhook>[1] = {}) => {
  const { raw, token } = signedWebhook(body, over);
  return request(app)
    .post('/api/v1/integrations/livekit')
    .set('content-type', 'application/webhook+json')
    .set('authorization', token)
    .send(raw);
};

// ---------------------------------------------------------------------------
describe('pure helpers', () => {
  it('builds and parses room names, rejecting anything that is not ours', () => {
    expect(lk.roomNameFor('t-h', 'abc-123')).toBe('lms_t-h_abc-123');
    expect(lk.parseRoomName('lms_t-h_abc-123')).toEqual({ tenantId: 't-h', sessionId: 'abc-123' });
    for (const bad of [
      '',
      'lms_only',
      'other_t-h_abc',
      'lms_t-h_abc_extra',
      'lms_t h_abc',
      "lms_t-h_abc'; DROP",
      'lms__abc',
      `lms_${'x'.repeat(65)}_a`,
    ]) {
      expect(lk.parseRoomName(bad), bad).toBeNull();
    }
  });

  it('issues a token that LiveKit would accept and that limits what the holder may do', () => {
    const t = decode(
      lk.issueJoinToken({
        identity: 'u1',
        name: 'Ada L',
        room: 'lms_t_s',
        canPublish: false,
        roomAdmin: false,
        role: 'LEARNER',
        ttlSeconds: 3600,
      })
    );
    expect(t.exp - t.iat).toBe(3600);
    expect(t).toMatchObject({
      iss: LK_KEY,
      sub: 'u1',
      name: 'Ada L',
      video: { room: 'lms_t_s', roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: true },
    });
    expect(t.video.roomAdmin).toBeUndefined();
    expect(JSON.parse(t.metadata)).toEqual({ role: 'LEARNER' });
  });

  it('verifies webhook tokens strictly', () => {
    const { raw, token } = signedWebhook({ event: 'x' });
    expect(lk.verifyWebhook(token, raw)).toBe(true);
    expect(lk.verifyWebhook(`Bearer ${token}`, raw)).toBe(true);
    expect(lk.verifyWebhook(token, raw + ' ')).toBe(false); // body changed
    expect(lk.verifyWebhook(signedWebhook({ event: 'x' }, { secret: 'y'.repeat(40) }).token, raw)).toBe(false);
    expect(lk.verifyWebhook(signedWebhook({ event: 'x' }, { key: 'OtherKey' }).token, raw)).toBe(false);
    expect(lk.verifyWebhook(signedWebhook({ event: 'x' }, { expiresIn: -10 }).token, raw)).toBe(false);
    expect(
      lk.verifyWebhook(
        jwt.sign({ iss: LK_KEY, sha256: crypto.createHash('sha256').update(raw).digest('base64') }, '', { algorithm: 'none' as any }),
        raw
      )
    ).toBe(false);
    expect(lk.verifyWebhook(undefined, raw)).toBe(false);
    expect(lk.verifyWebhook('garbage', raw)).toBe(false);
  });

  it('counts time in the room and the presence threshold', () => {
    const t = new Date('2026-10-20T12:00:00Z');
    expect(lk.secondsBetween(t, new Date(t.getTime() + 90_500))).toBe(90);
    expect(lk.secondsBetween(t, new Date(t.getTime() - 5000))).toBe(0); // never negative
    expect(lk.isPresent(299)).toBe(false);
    expect(lk.isPresent(300)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('scheduling', () => {
  const body = (over: object = {}) => ({
    title: 'Raft consensus',
    description: 'Leader election',
    scheduledAt: inFuture(3_600_000),
    durationMins: 60,
    ...over,
  });

  it('is limited to course editors', async () => {
    for (const who of ['s1', 'ta', 'teacher2'])
      expect((await (await as(who)).post('/api/v1/courses/c1/live-sessions').send(body())).status, who).toBe(403);
    expect((await request(app).post('/api/v1/courses/c1/live-sessions').send(body())).status).toBe(401);
    expect((await (await as('m-teacher', 'mit')).post('/api/v1/courses/c1/live-sessions').send(body())).status).toBe(404); // other tenant
  });

  it('validates input', async () => {
    const t = await as('teacher');
    for (const bad of [
      body({ title: 'x' }),
      body({ scheduledAt: inFuture(-3_600_000) }),
      body({ durationMins: 2 }),
      body({ durationMins: 500 }),
      body({ scheduledAt: 'soon' }),
      {},
    ]) {
      expect((await t.post('/api/v1/courses/c1/live-sessions').send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('schedules a class: room name, calendar entry, notifications, audit', async () => {
    const res = await (await as('teacher')).post('/api/v1/courses/c1/live-sessions').send(body());
    expect(res.status).toBe(201);
    const s = await admin.liveSession.findUnique({ where: { id: res.body.data.id } });
    expect(s).toMatchObject({ status: 'SCHEDULED', courseId: 'c1', tenantId: 't-h', allowStudentVideo: false });
    expect(s!.roomName).toBe(`lms_t-h_${s!.id}`);
    expect(res.body.data).not.toHaveProperty('roomName'); // internal detail, not exposed in the listing view

    const ev = await admin.calendarEvent.findUnique({ where: { id: s!.calendarEventId! } });
    expect(ev).toMatchObject({ courseId: 'c1', category: 'LECTURE', title: 'Live class: Raft consensus' });
    expect(ev!.endsAt.getTime() - ev!.startsAt.getTime()).toBe(3_600_000);

    for (const who of ['s1', 's2']) {
      const notes = (await (await as(who)).get('/api/v1/notifications?category=LIVE')).body.data;
      expect(
        notes.some((n: any) => n.title === 'Live class scheduled: Raft consensus'),
        who
      ).toBe(true);
    }
    for (const who of ['s3', 'sdrop', 'teacher'])
      expect((await (await as(who)).get('/api/v1/notifications?category=LIVE')).body.data, who).toHaveLength(0);
    expect(await admin.auditLog.count({ where: { action: 'LIVE_SESSION_SCHEDULED' } })).toBe(1);
  });

  it('reschedules, keeping the calendar in step, only before the class starts', async () => {
    const t = await as('teacher');
    const made = await t.post('/api/v1/courses/c1/live-sessions').send(body({ title: 'To move' }));
    const id = made.body.data.id;
    const later = inFuture(5 * 3_600_000);
    expect((await t.patch(`/api/v1/live-sessions/${id}`).send({ scheduledAt: later, title: 'Moved', durationMins: 30 })).status).toBe(200);
    const s = await admin.liveSession.findUnique({ where: { id } });
    const ev = await admin.calendarEvent.findUnique({ where: { id: s!.calendarEventId! } });
    expect(ev).toMatchObject({ title: 'Live class: Moved' });
    expect(ev!.startsAt.toISOString()).toBe(new Date(later).toISOString());
    expect(ev!.endsAt.getTime() - ev!.startsAt.getTime()).toBe(30 * 60_000);

    expect((await t.patch(`/api/v1/live-sessions/${id}`).send({})).status).toBe(400);
    expect((await t.patch(`/api/v1/live-sessions/${id}`).send({ scheduledAt: inFuture(-3_600_000) })).status).toBe(400);
    expect((await (await as('teacher2')).patch(`/api/v1/live-sessions/${id}`).send({ title: 'Hijack' })).status).toBe(403);
  });

  it('cancels a class, removing it from the calendar and the listing, and telling learners', async () => {
    const t = await as('teacher');
    const id = (await t.post('/api/v1/courses/c1/live-sessions').send(body({ title: 'Cancel me' }))).body.data.id;
    const calendarId = (await admin.liveSession.findUnique({ where: { id } }))!.calendarEventId!;
    expect((await (await as('ta')).post(`/api/v1/live-sessions/${id}/cancel`)).status).toBe(403);
    expect((await t.post(`/api/v1/live-sessions/${id}/cancel`)).body.data.status).toBe('CANCELLED');
    expect(await admin.calendarEvent.count({ where: { id: calendarId } })).toBe(0);
    expect((await (await as('s1')).get('/api/v1/courses/c1/live-sessions')).body.data.map((s: any) => s.id)).not.toContain(id);
    expect(
      (await (await as('s1')).get('/api/v1/notifications?category=LIVE')).body.data.some(
        (n: any) => n.title === 'Live class cancelled: Cancel me'
      )
    ).toBe(true);
    expect((await t.post(`/api/v1/live-sessions/${id}/cancel`)).status).toBe(409); // already cancelled
    expect((await t.patch(`/api/v1/live-sessions/${id}`).send({ title: 'x1' })).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
describe('lifecycle and joining', () => {
  let id: string;
  let room: string;

  beforeAll(async () => {
    const res = await (
      await as('teacher')
    )
      .post('/api/v1/courses/c1/live-sessions')
      .send({ title: 'Live lecture', scheduledAt: inFuture(60_000), durationMins: 90 });
    id = res.body.data.id;
    room = (await admin.liveSession.findUnique({ where: { id } }))!.roomName;
  });

  it('lists sessions for people with access, with staff-only and learner-only fields', async () => {
    const learner = await (await as('s1')).get('/api/v1/courses/c1/live-sessions');
    const mine = learner.body.data.find((s: any) => s.id === id);
    expect(learner.body.configured).toBe(true);
    expect(mine).toMatchObject({ status: 'SCHEDULED', attended: false });
    expect(mine).not.toHaveProperty('attendeeCount');
    const staff = (await (await as('teacher')).get('/api/v1/courses/c1/live-sessions')).body.data.find((s: any) => s.id === id);
    expect(staff.attendeeCount).toBe(0);
    expect(staff).not.toHaveProperty('attended');
    expect((await (await as('s3')).get('/api/v1/courses/c1/live-sessions')).status).toBe(403); // not enrolled in c1
    expect((await (await as('sdrop')).get('/api/v1/courses/c1/live-sessions')).status).toBe(403);
  });

  it('shows each person only the classes of their own courses on the dashboard feed', async () => {
    const ids = async (who: string) => (await (await as(who)).get('/api/v1/live-sessions/mine')).body.data.map((s: any) => s.id);
    expect(await ids('s1')).toContain(id);
    expect(await ids('s3')).not.toContain(id); // enrolled in c2 only
    expect(await ids('teacher')).toContain(id);
    expect(await ids('teacher2')).not.toContain(id);
    expect(await ids('admin')).toContain(id);
    const entry = (await (await as('s1')).get('/api/v1/live-sessions/mine')).body.data.find((s: any) => s.id === id);
    expect(entry.course).toMatchObject({ code: 'C1' });
  });

  it('cannot be joined before it starts', async () => {
    expect((await (await as('s1')).post(`/api/v1/live-sessions/${id}/join`)).status).toBe(409);
    expect((await (await as('teacher')).post(`/api/v1/live-sessions/${id}/join`)).status).toBe(409);
  });

  it('is started by an editor only, once, telling the learners', async () => {
    for (const who of ['s1', 'ta', 'teacher2'])
      expect((await (await as(who)).post(`/api/v1/live-sessions/${id}/start`)).status, who).toBe(403);
    const t = await as('teacher');
    const [a, b] = await Promise.all([t.post(`/api/v1/live-sessions/${id}/start`), t.post(`/api/v1/live-sessions/${id}/start`)]);
    expect([a.status, b.status]).toEqual([200, 200]); // idempotent
    expect(a.body.data.status).toBe('LIVE');
    expect(await admin.auditLog.count({ where: { action: 'LIVE_SESSION_STARTED', resourceId: id } })).toBe(1);
    const notes = (await (await as('s1')).get('/api/v1/notifications?category=LIVE')).body.data.filter(
      (n: any) => n.title === 'Live now: Live lecture'
    );
    expect(notes).toHaveLength(1);
  });

  it('gives a learner a watch-and-chat token tied to the room', async () => {
    const res = await (await as('s1')).post(`/api/v1/live-sessions/${id}/join`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ url: LK_URL, roomName: room, role: 'LEARNER', canPublish: false });
    const t = decode(res.body.data.token);
    expect(t).toMatchObject({
      sub: 's1',
      name: 's1 L',
      video: { room, roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: true },
    });
    expect(t.video.roomAdmin).toBeUndefined();
    const lifetime = t.exp - t.iat;
    expect(lifetime).toBeGreaterThanOrEqual(15 * 60);
    expect(lifetime).toBeLessThanOrEqual(12 * 3600);
  });

  it('gives instructors a host token and assistants a publishing token without admin rights', async () => {
    const host = decode((await (await as('teacher')).post(`/api/v1/live-sessions/${id}/join`)).body.data.token);
    expect(host.video).toMatchObject({ canPublish: true, roomAdmin: true });
    expect(JSON.parse(host.metadata).role).toBe('HOST');
    const ta = (await (await as('ta')).post(`/api/v1/live-sessions/${id}/join`)).body.data;
    expect(ta.role).toBe('ASSISTANT');
    expect(decode(ta.token).video).toMatchObject({ canPublish: true });
    expect(decode(ta.token).video.roomAdmin).toBeUndefined();
    expect(JSON.parse(decode((await (await as('admin')).post(`/api/v1/live-sessions/${id}/join`)).body.data.token).metadata).role).toBe(
      'HOST'
    );
  });

  it('turns on learner audio/video only when the instructor allowed it', async () => {
    const t = await as('teacher');
    const open = (
      await t.post('/api/v1/courses/c1/live-sessions').send({ title: 'Open floor', scheduledAt: inFuture(60_000), allowStudentVideo: true })
    ).body.data.id;
    await t.post(`/api/v1/live-sessions/${open}/start`);
    const j = (await (await as('s2')).post(`/api/v1/live-sessions/${open}/join`)).body.data;
    expect(j.canPublish).toBe(true);
    expect(decode(j.token).video.canPublish).toBe(true);
    expect(decode(j.token).video.roomAdmin).toBeUndefined();
  });

  it('refuses people who should not be in the room', async () => {
    for (const who of ['s3', 'sdrop', 'auditor', 'teacher2'])
      expect((await (await as(who)).post(`/api/v1/live-sessions/${id}/join`)).status, who).toBe(403);
    expect((await request(app).post(`/api/v1/live-sessions/${id}/join`)).status).toBe(401);
    expect((await (await as('m-teacher', 'mit')).post(`/api/v1/live-sessions/${id}/join`)).status).toBe(404);
    expect((await (await as('s1')).post('/api/v1/live-sessions/nonexistent/join')).status).toBe(404);
  });

  it('counts each join', async () => {
    const before = (await admin.liveAttendance.findFirst({ where: { sessionId: id, userId: 's1' } }))!.joinCount;
    await (await as('s1')).post(`/api/v1/live-sessions/${id}/join`);
    expect((await admin.liveAttendance.findFirst({ where: { sessionId: id, userId: 's1' } }))!.joinCount).toBe(before + 1);
  });

  it('is ended by an editor, closing open attendance, and cannot be joined afterwards', async () => {
    await admin.liveAttendance.updateMany({
      where: { sessionId: id, userId: 's1' },
      data: { activeSince: new Date(Date.now() - 400_000) },
    });
    expect((await (await as('ta')).post(`/api/v1/live-sessions/${id}/end`)).status).toBe(403);
    const res = await (await as('teacher')).post(`/api/v1/live-sessions/${id}/end`);
    expect(res.body.data.status).toBe('ENDED');
    const a = (await admin.liveAttendance.findFirst({ where: { sessionId: id, userId: 's1' } }))!;
    expect(a.activeSince).toBeNull();
    expect(a.totalSeconds).toBeGreaterThanOrEqual(399);
    expect((await (await as('teacher')).post(`/api/v1/live-sessions/${id}/end`)).status).toBe(409);
    expect((await (await as('teacher')).post(`/api/v1/live-sessions/${id}/start`)).status).toBe(409);
    expect((await (await as('s1')).post(`/api/v1/live-sessions/${id}/join`)).status).toBe(409);
    // The learner now shows as having attended in their own listing.
    expect((await (await as('s1')).get('/api/v1/courses/c1/live-sessions')).body.data.find((s: any) => s.id === id).attended).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('media server webhooks and attendance', () => {
  let id: string;
  let room: string;
  const T0 = Math.floor(Date.now() / 1000);
  const evt = (event: string, identity: string | undefined, atSec: number, roomName = room) => ({
    event,
    createdAt: atSec,
    room: { name: roomName },
    ...(identity ? { participant: { identity } } : {}),
  });

  beforeAll(async () => {
    const t = await as('teacher');
    id = (await t.post('/api/v1/courses/c1/live-sessions').send({ title: 'Webhook class', scheduledAt: inFuture(60_000) })).body.data.id;
    await t.post(`/api/v1/live-sessions/${id}/start`);
    room = (await admin.liveSession.findUnique({ where: { id } }))!.roomName;
  });

  it('rejects calls that are not signed by the media server', async () => {
    const body = JSON.stringify(evt('participant_joined', 's1', T0));
    expect((await request(app).post('/api/v1/integrations/livekit').send(body)).status).toBe(401); // no header
    expect((await hook(evt('participant_joined', 's1', T0), { secret: 'z'.repeat(40) })).status).toBe(401); // wrong secret
    expect((await hook(evt('participant_joined', 's1', T0), { sha: 'bm90LXRoZS1ib2R5' })).status).toBe(401); // header for a different body
    expect((await hook(evt('participant_joined', 's1', T0), { expiresIn: -60 })).status).toBe(401);
    expect(await admin.liveAttendance.count({ where: { sessionId: id, userId: 's1' } })).toBe(0);
  });

  it('starts counting when someone joins and adds the time when they leave', async () => {
    expect((await hook(evt('participant_joined', 's2', T0 - 1000))).body).toEqual({ ok: true });
    let a = (await admin.liveAttendance.findFirst({ where: { sessionId: id, userId: 's2' } }))!;
    expect(a.activeSince).toBeTruthy();
    expect(a.totalSeconds).toBe(0);

    await hook(evt('participant_left', 's2', T0 - 1000 + 400));
    a = (await admin.liveAttendance.findFirst({ where: { sessionId: id, userId: 's2' } }))!;
    expect(a).toMatchObject({ totalSeconds: 400, activeSince: null });

    // A duplicated "left" event cannot count the time twice.
    await hook(evt('participant_left', 's2', T0 - 1000 + 900));
    expect((await admin.liveAttendance.findFirst({ where: { sessionId: id, userId: 's2' } }))!.totalSeconds).toBe(400);

    // Coming back accumulates.
    await hook(evt('participant_joined', 's2', T0 + 100));
    await hook(evt('participant_left', 's2', T0 + 160));
    expect((await admin.liveAttendance.findFirst({ where: { sessionId: id, userId: 's2' } }))!.totalSeconds).toBe(460);
  });

  it('ignores events it cannot attribute', async () => {
    const before = await admin.liveAttendance.count();
    expect((await hook(evt('participant_joined', 's1', T0, 'lms_t-h_unknown-session'))).body.ignored).toBe('unknown session');
    expect((await hook(evt('participant_joined', 's1', T0, 'some-other-room'))).body.ignored).toBe('unknown room');
    // A room name that names another tenant cannot reach this tenant's session.
    expect((await hook(evt('participant_joined', 's1', T0, `lms_t-m_${id}`))).body.ignored).toBe('unknown session');
    // An identity that is not a user of the tenant is not recorded.
    await hook(evt('participant_joined', 'm-teacher', T0));
    await hook(evt('participant_joined', 'ghost-user', T0));
    expect(await admin.liveAttendance.count()).toBe(before);
    expect((await hook(evt('track_published', 's1', T0))).body).toEqual({ ok: true });
    expect((await hook('{not json')).status).toBe(400);
  });

  it('reports attendance to course staff only, for enrolled learners, counting people still in the room', async () => {
    await hook(evt('participant_joined', 's1', Math.floor(Date.now() / 1000) - 600)); // in the room for ten minutes, still there
    const res = await (await as('teacher')).get(`/api/v1/live-sessions/${id}/attendance`);
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.data.map((r: any) => [r.userId, r]));
    expect(Object.keys(by).sort()).toEqual(['s1', 's2']); // enrolled learners only: not the dropped one, not staff
    expect(by.s1).toMatchObject({ present: true, inRoomNow: true });
    expect(by.s1.minutes).toBeGreaterThanOrEqual(9);
    expect(by.s2).toMatchObject({ present: true, inRoomNow: false, minutes: 7 }); // 460 s
    expect(res.body.summary).toEqual({ enrolled: 2, present: 2 });
    for (const who of ['s1', 'teacher2'])
      expect((await (await as(who)).get(`/api/v1/live-sessions/${id}/attendance`)).status, who).toBe(403);
    expect((await (await as('ta')).get(`/api/v1/live-sessions/${id}/attendance`)).status).toBe(200); // assigned staff
    expect((await (await as('m-teacher', 'mit')).get(`/api/v1/live-sessions/${id}/attendance`)).status).toBe(404);
  });

  it('marks someone who barely stayed as absent', async () => {
    await admin.liveAttendance.updateMany({ where: { sessionId: id, userId: 's2' }, data: { totalSeconds: 120 } });
    const res = await (await as('teacher')).get(`/api/v1/live-sessions/${id}/attendance`);
    expect(res.body.data.find((r: any) => r.userId === 's2')).toMatchObject({ present: false, minutes: 2 });
  });

  it('ends the session and closes the room when the media server reports it finished', async () => {
    await hook(evt('room_finished', undefined, Math.floor(Date.now() / 1000)));
    const s = await admin.liveSession.findUnique({ where: { id } });
    expect(s).toMatchObject({ status: 'ENDED' });
    expect(s!.endedAt).toBeTruthy();
    expect((await admin.liveAttendance.findFirst({ where: { sessionId: id, userId: 's1' } }))!.activeSince).toBeNull();
    expect(await admin.auditLog.count({ where: { action: 'LIVE_SESSION_ENDED', resourceId: id } })).toBe(1);
    await hook(evt('room_finished', undefined, Math.floor(Date.now() / 1000))); // repeated: no second audit entry
    expect(await admin.auditLog.count({ where: { action: 'LIVE_SESSION_ENDED', resourceId: id } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('row-level security on live classes', () => {
  it('hides sessions and attendance from a connection with no tenant context', async () => {
    const unscoped = new PrismaClient({ datasourceUrl: db.appUrl });
    try {
      for (const t of ['liveSession', 'liveAttendance'] as const) {
        expect(await (admin as any)[t].count(), t).toBeGreaterThan(0);
        expect(await (unscoped as any)[t].count(), t).toBe(0);
      }
    } finally {
      await unscoped.$disconnect();
    }
  });
});
