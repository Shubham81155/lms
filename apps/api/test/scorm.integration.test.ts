import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { mkdtemp, rm } from 'fs/promises';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// SCORM against a real PostgreSQL (row-level security on) and local storage in a temp folder: unpacking a
// package safely, who may add and play it, the token-guarded content routes (player page, saved data,
// package files), and a package reporting completion finishing the lesson and the course.

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let scorm: typeof import('../src/lib/scorm.js');
let dir: string;

/** A zip with stored (uncompressed) entries. */
function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    const fname = Buffer.from(name);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fname.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fname.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, fname, data);
    centrals.push(central, fname);
    offset += 30 + fname.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const manifest12 = (href: string) => `<?xml version="1.0"?>
<manifest identifier="m" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org1"><organization identifier="org1"><title>Fire safety</title>
    <item identifier="i1"><title>Module</title><item identifier="i2" identifierref="r1"><title>Lesson</title></item></item>
  </organization></organizations>
  <resources><resource identifier="r1" type="webcontent" adlcp:scormtype="sco" href="${href}"><file href="${href}"/></resource></resources>
</manifest>`;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'harvard' } });
  const user = (id: string, role: any, firstName = id) =>
    admin.user.create({
      data: {
        id,
        tenantId: 't-h',
        email: `${id}@x.edu`,
        firstName,
        lastName: 'L',
        role,
        passwordHash: bcrypt.hashSync(PASSWORD, 4),
        emailVerified: true,
      },
    });
  await user('teacher', 'INSTRUCTOR');
  await user('s1', 'STUDENT', 'Ada');
  await user('outsider', 'STUDENT');
  for (const c of ['c1', 'c2']) {
    await admin.course.create({ data: { id: c, tenantId: 't-h', code: c.toUpperCase(), title: c, status: 'PUBLISHED' } });
    await admin.courseInstructor.create({ data: { courseId: c, userId: 'teacher', isPrimary: true } });
  }
  await admin.enrollment.create({ data: { tenantId: 't-h', courseId: 'c1', userId: 's1', status: 'IN_PROGRESS' } });
  await admin.module.create({ data: { id: 'm1', courseId: 'c1', title: 'Week 1' } });

  dir = await mkdtemp(path.join(os.tmpdir(), 'lms-scorm-test-'));
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  scorm = await import('../src/lib/scorm.js');
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
  const res = await agent
    .post('/api/v1/auth/login')
    .set('x-tenant-id', 'harvard')
    .send({ email: `${who}@x.edu`, password: PASSWORD });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

const uploadZip = (agent: request.Agent, body: Buffer, courseId = 'c1', type = 'application/zip') =>
  agent
    .post('/api/v1/files')
    .query({ purpose: 'SCORM_PACKAGE', courseId, filename: 'fire-safety.zip' })
    .set('content-type', type)
    .send(body);

const addPackage = async (agent: request.Agent, entries: Record<string, string>, courseId = 'c1') => {
  const up = await uploadZip(agent, zip(entries), courseId);
  expect(up.status).toBe(201);
  return agent.post(`/api/v1/courses/${courseId}/scorm-packages`).send({ fileId: up.body.data.id });
};

