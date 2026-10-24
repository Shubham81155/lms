import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Under TENANT_BASE_DOMAIN a support handoff link only works at the organisation's own address (its subdomain or
// custom domain): elsewhere, including with an x-tenant-id header naming it, it is refused. (Without
// TENANT_BASE_DOMAIN there is no per-organisation address to check: support-access.integration.test.ts.)

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-op', slug: 'ops', name: 'Operator', tier: 'ENTERPRISE' } });
  await admin.tenant.create({ data: { id: 't-y', slug: 'yale', name: 'Yale', tier: 'ENTERPRISE', customDomain: 'learn.yale.example' } });
  await admin.tenant.create({ data: { id: 't-b', slug: 'brown', name: 'Brown', tier: 'ENTERPRISE' } });
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
  await user('y-admin', 't-y', 'TENANT_ADMIN');
  process.env.PLATFORM_OPERATOR_TENANT = 'ops';
  process.env.TENANT_BASE_DOMAIN = 'lms.test';
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;

  const login = async (who: string, tenant: string) => {
    const agent = request.agent(app);
    expect(
      (
        await agent
          .post('/api/v1/auth/login')
          .set('x-tenant-id', tenant)
          .send({ email: `${who}@x.edu`, password: PASSWORD })
      ).status
    ).toBe(200);
    return agent;
  };
  const granted = await (await login('y-admin', 'yale')).post('/api/v1/support/passes').send({ hours: 1, reason: 'Check the gradebook' });
  expect(granted.status).toBe(201);
  passId = granted.body.data.id;
  operator = await login('operator', 'ops');
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

let passId: string;
let operator: ReturnType<typeof request.agent>;

async function link() {
  const res = await operator.post(`/api/v1/operator/support-passes/${passId}/enter`);
  expect(res.status).toBe(200);
  return new URL(res.body.data.url);
}

const enterAt = (host: string, token: string, headers: Record<string, string> = {}) =>
  request(app).post('/api/v1/support/enter').set('Host', host).set(headers).send({ token });

describe('support handoff under TENANT_BASE_DOMAIN', () => {
  it("points at the organisation's own address", async () => {
    expect((await link()).host).toBe('learn.yale.example');
  });

  it('works at the custom domain and at the subdomain', async () => {
    for (const host of ['learn.yale.example', 'yale.lms.test']) {
      const token = (await link()).searchParams.get('token')!;
      const res = await enterAt(host, token);
      expect(res.status, host).toBe(200);
    }
  });

  it("is refused at another organisation's address, the platform's own host, or with only a header naming it", async () => {
    for (const [host, headers] of [
      ['brown.lms.test', {}],
      ['lms.test', {}],
      ['brown.lms.test', { 'x-tenant-id': 'yale' }],
      ['unknown.lms.test', { 'x-tenant-id': 't-y' }],
    ] as const) {
      const token = (await link()).searchParams.get('token')!;
      const res = await enterAt(host, token, headers);
      expect(res.status, host).toBe(400);
      expect(res.body.error).toBe('Invalid request');
      expect(res.body.details).toBeUndefined();
      // The link is spent: not usable at the right address afterwards either.
      expect((await enterAt('yale.lms.test', token)).status).toBe(410);
    }
  });
});
