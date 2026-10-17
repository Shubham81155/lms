import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import os from 'os';
import path from 'path';
import { mkdtemp, readdir, rm } from 'fs/promises';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// File uploads against a real PostgreSQL (row-level security on) and the local storage driver in a temp
// folder: who may upload and download what, the type and size limits, attaching uploads to submissions and
// lessons, and erasure removing a learner's files.

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let dir: string;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'harvard' } });
  const user = (id: string, role: any) =>
    admin.user.create({ data: { id, tenantId: 't-h', email: `${id}@x.edu`, firstName: id, lastName: 'L', role, passwordHash: bcrypt.hashSync(PASSWORD, 4), emailVerified: true } });
  await user('teacher', 'INSTRUCTOR');
  await user('other-teacher', 'INSTRUCTOR');
  for (const s of ['s1', 's2', 'outsider']) await user(s, 'STUDENT');
  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'Course', status: 'PUBLISHED' } });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'teacher', isPrimary: true } });
  for (const s of ['s1', 's2']) await admin.enrollment.create({ data: { tenantId: 't-h', courseId: 'c1', userId: s, status: 'IN_PROGRESS' } });
  await admin.assignment.create({ data: { id: 'a1', tenantId: 't-h', courseId: 'c1', title: 'Essay', instructions: 'Write' } });
  await admin.module.create({ data: { id: 'm1', courseId: 'c1', title: 'Week 1', lessons: { create: [{ id: 'l1', title: 'Reading', contentType: 'PDF_DOCUMENT' }] } } });

  dir = await mkdtemp(path.join(os.tmpdir(), 'lms-files-test-'));
  process.env.UPLOAD_MAX_MB = '1';
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  const storage = await import('../src/lib/storage.js');
  storage.setStorageDriver(storage.localDriver(dir));
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
}, 60_000);

async function as(who: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('x-tenant-id', 'harvard').send({ email: `${who}@x.edu`, password: PASSWORD });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

const PDF = Buffer.from('%PDF-1.4\n% test file\n');
const upload = (agent: request.Agent, purpose: string, body: Buffer, type = 'application/pdf', filename = 'essay.pdf') =>
  agent.post('/api/v1/files').query({ purpose, courseId: 'c1', filename }).set('content-type', type).send(body);

let mine: { id: string; url: string };
let lessonFile: { id: string; url: string };

describe('uploading', () => {
  it('stores a learner’s submission file and records it', async () => {
    const res = await upload(await as('s1'), 'ASSIGNMENT_SUBMISSION', PDF, 'application/pdf', '../../My essay ✓.pdf');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ filename: 'My essay ✓.pdf', contentType: 'application/pdf', sizeBytes: PDF.length });
    expect(res.body.data.url).toBe(`/api/v1/files/${res.body.data.id}`);
    mine = res.body.data;
    const row = await admin.storedFile.findUniqueOrThrow({ where: { id: mine.id } });
    expect(row).toMatchObject({ ownerId: 's1', courseId: 'c1', purpose: 'ASSIGNMENT_SUBMISSION' });
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await admin.auditLog.count({ where: { action: 'FILE_UPLOADED', resourceId: mine.id } })).toBe(1);
  });

  it('refuses the wrong people, types and sizes', async () => {
    const s1 = await as('s1');
    expect((await upload(s1, 'LESSON_MEDIA', PDF)).status).toBe(403);
    expect((await upload(await as('outsider'), 'ASSIGNMENT_SUBMISSION', PDF)).status).toBe(403);
    expect((await upload(s1, 'ASSIGNMENT_SUBMISSION', Buffer.from('<script>alert(1)</script>'), 'text/html', 'x.html')).status).toBe(415);
    expect((await upload(s1, 'ASSIGNMENT_SUBMISSION', Buffer.from('<svg/>'), 'image/svg+xml', 'x.svg')).status).toBe(415);
    expect((await upload(s1, 'ASSIGNMENT_SUBMISSION', Buffer.alloc(0))).status).toBe(400);
    const big = await upload(s1, 'ASSIGNMENT_SUBMISSION', Buffer.alloc(1024 * 1024 + 1, 1));
    expect(big.status).toBe(413);
    expect(await admin.storedFile.count()).toBe(1);
  });

  it('lets course editors upload lesson media', async () => {
    const res = await upload(await as('teacher'), 'LESSON_MEDIA', PDF, 'application/pdf', 'reading.pdf');
    expect(res.status).toBe(201);
    lessonFile = res.body.data;
    expect((await upload(await as('other-teacher'), 'LESSON_MEDIA', PDF)).status).toBe(403);
  });
});

