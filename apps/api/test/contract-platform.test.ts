import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Contract test for responses/support.ts and responses/offboarding.ts: every operation is called for real and
// its body is parsed with the documented schema.

const PASSWORD = 'CorrectHorse1!';

let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let TABLE: Record<string, any>;
const covered = new Set<string>();

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-op', slug: 'ops', name: 'Operator', tier: 'ENTERPRISE' } });
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'Harvard', tier: 'ENTERPRISE' } });
  const user = (id: string, tenantId: string, role: any) =>
    admin.user.create({
      data: {
        id,
        tenantId,
        email: `${id}@x.edu`,
        firstName: id,
        lastName: 'L',
        role,
        passwordHash: bcrypt.hashSync(PASSWORD, 4),
        emailVerified: true,
      },
    });
  await user('operator', 't-op', 'SUPER_ADMIN');
  await user('admin', 't-h', 'TENANT_ADMIN');

  process.env.PLATFORM_OPERATOR_TENANT = 'ops';
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  const storage = await import('../src/lib/storage.js');
  storage.setStorageDriver(storage.localDriver(fs.mkdtempSync(path.join(os.tmpdir(), 'lms-contract-platform-'))));
  (await import('../src/lib/mailer.js')).setMailer({ async send() {} });
  TABLE = {
    ...(await import('../src/openapi/responses/support.js')).RESPONSES,
    ...(await import('../src/openapi/responses/offboarding.js')).OFFBOARDING_DOCS,
  };
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

async function as(who: string, tenant: string) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .set('x-tenant-id', tenant)
    .send({ email: `${who}@x.edu`, password: PASSWORD });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

/** Asserts the status is the documented success status and the body matches its schema (a ZIP: its bytes). */
function check(key: string, res: request.Response, status?: number): any {
  const entry = TABLE[key];
  expect(entry, `${key} is in the table`).toBeTruthy();
  expect(res.status, `${key}: ${JSON.stringify(res.body)}`).toBe(status ?? entry.response.status);
  if (entry.response.contentType) {
    expect(res.headers['content-type']).toContain(entry.response.contentType);
  } else {
    const parsed = entry.response.schema.safeParse(res.body);
    expect(parsed.success, `${key}: ${JSON.stringify(parsed.success ? null : parsed.error)} body=${JSON.stringify(res.body)}`).toBe(true);
  }
  covered.add(key);
  return res.body;
}

/** supertest buffers a binary body instead of parsing it. */
const binary = (req: request.Test) =>
  req.buffer(true).parse((res, done) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  });

describe('sign-in', () => {
  it('login says whether the user is the platform operator, as /auth/me does', async () => {
    const login = (email: string, tenant: string) =>
      request(app).post('/api/v1/auth/login').set('x-tenant-id', tenant).send({ email, password: PASSWORD });
    expect((await login('operator@x.edu', 'ops')).body.user.platformOperator).toBe(true);
    expect((await login('admin@x.edu', 'harvard')).body.user.platformOperator).toBe(false);
  });
});

describe('support access', () => {
  it('grant, enter, session, exit and revoke', async () => {
    const a = await as('admin', 'harvard');
    const pass = check(
      'POST /api/v1/support/passes',
      await a.post('/api/v1/support/passes').send({ hours: 1, reason: 'Gradebook looks wrong' }),
      201
    ).data;
    expect(pass).toMatchObject({ scope: 'READ_ONLY', status: 'ACTIVE' });
    check('GET /api/v1/support/passes', await a.get('/api/v1/support/passes'));
    expect(check('GET /api/v1/support/session', await a.get('/api/v1/support/session')).data).toBeNull();

    const op = await as('operator', 'ops');
    expect(check('GET /api/v1/operator/support-passes', await op.get('/api/v1/operator/support-passes')).data).toHaveLength(1);
    const link = check(
      'POST /api/v1/operator/support-passes/:id/enter',
      await op.post(`/api/v1/operator/support-passes/${pass.id}/enter`)
    ).data;
    const token = new URL(link.url).searchParams.get('token');

    const support = request.agent(app);
    check('POST /api/v1/support/enter', await support.post('/api/v1/support/enter').send({ token }));
    expect(check('GET /api/v1/support/session', await support.get('/api/v1/support/session')).data).toMatchObject({
      scope: 'READ_ONLY',
      operatorEmail: 'operator@x.edu',
    });
    check('POST /api/v1/support/exit', await support.post('/api/v1/support/exit'));

    expect(check('POST /api/v1/support/passes/:id/revoke', await a.post(`/api/v1/support/passes/${pass.id}/revoke`)).data.status).toBe(
      'REVOKED'
    );
  });
});

describe('offboarding', () => {
  it('administrators: export, download, schedule and cancel deletion', async () => {
    const a = await as('admin', 'harvard');
    check('GET /api/v1/admin/offboarding', await a.get('/api/v1/admin/offboarding'));
    const job = check('POST /api/v1/admin/offboarding/export', await a.post('/api/v1/admin/offboarding/export'), 202).data;
    await (await import('../src/lib/offboarding.js')).runOffboardingJobs();
    const zip = await binary(a.get(`/api/v1/admin/offboarding/export/${job.id}/download`));
    check('GET /api/v1/admin/offboarding/export/:id/download', zip);
    expect((zip.body as Buffer).subarray(0, 2).toString()).toBe('PK');

    const scheduled = check(
      'POST /api/v1/admin/offboarding/deletion',
      await a.post('/api/v1/admin/offboarding/deletion').send({ confirmSlug: 'harvard' })
    );
    expect(scheduled.data.deletion).toMatchObject({ byOperator: false, canCancel: true });
    expect(
      check('DELETE /api/v1/admin/offboarding/deletion', await a.delete('/api/v1/admin/offboarding/deletion')).data.deletion
    ).toBeNull();
  });

  it('operator: the same for any organisation, and the overview', async () => {
    const op = await as('operator', 'ops');
    check('GET /api/v1/operator/tenants/:id/offboarding', await op.get('/api/v1/operator/tenants/t-h/offboarding'));
    const job = check('POST /api/v1/operator/tenants/:id/export', await op.post('/api/v1/operator/tenants/t-h/export'), 202).data;
    await (await import('../src/lib/offboarding.js')).runOffboardingJobs();
    check('GET /api/v1/operator/exports/:exportId/download', await binary(op.get(`/api/v1/operator/exports/${job.id}/download`)));

    expect(
      check(
        'POST /api/v1/operator/tenants/:id/deletion',
        await op.post('/api/v1/operator/tenants/t-h/deletion').send({ confirmSlug: 'harvard' })
      ).data.deletion.byOperator
    ).toBe(true);
    expect(check('GET /api/v1/operator/offboarding', await op.get('/api/v1/operator/offboarding')).data.scheduled).toHaveLength(1);
    expect(
      check('DELETE /api/v1/operator/tenants/:id/deletion', await op.delete('/api/v1/operator/tenants/t-h/deletion')).data.deletion
    ).toBeNull();
  });
});

describe('coverage', () => {
  it('exercised every operation in the table', () => {
    expect(Object.keys(TABLE).filter((k) => !covered.has(k))).toEqual([]);
  });
});