describe('reading packages', () => {
  it('finds the version, title and start page in the manifest', () => {
    expect(scorm.parseManifest(manifest12('index.html?x=1'))).toEqual({ version: '1.2', title: 'Fire safety', href: 'index.html?x=1' });
    const m2004 = `<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3">
      <metadata><schemaversion>2004 4th Edition</schemaversion></metadata>
      <organizations default="o"><organization identifier="o"><title>T</title><item identifier="i" identifierref="r" parameters="?mode=a"/></organization></organizations>
      <resources xml:base="content/"><resource identifier="r" href="start.html"/></resources></manifest>`;
    expect(scorm.parseManifest(m2004)).toEqual({ version: '2004', title: 'T', href: 'content/start.html?mode=a' });
  });

  it('refuses unsafe paths', () => {
    for (const bad of ['../evil.html', '/etc/passwd', 'a/../../b', 'C:/x', 'a\\b']) expect(scorm.safeEntryPath(bad)).toBeNull();
    expect(scorm.safeEntryPath('course/./x')).toBeNull();
    expect(scorm.safeEntryPath('course/index.html')).toBe('course/index.html');
  });

  it('summarises both SCORM versions in one vocabulary', () => {
    expect(scorm.summarise('1.2', { 'cmi.core.lesson_status': 'passed', 'cmi.core.score.raw': '8', 'cmi.core.score.max': '10' })).toEqual({
      status: 'passed',
      scorePercent: 80,
      completed: true,
    });
    expect(scorm.summarise('2004', { 'cmi.completion_status': 'incomplete', 'cmi.score.scaled': '0.5' })).toEqual({
      status: 'incomplete',
      scorePercent: 50,
      completed: false,
    });
    expect(scorm.summarise('2004', { 'cmi.success_status': 'passed' }).completed).toBe(true);
  });
});

let pkgId: string;
let contentBase: string;

describe('adding a package', () => {
  it('unpacks a zip with an outer folder and finds the start page', async () => {
    const res = await addPackage(await as('teacher'), {
      'fire/imsmanifest.xml': manifest12('index.html'),
      'fire/index.html': '<html><body><script src="sco.js"></script></body></html>',
      'fire/sco.js': 'API.LMSInitialize("")',
      '__MACOSX/fire/._index.html': 'junk',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ title: 'Fire safety', version: '1.2', launchPath: 'fire/index.html', fileCount: 3 });
    pkgId = res.body.data.id;
    expect(await admin.auditLog.count({ where: { action: 'SCORM_PACKAGE_ADDED', resourceId: pkgId } })).toBe(1);
  });

  it('refuses broken, unsafe and incomplete packages', async () => {
    const t = await as('teacher');
    const why = async (entries: Record<string, string>) => {
      const r = await addPackage(t, entries);
      expect(r.status).toBe(400);
      return r.body.error as string;
    };
    expect(await why({ 'imsmanifest.xml': manifest12('index.html'), 'index.html': 'x', '../escape.html': 'x' })).toMatch(/unsafe path/);
    expect(await why({ 'index.html': 'x' })).toMatch(/no imsmanifest.xml/);
    expect(await why({ 'imsmanifest.xml': manifest12('missing.html') })).toMatch(/not in the package/);
    const notZip = await uploadZip(t, Buffer.from('not a zip'));
    expect((await t.post('/api/v1/courses/c1/scorm-packages').send({ fileId: notZip.body.data.id })).body.error).toMatch(/not a zip/);
    // Nothing was left behind by the refused packages.
    expect(await admin.scormPackage.count()).toBe(1);
  });

  it('is for course editors, and the zip stays with the staff', async () => {
    const s1 = await as('s1');
    expect((await uploadZip(s1, zip({ 'a.txt': 'x' }))).status).toBe(403);
    expect((await uploadZip(await as('teacher'), Buffer.from('%PDF'), 'c1', 'application/pdf')).status).toBe(415);
    const up = await uploadZip(await as('teacher'), zip({ 'a.txt': 'x' }), 'c1', 'application/x-zip-compressed');
    expect(up.status).toBe(201);
    expect((await s1.get(up.body.data.url)).status).toBe(404);
    expect((await (await as('teacher')).get('/api/v1/courses/c1/scorm-packages')).body.data).toHaveLength(1);
  });

  it('plays only in lessons of its own course', async () => {
    const t = await as('teacher');
    expect((await t.post('/api/v1/courses/c2/modules').send({ title: 'W' })).status).toBe(201);
    const c2Module = (await admin.module.findFirstOrThrow({ where: { courseId: 'c2' } })).id;
    expect(
      (
        await t
          .post(`/api/v1/courses/c2/modules/${c2Module}/lessons`)
          .send({ title: 'Wrong course', contentType: 'SCORM_PACKAGE', scormPackageId: pkgId })
      ).status
    ).toBe(400);
    expect((await t.post('/api/v1/courses/c1/modules/m1/lessons').send({ title: 'No package', contentType: 'SCORM_PACKAGE' })).status).toBe(
      400
    );
    const ok = await t
      .post('/api/v1/courses/c1/modules/m1/lessons')
      .send({ title: 'Fire safety', contentType: 'SCORM_PACKAGE', scormPackageId: pkgId });
    expect(ok.status).toBe(201);
  });
});