describe('downloading', () => {
  it('serves a submission file to its learner and the course staff only', async () => {
    const own = await (await as('s1')).get(mine.url).buffer(true);
    expect(own.status).toBe(200);
    expect(Buffer.compare(own.body, PDF)).toBe(0);
    expect(own.headers['content-type']).toContain('application/pdf');
    expect(own.headers['content-disposition']).toBe(`inline; filename="My essay _.pdf"; filename*=UTF-8''${encodeURIComponent('My essay ✓.pdf')}`);
    expect(own.headers['x-content-type-options']).toBe('nosniff');
    expect(own.headers['cache-control']).toBe('private, no-store');

    expect((await (await as('teacher')).get(mine.url)).status).toBe(200);
    expect((await (await as('s2')).get(mine.url)).status).toBe(404);
    expect((await (await as('other-teacher')).get(mine.url)).status).toBe(403);
    expect((await request(app).get(mine.url)).status).toBe(401);
  });

  it('serves lesson media to everyone in the course', async () => {
    expect((await (await as('s2')).get(lessonFile.url)).status).toBe(200);
    expect((await (await as('outsider')).get(lessonFile.url)).status).toBe(403);
  });

  it('makes files a browser could run download instead, sandboxed', async () => {
    const up = await upload(await as('s1'), 'ASSIGNMENT_SUBMISSION', Buffer.from('notes'), 'text/plain', 'notes.txt');
    const res = await (await as('s1')).get(up.body.data.url);
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['content-security-policy']).toContain('sandbox');
  });
});

describe('attaching uploads', () => {
  it('accepts a learner’s own file on their submission and nobody else’s', async () => {
    const s2File = (await upload(await as('s2'), 'ASSIGNMENT_SUBMISSION', PDF)).body.data;
    const s1 = await as('s1');
    expect((await s1.post('/api/v1/assignments/a1/submit').send({ fileUrl: s2File.url })).status).toBe(400);
    expect((await s1.post('/api/v1/assignments/a1/submit').send({ fileUrl: lessonFile.url })).status).toBe(400);
    expect((await s1.post('/api/v1/assignments/a1/submit').send({ fileUrl: '/api/v1/files/not-a-file' })).status).toBe(400);
    const ok = await s1.post('/api/v1/assignments/a1/submit').send({ fileUrl: mine.url });
    expect(ok.status).toBe(201);
    expect(ok.body.data.fileUrl).toBe(mine.url);
  });

  it('accepts lesson media of the same course on a lesson', async () => {
    const t = await as('teacher');
    expect((await t.patch('/api/v1/courses/c1/lessons/l1').send({ mediaUrl: mine.url })).status).toBe(400);
    const ok = await t.patch('/api/v1/courses/c1/lessons/l1').send({ mediaUrl: lessonFile.url });
    expect(ok.status).toBe(200);
    expect(ok.body.data.mediaUrl).toBe(lessonFile.url);
  });
});

describe('erasure', () => {
  it('removes the learner’s uploaded files and their bytes', async () => {
    const before = await admin.storedFile.findMany({ where: { ownerId: 's1' } });
    expect(before.length).toBeGreaterThan(0);
    expect((await (await as('s1')).post('/api/v1/privacy/me/erase').send({ confirmEmail: 's1@x.edu', password: PASSWORD })).status).toBe(200);
    expect(await admin.storedFile.count({ where: { id: { in: before.map((f) => f.id) } } })).toBe(0);
    const left = await readdir(path.join(dir, 't-h'));
    for (const f of before) expect(left).not.toContain(f.storageKey.split('/')[1]);
    // Lesson media is the course's, not the learner's: it stays.
    expect(await admin.storedFile.count({ where: { id: lessonFile.id } })).toBe(1);
  });
});
