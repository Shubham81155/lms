import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Organisation hierarchy, compliance report, and the append-only audit trail, against a real
// PostgreSQL with the real migrations and the unprivileged lms_app role.

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
const pw = (slug: string) => `${PASSWORD}-${slug}`;

async function seed() {
  await admin.tenant.create({
    data: { id: 't-h', slug: 'harvard', name: 'Harvard', ferpaCompliant: true, coppaCompliant: false, dataRegion: 'eu-west-1' },
  });
  await admin.tenant.create({ data: { id: 't-m', slug: 'mit', name: 'MIT' } });
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
  await user('admin', 't-h', 'harvard', 'TENANT_ADMIN');
  await user('admin2', 't-h', 'harvard', 'TENANT_ADMIN');
  await user('teacher', 't-h', 'harvard', 'INSTRUCTOR');
  await user('ghost', 't-h', 'harvard', 'STUDENT');
  await user('m-admin', 't-m', 'mit', 'TENANT_ADMIN');

  await admin.campus.create({ data: { id: 'camp-m', tenantId: 't-m', name: 'MIT Main', code: 'MAIN' } });
  await admin.department.create({ data: { id: 'dept-m', campusId: 'camp-m', name: 'EECS', code: 'EECS' } });
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await seed();
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
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

// ---------------------------------------------------------------------------
describe('access', () => {
  it('is for administrators only', async () => {
    for (const path of ['/campuses', '/compliance']) {
      expect((await (await as('teacher')).get(`/api/v1/admin${path}`)).status, path).toBe(403);
      expect((await request(app).get(`/api/v1/admin${path}`)).status, path).toBe(401);
    }
    expect((await (await as('teacher')).post('/api/v1/admin/campuses').send({ name: 'X Campus', code: 'XX' })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('campuses and departments', () => {
  let campusId: string;
  let deptId: string;

  it('creates a campus, normalising its code, and rejects bad or duplicate codes', async () => {
    const a = await as('admin');
    const res = await a.post('/api/v1/admin/campuses').send({ name: ' Cambridge Campus ', code: 'cam-01' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Cambridge Campus', code: 'CAM-01' });
    campusId = res.body.data.id;

    expect((await a.post('/api/v1/admin/campuses').send({ name: 'Other', code: 'CAM-01' })).status).toBe(409);
    expect((await a.post('/api/v1/admin/campuses').send({ name: 'Other', code: 'cam-01' })).status).toBe(409); // case-insensitive
    for (const bad of [
      { name: 'x', code: 'AB' },
      { name: 'Okay', code: 'a' },
      { name: 'Okay', code: 'bad code!' },
      { name: 'Okay', code: '-AB' },
      {},
    ]) {
      expect((await a.post('/api/v1/admin/campuses').send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    // The same code is fine in another tenant.
    expect((await (await as('m-admin', 'mit')).post('/api/v1/admin/campuses').send({ name: 'Another Cam', code: 'CAM-01' })).status).toBe(
      201
    );
  });

  it('creates departments with a code unique within the campus', async () => {
    const a = await as('admin');
    const res = await a.post(`/api/v1/admin/campuses/${campusId}/departments`).send({ name: 'Computer Science', code: 'cs' });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe('CS');
    deptId = res.body.data.id;
    expect((await a.post(`/api/v1/admin/campuses/${campusId}/departments`).send({ name: 'Duplicate', code: 'CS' })).status).toBe(409);

    const second = await a.post('/api/v1/admin/campuses').send({ name: 'Boston Campus', code: 'BOS-01' });
    expect(
      (await a.post(`/api/v1/admin/campuses/${second.body.data.id}/departments`).send({ name: 'Computer Science', code: 'CS' })).status
    ).toBe(201);
    expect((await a.post('/api/v1/admin/campuses/missing/departments').send({ name: 'Nope', code: 'NO' })).status).toBe(404);
  });

  it('lists the hierarchy with course counts per department', async () => {
    await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'C1', status: 'PUBLISHED', departmentId: deptId } });
    await admin.course.create({ data: { id: 'c2', tenantId: 't-h', code: 'C2', title: 'C2', status: 'DRAFT', departmentId: deptId } });
    const list = (await (await as('admin')).get('/api/v1/admin/campuses')).body.data;
    const cam = list.find((c: any) => c.id === campusId);
    expect(cam).toMatchObject({ code: 'CAM-01', courseCount: 2 });
    expect(cam.departments[0]).toMatchObject({ id: deptId, courseCount: 2 });
    expect(list.map((c: any) => c.name)).toEqual([...list.map((c: any) => c.name)].sort()); // sorted
    expect(JSON.stringify(list)).not.toContain('MIT');
  });

  it('never exposes or changes another tenant’s hierarchy', async () => {
    const a = await as('admin');
    expect((await a.patch('/api/v1/admin/campuses/camp-m').send({ name: 'Hijacked' })).status).toBe(404);
    expect((await a.delete('/api/v1/admin/campuses/camp-m')).status).toBe(404);
    expect((await a.patch('/api/v1/admin/departments/dept-m').send({ name: 'Hijacked' })).status).toBe(404);
    expect((await a.delete('/api/v1/admin/departments/dept-m')).status).toBe(404);
    expect((await a.post('/api/v1/admin/campuses/camp-m/departments').send({ name: 'Intruder', code: 'IN' })).status).toBe(404);
    expect((await admin.campus.findUnique({ where: { id: 'camp-m' } }))?.name).toBe('MIT Main');
  });

  it('renames, and blocks a code that collides', async () => {
    const a = await as('admin');
    expect((await a.patch(`/api/v1/admin/campuses/${campusId}`).send({ name: 'Cambridge Main' })).body.data.name).toBe('Cambridge Main');
    expect((await a.patch(`/api/v1/admin/campuses/${campusId}`).send({ code: 'bos-01' })).status).toBe(409);
    expect((await a.patch(`/api/v1/admin/campuses/${campusId}`).send({ code: 'cam-01' })).status).toBe(200); // own code is fine
    expect((await a.patch(`/api/v1/admin/campuses/${campusId}`).send({})).status).toBe(400);
    expect((await a.patch(`/api/v1/admin/departments/${deptId}`).send({ name: 'Computing' })).body.data.name).toBe('Computing');
  });

  it('refuses deletions that would orphan things, then allows them once empty', async () => {
    const a = await as('admin');
    expect((await a.delete(`/api/v1/admin/campuses/${campusId}`)).status).toBe(409); // has a department
    const blocked = await a.delete(`/api/v1/admin/departments/${deptId}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/2 course/);

    await admin.course.updateMany({ where: { departmentId: deptId }, data: { departmentId: null } });
    expect((await a.delete(`/api/v1/admin/departments/${deptId}`)).status).toBe(204);
    expect((await a.delete(`/api/v1/admin/campuses/${campusId}`)).status).toBe(204);
    expect((await a.delete(`/api/v1/admin/campuses/${campusId}`)).status).toBe(404);
  });

  it('audits every change', async () => {
    const actions = (await admin.auditLog.findMany({ where: { tenantId: 't-h', resourceType: { in: ['CAMPUS', 'DEPARTMENT'] } } })).map(
      (l) => l.action
    );
    for (const x of [
      'CAMPUS_CREATED',
      'CAMPUS_UPDATED',
      'CAMPUS_DELETED',
      'DEPARTMENT_CREATED',
      'DEPARTMENT_UPDATED',
      'DEPARTMENT_DELETED',
    ])
      expect(actions, x).toContain(x);
  });
});

// ---------------------------------------------------------------------------
describe('compliance report', () => {
  const get = async () => (await (await as('admin')).get('/api/v1/admin/compliance')).body.data;
  const check = (data: any, id: string) => data.checks.find((c: any) => c.id === id);

  it('reports measured facts with a status each', async () => {
    const d = await get();
    expect(d.checks.length).toBeGreaterThanOrEqual(8);
    for (const c of d.checks) {
      expect(['PASS', 'WARN', 'FAIL', 'INFO']).toContain(c.status);
      expect(c.detail.length).toBeGreaterThan(10);
    }
    expect(check(d, 'tenant-isolation').status).toBe('PASS'); // the API runs as the unprivileged role
    expect(check(d, 'audit-append-only').status).toBe('PASS');
    expect(check(d, 'field-encryption').status).toBe('PASS');
    expect(check(d, 'sso').status).toBe('INFO');
    expect(d.note).toMatch(/organisational/);
  });

  it('shows what the administrator declared, without calling it verified', async () => {
    const d = await get();
    expect(d.declarations).toEqual({ ferpa: true, coppa: false, dataRegion: 'eu-west-1' });
    expect(JSON.stringify(d.checks)).not.toMatch(/certif|SOC 2 Type II verified/i);
  });

  it('tracks administrator MFA adoption', async () => {
    const a = await as('admin'); // log in first: once MFA is on, sign-in needs a code
    const mfa = async () => check((await a.get('/api/v1/admin/compliance')).body.data, 'admin-mfa');
    expect(await mfa()).toMatchObject({ status: 'FAIL', detail: expect.stringContaining('0 of 2') });
    await admin.user.update({ where: { id: 'admin' }, data: { mfaEnabled: true } });
    expect(await mfa()).toMatchObject({ status: 'WARN', detail: expect.stringContaining('1 of 2') });
    await admin.user.update({ where: { id: 'admin2' }, data: { mfaEnabled: true } });
    expect(await mfa()).toMatchObject({ status: 'PASS', detail: expect.stringContaining('2 of 2') });
    await admin.user.updateMany({ where: { id: { in: ['admin', 'admin2'] } }, data: { mfaEnabled: false } });
  });

  it('counts unverified accounts and recent audit activity', async () => {
    expect(check(await get(), 'email-verification').status).toBe('PASS');
    await admin.user.update({ where: { id: 'ghost' }, data: { emailVerified: false } });
    expect(check(await get(), 'email-verification')).toMatchObject({ status: 'WARN', detail: expect.stringContaining('1 active') });
    expect(check(await get(), 'audit-activity').status).toBe('PASS'); // logins and the campus changes above
  });

  it('reflects SSO being configured, per tenant', async () => {
    await admin.ssoConnection.create({
      data: { tenantId: 't-h', issuer: 'https://idp.example', clientId: 'c', clientSecretEnc: 'x', enabled: true },
    });
    expect(check(await get(), 'sso').detail).toMatch(/Enabled: OpenID Connect./);
    await admin.samlConnection.create({
      data: { tenantId: 't-h', entryPoint: 'https://idp.example/sso', idpIssuer: 'idp', idpCert: 'x'.repeat(40), enabled: true },
    });
    expect(check(await get(), 'sso').detail).toMatch(/OpenID Connect and SAML 2.0/);
    const mit = (await (await as('m-admin', 'mit')).get('/api/v1/admin/compliance')).body.data;
    expect(check(mit, 'sso').detail).toMatch(/Not configured/);
    expect(mit.declarations.ferpa).toBe(true); // schema default
  });

  it('leaks no secrets', async () => {
    const text = JSON.stringify(await get());
    expect(text).not.toMatch(/passwordHash|mfaSecret|clientSecret|\$2[aby]\$/);
  });
});

// ---------------------------------------------------------------------------
describe('the audit trail is append-only for the application', () => {
  /** Runs one statement as the unprivileged application role, scoped to a tenant like the API does. */
  async function asApp(statement: string) {
    const client = new PrismaClient({ datasourceUrl: db.appUrl });
    try {
      return await client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', 't-h', true)`;
        return tx.$executeRawUnsafe(statement);
      });
    } finally {
      await client.$disconnect();
    }
  }

  it('lets the API add audit rows', async () => {
    const before = await admin.auditLog.count({ where: { tenantId: 't-h' } });
    await (await as('teacher')).get('/api/v1/auth/me');
    await (await as('admin')).put('/api/v1/ai/settings').send({ provider: 'GEMINI' });
    expect(await admin.auditLog.count({ where: { tenantId: 't-h' } })).toBeGreaterThan(before);
  });

  it('refuses UPDATE, DELETE and TRUNCATE from the application role', async () => {
    expect(await admin.auditLog.count({ where: { tenantId: 't-h' } })).toBeGreaterThan(0);
    await expect(asApp(`UPDATE "AuditLog" SET "action" = 'TAMPERED'`)).rejects.toThrow(/permission denied/i);
    await expect(asApp(`DELETE FROM "AuditLog"`)).rejects.toThrow(/permission denied/i);
    await expect(asApp(`TRUNCATE "AuditLog"`)).rejects.toThrow(/permission denied/i);
    expect(await admin.auditLog.count({ where: { action: 'TAMPERED' } })).toBe(0);
  });

  it('still allows reading, and removing a user still clears the link from their audit rows', async () => {
    await admin.auditLog.create({ data: { tenantId: 't-h', userId: 'ghost', action: 'SOMETHING_BY_GHOST', resourceType: 'USER' } });
    await asApp(`DELETE FROM "User" WHERE "id" = 'ghost'`); // the foreign key's SET NULL runs with the owner's rights
    const row = await admin.auditLog.findFirst({ where: { action: 'SOMETHING_BY_GHOST' } });
    expect(row).toBeTruthy(); // history survives
    expect(row?.userId).toBeNull();
  });
});