describe('playing a package', () => {
  it('hands out a launch link on the content origin to people who can read the course', async () => {
    expect((await (await as('outsider')).get(`/api/v1/scorm-packages/${pkgId}/launch`)).status).toBe(403);
    const res = await (await as('s1')).get(`/api/v1/scorm-packages/${pkgId}/launch`);
    expect(res.status).toBe(200);
    const url = new URL(res.body.data.url);
    expect(url.origin).toBe(res.body.data.origin);
    expect(url.hostname).toBe('127.0.0.1'); // development default: not the web app's origin
    expect(url.pathname).toMatch(/^\/scorm-content\/[^/]+\/__launch$/);
    contentBase = url.pathname.replace(/__launch$/, '');
  });

  it('serves the player page, framable by the LMS only', async () => {
    const res = await request(app).get(`${contentBase}__launch`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('window.API =');
    expect(res.text).toContain('window.API_1484_11 =');
    expect(res.text).toContain('"fire/index.html"');
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain('frame-ancestors');
    expect(res.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('serves the package files and nothing else, and only with a valid token', async () => {
    const page = await request(app).get(`${contentBase}fire/index.html`);
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect((await request(app).get(`${contentBase}fire/sco.js`)).headers['content-type']).toContain('javascript');
    expect((await request(app).get(`${contentBase}fire/missing.js`)).status).toBe(404);
    expect((await request(app).get(`${contentBase}__MACOSX/fire/._index.html`)).status).toBe(404);

    const [, , token] = contentBase.split('/');
    const tampered = `${token.slice(0, -2)}xx`;
    expect((await request(app).get(`/scorm-content/${tampered}/fire/index.html`)).status).toBe(403);
    const expired = scorm.signLaunch({ t: 't-h', p: pkgId, u: 's1' }, -10);
    expect((await request(app).get(`/scorm-content/${expired}/__state`)).status).toBe(403);
    // Never on another host: in development localhost:4000 gets the web app's session cookie.
    expect((await request(app).get(`${contentBase}fire/index.html`).set('Host', 'localhost:4000')).status).toBe(404);
  });

  it('starts fresh, then resumes where the learner left off; read-only values cannot be changed', async () => {
    const first = await request(app).get(`${contentBase}__state`);
    expect(first.body.cmi).toMatchObject({
      'cmi.core.student_id': 's1',
      'cmi.core.student_name': 'L, Ada',
      'cmi.core.lesson_status': 'not attempted',
      'cmi.core.entry': 'ab-initio',
    });

    const saved = await request(app)
      .post(`${contentBase}__commit`)
      .send({ cmi: { 'cmi.core.lesson_status': 'incomplete', 'cmi.suspend_data': 'page=3', 'cmi.core.student_id': 'someone-else' } });
    expect(saved.body).toEqual({ status: 'incomplete', scorePercent: null, completed: false });
    const again = await request(app).get(`${contentBase}__state`);
    expect(again.body.cmi).toMatchObject({ 'cmi.suspend_data': 'page=3', 'cmi.core.student_id': 's1', 'cmi.core.entry': 'resume' });
    expect(
      (
        await request(app)
          .post(`${contentBase}__commit`)
          .send({ cmi: { 'cmi.x': 5 } })
      ).status
    ).toBe(400);
  });

  it('finishes the lesson, and the course, when the package reports a pass', async () => {
    const done = await request(app)
      .post(`${contentBase}__commit`)
      .send({ cmi: { 'cmi.core.lesson_status': 'passed', 'cmi.core.score.raw': '80', 'cmi.core.score.max': '100' } });
    expect(done.body).toEqual({ status: 'passed', scorePercent: 80, completed: true });
    const lesson = await admin.lesson.findFirstOrThrow({ where: { scormPackageId: pkgId } });
    expect(await admin.lessonProgress.count({ where: { userId: 's1', lessonId: lesson.id } })).toBe(1);
    // The only lesson of a course without a gradebook: the course is complete.
    expect(await admin.enrollment.findUniqueOrThrow({ where: { courseId_userId: { courseId: 'c1', userId: 's1' } } })).toMatchObject({
      status: 'COMPLETED',
      progressPercent: 100,
    });

    // Enrolled learners who never opened the package are listed too; a dropped one is not.
    await admin.user.create({
      data: { id: 's2', tenantId: 't-h', email: 's2@x.edu', firstName: 'Bo', lastName: 'L', role: 'STUDENT', passwordHash: 'x' },
    });
    await admin.user.create({
      data: { id: 's3', tenantId: 't-h', email: 's3@x.edu', firstName: 'Cy', lastName: 'L', role: 'STUDENT', passwordHash: 'x' },
    });
    await admin.enrollment.create({ data: { tenantId: 't-h', courseId: 'c1', userId: 's2', status: 'ENROLLED' } });
    await admin.enrollment.create({ data: { tenantId: 't-h', courseId: 'c1', userId: 's3', status: 'DROPPED' } });
    const results = await (await as('teacher')).get(`/api/v1/scorm-packages/${pkgId}/attempts`);
    expect(results.body.data).toMatchObject([
      { userId: 's1', status: 'passed', scorePercent: 80 },
      { userId: 's2', name: 'Bo L', status: 'not attempted', scorePercent: null, completedAt: null, updatedAt: null },
    ]);
    expect(results.body.data).toHaveLength(2);
    expect((await (await as('s1')).get(`/api/v1/scorm-packages/${pkgId}/attempts`)).status).toBe(403);
  });

  it('is withdrawn when a virus scan finds malware in its zip, even mid-lesson', async () => {
    const pkg = await admin.scormPackage.findUniqueOrThrow({ where: { id: pkgId } });
    expect(pkg.sourceFileId).not.toBeNull();
    await admin.storedFile.update({ where: { id: pkg.sourceFileId! }, data: { scanStatus: 'INFECTED' } });
    try {
      expect((await (await as('s1')).get(`/api/v1/scorm-packages/${pkgId}/launch`)).status).toBe(410);
      // A launch link handed out before the scan stops working too.
      expect((await request(app).get(`${contentBase}__launch`)).status).toBe(410);
      expect((await request(app).get(`${contentBase}__state`)).status).toBe(410);
      const list = await (await as('teacher')).get('/api/v1/courses/c1/scorm-packages');
      expect(list.body.data.find((p: { id: string }) => p.id === pkgId)).toMatchObject({ withdrawn: true });
    } finally {
      await admin.storedFile.update({ where: { id: pkg.sourceFileId! }, data: { scanStatus: 'NOT_SCANNED' } });
    }
    expect((await request(app).get(`${contentBase}__state`)).status).toBe(200);
  });

  it('is part of the personal data export and cleared on erasure', async () => {
    const s1 = await as('s1');
    const exported = await s1.get('/api/v1/privacy/me/export');
    // Each save is the whole data set (the player sends everything), so this is the last one.
    expect(JSON.stringify(exported.body)).toContain('"cmi.core.score.raw":"80"');
    expect((await s1.post('/api/v1/privacy/me/erase').send({ confirmEmail: 's1@x.edu', password: PASSWORD })).status).toBe(200);
    const attempt = await admin.scormAttempt.findFirstOrThrow({ where: { userId: 's1' } });
    expect(attempt).toMatchObject({ cmiJson: {}, status: 'passed', scorePercent: 80 });
    // A launch link issued before the erasure cannot write the data back.
    expect(
      (
        await request(app)
          .post(`${contentBase}__commit`)
          .send({ cmi: { 'cmi.suspend_data': 'again' } })
      ).status
    ).toBe(403);
    expect((await admin.scormAttempt.findFirstOrThrow({ where: { userId: 's1' } })).cmiJson).toEqual({});
  });
});
