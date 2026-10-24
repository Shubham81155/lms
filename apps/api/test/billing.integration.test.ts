import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Billing: GST split and invoice numbering, the Razorpay webhook (signature, idempotency, the subscription
// life cycle), subscribing with a fake Razorpay client, the overdue job, plan limits and the operator's plan routes.

const PASSWORD = 'CorrectHorse1!';
const WEBHOOK_SECRET = 'whsec-test-secret-1234';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let billing: typeof import('../src/lib/billing.js');
let invoiceLib: typeof import('../src/lib/billing-invoice.js');
let rzp: typeof import('../src/lib/razorpay.js');
const calls: string[] = [];

beforeAll(async () => {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_keyid1';
  process.env.RAZORPAY_KEY_SECRET = 'rzp-test-secret-1';
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.SELLER_STATE_CODE = '27';
  process.env.SELLER_LEGAL_NAME = 'Seller Pvt Ltd';
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  const trial = { status: 'TRIAL' as const, trialEndsAt: new Date(Date.now() + 5 * 86_400_000) };
  await admin.tenant.create({ data: { id: 't-op', slug: 'ops', name: 'Operator', tier: 'ENTERPRISE' } });
  await admin.tenant.create({ data: { id: 't-a', slug: 'acme', name: 'Acme', tier: 'STARTER', ...trial } });
  await admin.tenant.create({ data: { id: 't-b', slug: 'beta', name: 'Beta', tier: 'STARTER', ...trial } });
  await admin.tenant.create({ data: { id: 't-c', slug: 'gamma', name: 'Gamma', tier: 'STARTER' } });
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
  await user('a-admin', 't-a', 'TENANT_ADMIN');
  await user('a-student', 't-a', 'STUDENT');
  await user('b-admin', 't-b', 'TENANT_ADMIN');
  await user('c-admin', 't-c', 'TENANT_ADMIN');

  process.env.PLATFORM_OPERATOR_TENANT = 'ops';
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  billing = await import('../src/lib/billing.js');
  invoiceLib = await import('../src/lib/billing-invoice.js');
  rzp = await import('../src/lib/razorpay.js');
  rzp.setRazorpayClient({
    async createPlan(i) {
      calls.push(`plan:${i.interval}:${i.amountPaise}`);
      return { id: `plan_${calls.length}` };
    },
    async createSubscription(i) {
      calls.push(`sub:${i.planId}:${i.quantity}:${i.notes.tenantId}`);
      return { id: `sub_${i.notes.tenantId}`, shortUrl: `https://rzp.io/i/${i.notes.tenantId}` };
    },
    async cancelSubscription(id, atCycleEnd) {
      calls.push(`cancel:${id}:${atCycleEnd}`);
    },
    async cancelScheduledChanges(id) {
      calls.push(`resume:${id}`);
    },
  });
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

let eventSeq = 0;
function webhook(
  event: string,
  tenantId: string,
  extra: { payment?: { id: string; amount: number }; quantity?: number; eventId?: string; sign?: boolean } = {}
) {
  const body = JSON.stringify({
    event,
    payload: {
      subscription: {
        entity: {
          id: `sub_${tenantId}`,
          quantity: extra.quantity ?? 5,
          current_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
          notes: { tenantId },
        },
      },
      ...(extra.payment ? { payment: { entity: extra.payment } } : {}),
    },
  });
  const signature = extra.sign === false ? 'f'.repeat(64) : rzp.signWebhook(WEBHOOK_SECRET, body);
  return request(app)
    .post('/api/v1/billing/webhook')
    .set('content-type', 'application/json')
    .set('x-razorpay-signature', signature)
    .set('x-razorpay-event-id', extra.eventId ?? `evt_${++eventSeq}`)
    .send(body);
}

describe('GST and numbering', () => {
  it('splits an inclusive amount: CGST+SGST in the seller state, IGST elsewhere', () => {
    expect(invoiceLib.computeGst(118_000, '27', '27')).toEqual({
      taxablePaise: 100_000,
      cgstPaise: 9_000,
      sgstPaise: 9_000,
      igstPaise: 0,
      totalPaise: 118_000,
    });
    expect(invoiceLib.computeGst(118_000, '07', '27')).toEqual({
      taxablePaise: 100_000,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 18_000,
      totalPaise: 118_000,
    });
    const odd = invoiceLib.computeGst(99_901, '27', '27');
    expect(odd.taxablePaise + odd.cgstPaise + odd.sgstPaise).toBe(99_901);
    expect(invoiceLib.computeGst(118_000, null, '27').igstPaise).toBe(0);
  });

  it('numbers by Indian financial year', () => {
    expect(invoiceLib.financialYear(new Date('2026-03-31T10:00:00Z'))).toBe('2025-26');
    expect(invoiceLib.financialYear(new Date('2026-03-31T19:00:00Z'))).toBe('2026-27'); // already 1 April in India
    expect(invoiceLib.financialYear(new Date('2026-10-20T00:00:00Z'))).toBe('2026-27');
    expect(invoiceLib.formatInvoiceNumber('2026-27', 1)).toBe('INV/2026-27/000001');
  });

  it('allocates distinct, gapless numbers under concurrency', async () => {
    const { basePrisma } = await import('../src/lib/prisma.js');
    const date = new Date('2031-05-05T00:00:00Z');
    const numbers = await Promise.all(
      Array.from({ length: 8 }, () => basePrisma.$transaction((tx) => invoiceLib.nextInvoiceNumber(tx as any, date)))
    );
    const seqs = numbers.map((n) => Number(n.number.slice(-6))).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('webhook', () => {
  it('rejects a bad signature and does nothing', async () => {
    const res = await webhook('subscription.activated', 't-a', { sign: false });
    expect(res.status).toBe(400);
    expect(await admin.billingEvent.count()).toBe(0);
  });
});

describe('subscribing, paying, invoices', () => {
  it('needs billing details first, validates the GSTIN, then starts a subscription', async () => {
    const a = await as('a-admin', 'acme');
    const plans = await a.get('/api/v1/billing/plans');
    expect(plans.status).toBe(200);
    expect(plans.body.data.map((p: any) => p.code)).toEqual(['starter', 'growth', 'enterprise']);
    const growth = plans.body.data.find((p: any) => p.code === 'growth');

    const early = await a.post('/api/v1/billing/subscribe').send({ planId: growth.id, interval: 'MONTH', seats: 5 });
    expect(early.status).toBe(409);

    expect(
      (
        await a
          .put('/api/v1/billing/profile')
          .send({ legalName: 'Acme Ltd', gstin: 'NOT-A-GSTIN', address: '1 Main Road, Mumbai', stateCode: '27' })
      ).status
    ).toBe(400);
    expect(
      (
        await a
          .put('/api/v1/billing/profile')
          .send({ legalName: 'Acme Ltd', gstin: '07AAAAA0000A1Z5', address: '1 Main Road, Mumbai', stateCode: '27' })
      ).status
    ).toBe(400); // state mismatch
    expect(
      (
        await a
          .put('/api/v1/billing/profile')
          .send({ legalName: 'Acme Ltd', gstin: '27AAAAA0000A1Z5', address: '1 Main Road, Mumbai', stateCode: '27' })
      ).status
    ).toBe(200);

    expect((await a.post('/api/v1/billing/subscribe').send({ planId: growth.id, interval: 'MONTH', seats: 5000 })).status).toBe(400);
    const ok = await a.post('/api/v1/billing/subscribe').send({ planId: growth.id, interval: 'MONTH', seats: 5 });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ subscriptionId: 'sub_t-a', shortUrl: 'https://rzp.io/i/t-a', razorpayKeyId: 'rzp_test_keyid1' });
    expect(calls).toContain('plan:MONTH:299900');
    expect(calls.some((c) => c.startsWith('sub:plan_') && c.endsWith(':5:t-a'))).toBe(true);

    const state = await a.get('/api/v1/billing');
    expect(state.body.data).toMatchObject({ status: 'NONE', configured: true, profile: { legalName: 'Acme Ltd' } });
  });

  it('activates on the webhook, converts the trial, and issues one invoice per payment', async () => {
    const act = await webhook('subscription.activated', 't-a');
    expect(act.status).toBe(200);
    expect(act.body.data.status).toBe('handled');
    const tenant = await admin.tenant.findUniqueOrThrow({ where: { id: 't-a' } });
    expect(tenant).toMatchObject({ status: 'ACTIVE', tier: 'PROFESSIONAL', seatQuota: 5, trialEndsAt: null, trialExpiredAt: null });

    const charged = await webhook('subscription.charged', 't-a', { payment: { id: 'pay_1', amount: 1_499_500 }, eventId: 'evt_charge_1' });
    expect(charged.body.data.status).toBe('handled');
    const replay = await webhook('subscription.charged', 't-a', { payment: { id: 'pay_1', amount: 1_499_500 }, eventId: 'evt_charge_1' });
    expect(replay.body.data.status).toBe('duplicate');
    // Another delivery of the same payment under a new event id still issues no second invoice.
    await webhook('subscription.charged', 't-a', { payment: { id: 'pay_1', amount: 1_499_500 } });
    expect(await admin.invoice.count({ where: { tenantId: 't-a' } })).toBe(1);

    const inv = await admin.invoice.findFirstOrThrow({ where: { tenantId: 't-a' } });
    expect(inv.number).toMatch(/^INV\/\d{4}-\d{2}\/000001$/);
    expect(inv).toMatchObject({ totalPaise: 1_499_500, igstPaise: 0, status: 'PAID' });
    expect(Math.abs(inv.cgstPaise - inv.sgstPaise)).toBeLessThanOrEqual(1);
    expect(inv.taxablePaise + inv.cgstPaise + inv.sgstPaise).toBe(1_499_500);

    await webhook('subscription.charged', 't-a', { payment: { id: 'pay_2', amount: 1_499_500 } });
    const numbers = (await admin.invoice.findMany({ where: { tenantId: 't-a' }, orderBy: { number: 'asc' } })).map((i) =>
      i.number.slice(-6)
    );
    expect(numbers).toEqual(['000001', '000002']);

    const a = await as('a-admin', 'acme');
    const list = await a.get('/api/v1/billing/invoices');
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0]).toMatchObject({ amountPaise: 1_499_500, status: 'PAID' });
    const pdf = await a
      .get(`/api/v1/billing/invoices/${list.body.data[0].id}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const state = await a.get('/api/v1/billing');
    expect(state.body.data).toMatchObject({
      status: 'ACTIVE',
      interval: 'MONTH',
      seats: 5,
      plan: { code: 'growth' },
      usage: { seatLimit: 5, courseLimit: 250 },
    });
  });

  it('uses IGST for a buyer in another state', async () => {
    const b = await as('b-admin', 'beta');
    const growth = (await b.get('/api/v1/billing/plans')).body.data.find((p: any) => p.code === 'growth');
    await b.put('/api/v1/billing/profile').send({ legalName: 'Beta LLP', address: '9 Ring Road, Delhi', stateCode: '07' });
    expect((await b.post('/api/v1/billing/subscribe').send({ planId: growth.id, interval: 'YEAR', seats: 2 })).status).toBe(201);
    await webhook('subscription.activated', 't-b', { quantity: 2 });
    await webhook('subscription.charged', 't-b', { quantity: 2, payment: { id: 'pay_b1', amount: 118_000 } });
    const inv = await admin.invoice.findFirstOrThrow({ where: { tenantId: 't-b' } });
    expect(inv).toMatchObject({ taxablePaise: 100_000, igstPaise: 18_000, cgstPaise: 0, sgstPaise: 0 });
    expect(inv.number).not.toBe((await admin.invoice.findFirstOrThrow({ where: { tenantId: 't-a' }, orderBy: { number: 'asc' } })).number);
  });

  it('cancels at period end and takes the cancellation back', async () => {
    const a = await as('a-admin', 'acme');
    expect((await a.post('/api/v1/billing/resume')).status).toBe(409);
    const cancel = await a.post('/api/v1/billing/cancel');
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.cancelAtPeriodEnd).toBe(true);
    expect(calls).toContain('cancel:sub_t-a:true');
    expect((await a.post('/api/v1/billing/cancel')).status).toBe(409);
    expect((await a.post('/api/v1/billing/resume')).body.data.cancelAtPeriodEnd).toBe(false);
    expect(calls).toContain('resume:sub_t-a');
  });
});

describe('payment failure and cancellation', () => {
  it('goes read-only after the grace period; billing stays reachable so the customer can pay', async () => {
    await webhook('subscription.pending', 't-a');
    const a = await as('a-admin', 'acme');
    expect((await a.get('/api/v1/billing')).body.data.status).toBe('PAST_DUE');
    expect(await billing.runBillingJob(new Date(Date.now() + 3 * 86_400_000))).toBe(0); // within the grace
    expect((await admin.tenant.findUniqueOrThrow({ where: { id: 't-a' } })).status).toBe('ACTIVE');

    expect(await billing.runBillingJob(new Date(Date.now() + 8 * 86_400_000))).toBe(1);
    const lapsed = await admin.tenant.findUniqueOrThrow({ where: { id: 't-a' } });
    expect(lapsed.status).toBe('TRIAL');
    expect(lapsed.trialExpiredAt).not.toBeNull();
    const refused = await a.post('/api/v1/courses').send({});
    expect(refused.status).toBe(402);
    expect(refused.body.code).toBe('PAYMENT_LAPSED'); // not the trial's message
    expect((await a.get('/api/v1/trial')).body.data).toMatchObject({ state: 'READ_ONLY', paymentLapsed: true });
    expect((await a.get('/api/v1/billing')).status).toBe(200);
    expect(
      (await a.put('/api/v1/billing/profile').send({ legalName: 'Acme Ltd', address: '1 Main Road, Mumbai', stateCode: '27' })).status
    ).toBe(200);

    // Paying again reopens the organisation.
    await webhook('subscription.charged', 't-a', { payment: { id: 'pay_3', amount: 1_499_500 } });
    const back = await admin.tenant.findUniqueOrThrow({ where: { id: 't-a' } });
    expect(back).toMatchObject({ status: 'ACTIVE', trialExpiredAt: null });
    expect((await admin.subscription.findUniqueOrThrow({ where: { tenantId: 't-a' } })).pastDueSince).toBeNull();
  });

  it('a cancelled subscription makes the organisation read-only at once; an event for a stale subscription changes nothing', async () => {
    const stale = JSON.stringify({
      event: 'subscription.cancelled',
      payload: { subscription: { entity: { id: 'sub_old', notes: { tenantId: 't-b' } } } },
    });
    const res = await request(app)
      .post('/api/v1/billing/webhook')
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', rzp.signWebhook(WEBHOOK_SECRET, stale))
      .send(stale);
    expect(res.body.data.status).toBe('ignored');
    expect((await admin.tenant.findUniqueOrThrow({ where: { id: 't-b' } })).status).toBe('ACTIVE');

    expect((await webhook('subscription.cancelled', 't-b')).body.data.status).toBe('handled');
    expect((await admin.tenant.findUniqueOrThrow({ where: { id: 't-b' } })).status).toBe('TRIAL');
    expect((await admin.subscription.findUniqueOrThrow({ where: { tenantId: 't-b' } })).status).toBe('CANCELLED');
    const b = await as('b-admin', 'beta');
    expect((await b.get('/api/v1/billing')).body.data).toMatchObject({ status: 'CANCELLED', usage: { seatLimit: null } });
  });
});

describe('operator plans and limits', () => {
  it('only the operator edits plans; a changed price drops the registered Razorpay plan', async () => {
    const a = await as('a-admin', 'acme');
    expect((await a.get('/api/v1/operator/plans')).status).toBe(403);
    const op = await as('operator', 'ops');
    const created = await op.post('/api/v1/operator/plans').send({
      code: 'tiny',
      name: 'Tiny',
      tier: 'STARTER',
      seatLimit: 10,
      courseLimit: 1,
      storageGb: 1,
      monthlyPaise: 50_000,
      yearlyPaise: 500_000,
    });
    expect(created.status).toBe(201);
    expect(
      (
        await op
          .post('/api/v1/operator/plans')
          .send({ code: 'tiny', name: 'Tiny', tier: 'STARTER', seatLimit: 10, monthlyPaise: 50_000, yearlyPaise: 500_000 })
      ).status
    ).toBe(409);
    const list = await op.get('/api/v1/operator/plans');
    const growth = list.body.data.find((p: any) => p.code === 'growth');
    expect(growth.razorpayRegistered).toBe(true);
    const patched = await op.patch(`/api/v1/operator/plans/${growth.id}`).send({ monthlyPaise: 349_900, yearlyPaise: 3_499_000 });
    expect(patched.body.data).toMatchObject({ monthlyPaise: 349_900, razorpayRegistered: false });
    const row = await admin.plan.findUniqueOrThrow({ where: { id: growth.id } });
    expect(row.razorpayMonthlyPlanId).toBeNull();
    expect(row.razorpayYearlyPlanId).toBeNull();
    expect((await op.patch(`/api/v1/operator/plans/${growth.id}`).send({})).status).toBe(400);
    expect((await a.get('/api/v1/billing/plans')).body.data.find((p: any) => p.code === 'growth').monthlyPaise).toBe(349_900);
  });

  it('enforces course, storage and seat limits of an assigned plan', async () => {
    const op = await as('operator', 'ops');
    const tiny = (await op.get('/api/v1/operator/plans')).body.data.find((p: any) => p.code === 'tiny');
    expect((await op.post('/api/v1/operator/organizations/t-c/plan').send({ planId: tiny.id, seats: 11 })).status).toBe(400);
    expect((await op.post('/api/v1/operator/organizations/t-c/plan').send({ planId: tiny.id, seats: 3 })).status).toBe(200);
    expect(await admin.tenant.findUniqueOrThrow({ where: { id: 't-c' } })).toMatchObject({ seatQuota: 3, tier: 'STARTER' });

    await billing.assertCourseAllowed('t-c'); // none yet
    await admin.course.create({ data: { id: 'c-course', tenantId: 't-c', code: 'C1', title: 'One', status: 'DRAFT' } });
    await expect(billing.assertCourseAllowed('t-c')).rejects.toMatchObject({ status: 402 });
    await billing.assertStorageAllowed('t-c', 1024);
    await expect(billing.assertStorageAllowed('t-c', 2 * 1024 ** 3)).rejects.toMatchObject({ status: 402 });

    const c = await as('c-admin', 'gamma');
    expect((await c.get('/api/v1/billing')).body.data).toMatchObject({
      status: 'ACTIVE',
      usage: { seatLimit: 3, courseLimit: 1, courses: 1 },
    });
    // A manual plan is changed by the operator, not through Razorpay.
    expect((await c.post('/api/v1/billing/cancel')).status).toBe(409);

    expect((await op.post('/api/v1/operator/organizations/t-c/plan').send({ planId: null })).status).toBe(200);
    await billing.assertCourseAllowed('t-c'); // no plan: no limit
    expect((await op.post('/api/v1/operator/organizations/t-op/plan').send({ planId: tiny.id })).status).toBe(409);
  });
});
