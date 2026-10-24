import crypto from 'crypto';
import { z } from 'zod';
import { runWithTenant } from '@enterprise-lms/database';
import type { Prisma } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma, prisma, runInTenantTransaction } from './prisma';
import { HttpError } from './http';
import { logAuditEvent } from './audit';
import { logger } from './logger';
import { invalidateTenantSessions, PAYMENT_LAPSED } from './session';
import { startPeriodicJob, withJobLock } from './job-lock';
import { computeGst, invoicePdf, nextInvoiceNumber, sellerParty, type Party } from './billing-invoice';
import { razorpay, razorpayConfigured, validWebhookSignature } from './razorpay';
import type { Actor } from './organizations';

// Billing: plans the operator sells, an organisation's subscription (paid through Razorpay, or assigned by the
// operator), GST invoices for each charge, and the limits a plan sets. An organisation without a subscription has
// no plan limits (it is on a trial, or predates billing).
//
// Flow: the administrator saves billing details and subscribes (POST /billing/subscribe); Razorpay's hosted page
// takes the payment; its webhook (POST /billing/webhook, signed) activates the subscription, converts a trial
// organisation to paid, and issues an invoice per charge. A failing charge makes the subscription PAST_DUE; after
// BILLING_GRACE_DAYS the organisation goes read-only (the same read-only state an ended trial has, lib/trial.ts) and
// ORG_TRIAL_GRACE_DAYS later is suspended. A cancelled or finished subscription does the same at once.

export const BILLING_JOB = 'billing-overdue';
const DAY_MS = 86_400_000;
export const GST_STATE_CODE = /^(0[1-9]|[12]\d|3[0-8]|9[79])$/;
export const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export type SubscriptionStatus = 'NONE' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

// --------------------------------------------------------------------------- plans

export interface PlanRow {
  id: string;
  code: string;
  name: string;
  tier: string;
  seatLimit: number;
  courseLimit: number | null;
  storageGb: number | null;
  monthlyPaise: number;
  yearlyPaise: number;
  active?: boolean;
  sortOrder?: number;
}

export const planView = (p: PlanRow) => ({
  id: p.id,
  code: p.code,
  name: p.name,
  tier: p.tier,
  seatLimit: p.seatLimit,
  courseLimit: p.courseLimit,
  storageGb: p.storageGb,
  monthlyPaise: p.monthlyPaise,
  yearlyPaise: p.yearlyPaise,
});

export const listActivePlans = () =>
  basePrisma.plan.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });

const planFields = {
  name: z.string().trim().min(1).max(80),
  tier: z.enum(['STARTER', 'PROFESSIONAL', 'ENTERPRISE']),
  seatLimit: z.number().int().min(1).max(10_000_000),
  courseLimit: z.number().int().min(1).max(10_000_000).nullable(),
  storageGb: z.number().int().min(1).max(10_000_000).nullable(),
  monthlyPaise: z.number().int().min(100).max(100_000_000),
  yearlyPaise: z.number().int().min(100).max(1_000_000_000),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
};
export const createPlanSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{1,31}$/),
    ...planFields,
    courseLimit: planFields.courseLimit.default(null),
    storageGb: planFields.storageGb.default(null),
    active: planFields.active.default(true),
    sortOrder: planFields.sortOrder.default(0),
  })
  .strict();
export const updatePlanSchema = z
  .object({ ...planFields })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

// --------------------------------------------------------------------------- audit

async function auditBilling(
  tenantId: string,
  action: string,
  diffJson: Record<string, unknown>,
  actor?: Actor,
  resourceId?: string
): Promise<void> {
  const entry = {
    action,
    resourceType: 'BILLING',
    resourceId: resourceId ?? tenantId,
    ipAddress: actor?.ipAddress,
    userAgent: actor?.userAgent,
    diffJson,
  };
  try {
    await runWithTenant(tenantId, () =>
      logAuditEvent({ ...entry, tenantId, userId: actor?.tenantId === tenantId ? actor.userId : undefined })
    );
    if (actor && actor.tenantId !== tenantId)
      await runWithTenant(actor.tenantId, () => logAuditEvent({ ...entry, tenantId: actor.tenantId, userId: actor.userId }));
  } catch (err) {
    logger.warn({ err, tenantId, action }, 'could not write a billing audit entry');
  }
}

// --------------------------------------------------------------------------- usage and limits

export async function usageOf(tenantId: string) {
  return runWithTenant(tenantId, async () => {
    const [seats, courses, files] = await Promise.all([
      prisma.user.count({ where: { tenantId, status: { in: ['ACTIVE', 'INVITED'] } } }),
      prisma.course.count({ where: { tenantId, status: { not: 'ARCHIVED' } } }),
      prisma.storedFile.aggregate({ where: { tenantId }, _sum: { sizeBytes: true } }),
    ]);
    return { seats, courses, storageBytes: files._sum.sizeBytes ?? 0 };
  });
}

/** The plan limits in force for an organisation: those of its subscription's plan, none without one. */
async function limitsOf(tenantId: string) {
  const sub = await runWithTenant(tenantId, () => prisma.subscription.findUnique({ where: { tenantId } }));
  if (!sub || (sub.status !== 'ACTIVE' && sub.status !== 'PAST_DUE')) return null;
  const plan = await basePrisma.plan.findUnique({ where: { id: sub.planId } });
  return plan
    ? { seatLimit: sub.seats, courseLimit: plan.courseLimit, storageBytes: plan.storageGb == null ? null : plan.storageGb * 1024 ** 3 }
    : null;
}

const courseFull = (limit: number) =>
  new HttpError(402, `Your plan allows ${limit} courses and all are in use. Archive a course or upgrade the plan.`);
const storageFull = () => new HttpError(402, "Your plan's storage is full. Delete files or upgrade the plan.");

/** 402 when creating one more course would pass the plan's course limit. A fast check; withCourseSlot is the strict one. */
export async function assertCourseAllowed(tenantId: string): Promise<void> {
  const limits = await limitsOf(tenantId);
  if (limits?.courseLimit == null) return;
  const { courses } = await usageOf(tenantId);
  if (courses >= limits.courseLimit) throw courseFull(limits.courseLimit);
}

/** 402 when storing `addBytes` more would pass the plan's storage limit. A fast check; withStorage is the strict one. */
export async function assertStorageAllowed(tenantId: string, addBytes: number): Promise<void> {
  const limits = await limitsOf(tenantId);
  if (limits?.storageBytes == null) return;
  const { storageBytes } = await usageOf(tenantId);
  if (storageBytes + addBytes > limits.storageBytes) throw storageFull();
}

/** Locks the tenant row (the same lock seats use) so the check and the insert that follow it cannot race another. */
const lockTenant = (tx: Tx, tenantId: string) => tx.$queryRaw`SELECT 1 FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;

/**
 * Locks the tenant and throws 402 if the course limit is reached; call it first inside the transaction that inserts the course.
 * The plan is read through `tx`: a second pooled connection taken while holding the transaction one can deadlock a small pool.
 */
export async function checkCourseSlot(tx: Tx, tenantId: string): Promise<void> {
  await lockTenant(tx, tenantId);
  const sub = await tx.subscription.findUnique({ where: { tenantId } });
  if (!sub || (sub.status !== 'ACTIVE' && sub.status !== 'PAST_DUE')) return;
  const plan = await tx.plan.findUnique({ where: { id: sub.planId } });
  if (plan?.courseLimit == null) return;
  const courses = await tx.course.count({ where: { tenantId, status: { not: 'ARCHIVED' } } });
  if (courses >= plan.courseLimit) throw courseFull(plan.courseLimit);
}

/** Checks the course limit and runs `fn` (which creates the course) in one transaction holding the tenant lock. */
export function withCourseSlot<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runInTenantTransaction(tenantId, async (tx) => {
    await checkCourseSlot(tx, tenantId);
    return fn(tx);
  });
}

/** Checks the storage limit for `addBytes` more and runs `fn` (which records the file) under the tenant lock. */
export function withStorage<T>(tenantId: string, addBytes: number, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runInTenantTransaction(tenantId, async (tx) => {
    await lockTenant(tx, tenantId);
    const sub = await tx.subscription.findUnique({ where: { tenantId } });
    if (sub && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE')) {
      const plan = await tx.plan.findUnique({ where: { id: sub.planId } });
      if (plan?.storageGb != null) {
        const sum = await tx.storedFile.aggregate({ where: { tenantId }, _sum: { sizeBytes: true } });
        if ((sum._sum.sizeBytes ?? 0) + addBytes > plan.storageGb * 1024 ** 3) throw storageFull();
      }
    }
    return fn(tx);
  });
}

// --------------------------------------------------------------------------- the organisation's view

const iso = (d: Date | null | undefined) => d ?? null;

export async function billingOverview(tenantId: string) {
  const [sub, profile, usage, tenantRow] = await Promise.all([
    runWithTenant(tenantId, () => prisma.subscription.findUnique({ where: { tenantId } })),
    runWithTenant(tenantId, () => prisma.billingProfile.findUnique({ where: { tenantId } })),
    usageOf(tenantId),
    runWithTenant(tenantId, () => prisma.tenant.findUnique({ where: { id: tenantId }, select: { seatQuota: true } })),
  ]);
  const plan = sub ? await basePrisma.plan.findUnique({ where: { id: sub.planId } }) : null;
  const live = !!sub && sub.status !== 'PENDING';
  const status: SubscriptionStatus = live ? (sub!.status as SubscriptionStatus) : 'NONE';
  const inForce = live && (status === 'ACTIVE' || status === 'PAST_DUE');
  return {
    plan: live && plan ? planView(plan) : null,
    status,
    interval: live ? (sub!.interval as 'MONTH' | 'YEAR') : null,
    seats: live ? sub!.seats : null,
    currentPeriodEnd: live ? iso(sub!.currentPeriodEnd) : null,
    cancelAtPeriodEnd: live ? sub!.cancelAtPeriodEnd : false,
    /** Checkout started but the payment not yet confirmed by Razorpay's webhook. */
    pending: !!sub && sub.status === 'PENDING',
    pendingSince: sub && sub.status === 'PENDING' ? sub.updatedAt : null,
    usage: {
      seats: usage.seats,
      // Without a subscription in force the organisation's own seat quota (a trial's) is the limit, if it has one.
      seatLimit: inForce ? sub!.seats : (tenantRow?.seatQuota ?? null),
      courses: usage.courses,
      courseLimit: inForce ? (plan?.courseLimit ?? null) : null,
      storageBytes: usage.storageBytes,
      storageLimitBytes: inForce && plan?.storageGb != null ? plan.storageGb * 1024 ** 3 : null,
    },
    profile: profile
      ? { legalName: profile.legalName, gstin: profile.gstin, address: profile.address, stateCode: profile.stateCode }
      : null,
    razorpayKeyId: razorpayConfigured() ? (config.RAZORPAY_KEY_ID ?? null) : null,
    configured: razorpayConfigured(),
  };
}

export const profileSchema = z
  .object({
    legalName: z.string().trim().min(2).max(200),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .nullable()
      .transform((v) => v || null)
      .refine((v) => v === null || GSTIN.test(v), 'That is not a valid GSTIN'),
    address: z.string().trim().min(5).max(500),
    stateCode: z.string().trim().regex(GST_STATE_CODE, 'Use the two-digit GST state code, e.g. 27'),
  })
  .strict()
  .refine((v) => !v.gstin || v.gstin.slice(0, 2) === v.stateCode, {
    message: 'The first two digits of the GSTIN are the state code',
    path: ['gstin'],
  });

export async function saveProfile(tenantId: string, input: z.infer<typeof profileSchema>, actor: Actor) {
  const data = { legalName: input.legalName, gstin: input.gstin, address: input.address, stateCode: input.stateCode };
  await runWithTenant(tenantId, () => prisma.billingProfile.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data }));
  await auditBilling(
    tenantId,
    'BILLING_PROFILE_UPDATED',
    { legalName: data.legalName, gstin: data.gstin, stateCode: data.stateCode },
    actor
  );
}

// --------------------------------------------------------------------------- subscribing

export const subscribeSchema = z
  .object({ planId: z.string().min(1).max(64), interval: z.enum(['MONTH', 'YEAR']), seats: z.number().int().min(1).max(10_000_000) })
  .strict();

async function razorpayPlanFor(
  plan: Awaited<ReturnType<typeof basePrisma.plan.findUniqueOrThrow>>,
  interval: 'MONTH' | 'YEAR'
): Promise<string> {
  const have = interval === 'MONTH' ? plan.razorpayMonthlyPlanId : plan.razorpayYearlyPlanId;
  if (have) return have;
  const amountPaise = interval === 'MONTH' ? plan.monthlyPaise : plan.yearlyPaise;
  const created = await razorpay().createPlan({
    name: `${plan.name} (${interval === 'MONTH' ? 'monthly' : 'yearly'}, per seat)`,
    interval,
    amountPaise,
  });
  await basePrisma.plan.update({
    where: { id: plan.id },
    data: interval === 'MONTH' ? { razorpayMonthlyPlanId: created.id } : { razorpayYearlyPlanId: created.id },
  });
  return created.id;
}

/** How long an unfinished subscribe() claim blocks another one (a crashed request must not block for ever). */
const CLAIM_TTL_MS = 60_000;

export async function subscribe(tenantId: string, input: z.infer<typeof subscribeSchema>, actor: Actor) {
  if (!razorpayConfigured()) throw new HttpError(503, 'Online payment is not set up on this platform yet');
  const plan = await basePrisma.plan.findUnique({ where: { id: input.planId } });
  if (!plan || !plan.active) throw new HttpError(404, 'That plan is not available');
  if (input.seats > plan.seatLimit) throw new HttpError(400, `The ${plan.name} plan has at most ${plan.seatLimit} seats`);
  const { seats: used } = await usageOf(tenantId);
  if (input.seats < used) throw new HttpError(409, `${used} seats are in use, so at least ${used} are needed`);

  // Claim first: under a per-organisation lock, check the state and mark the row PENDING with no Razorpay id yet.
  // A second request meanwhile sees the claim and is refused, so only one creates a Razorpay subscription. The lock
  // is held for these statements only, never across the Razorpay calls.
  const claimData = {
    planId: plan.id,
    interval: input.interval,
    seats: input.seats,
    status: 'PENDING',
    razorpaySubscriptionId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pastDueSince: null,
  };
  const previous = await runInTenantTransaction(tenantId, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'billing-subscribe:' + tenantId}))`;
    const profile = await tx.billingProfile.findUnique({ where: { tenantId } });
    if (!profile) throw new HttpError(409, 'Add your billing details first: they go on the invoice');
    const existing = await tx.subscription.findUnique({ where: { tenantId } });
    if (existing && (existing.status === 'ACTIVE' || existing.status === 'PAST_DUE'))
      throw new HttpError(409, 'This organisation is already subscribed. Cancel the subscription before choosing another plan');
    if (
      existing &&
      existing.status === 'PENDING' &&
      !existing.razorpaySubscriptionId &&
      Date.now() - existing.updatedAt.getTime() < CLAIM_TTL_MS
    )
      throw new HttpError(409, 'A subscription is already being set up for this organisation. Try again in a minute');
    await tx.subscription.upsert({ where: { tenantId }, create: { tenantId, ...claimData }, update: claimData });
    return existing;
  });

  let created: Awaited<ReturnType<ReturnType<typeof razorpay>['createSubscription']>>;
  try {
    const planId = await razorpayPlanFor(plan, input.interval);
    // Starting over replaces an unpaid attempt: close the old Razorpay subscription so paying it later cannot charge
    // the customer for something our records have dropped.
    if (previous?.razorpaySubscriptionId && previous.status === 'PENDING')
      await razorpay()
        .cancelSubscription(previous.razorpaySubscriptionId, false)
        .catch((err) => logger.warn({ err, tenantId }, 'could not close the previous unpaid subscription'));
    created = await razorpay().createSubscription({
      planId,
      quantity: input.seats,
      totalCount: input.interval === 'MONTH' ? 120 : 10,
      notes: { tenantId },
    });
  } catch (err) {
    // Release the claim so the customer can retry at once.
    await runWithTenant(tenantId, () =>
      prisma.subscription.deleteMany({ where: { tenantId, status: 'PENDING', razorpaySubscriptionId: null } })
    ).catch(() => undefined);
    throw err;
  }
  const stored = await runWithTenant(tenantId, () =>
    prisma.subscription.updateMany({
      where: { tenantId, status: 'PENDING', razorpaySubscriptionId: null },
      data: { razorpaySubscriptionId: created.id },
    })
  );
  if (stored.count === 0) {
    await razorpay()
      .cancelSubscription(created.id, false)
      .catch((err) => logger.warn({ err, tenantId }, 'could not close a subscription that lost its claim'));
    throw new HttpError(409, 'A subscription is already being set up for this organisation. Try again in a minute');
  }
  await auditBilling(
    tenantId,
    'SUBSCRIPTION_STARTED',
    { plan: plan.code, interval: input.interval, seats: input.seats, razorpaySubscriptionId: created.id },
    actor
  );
  return { subscriptionId: created.id, razorpayKeyId: config.RAZORPAY_KEY_ID ?? null, shortUrl: created.shortUrl };
}

async function currentPaidSubscription(tenantId: string) {
  const sub = await runWithTenant(tenantId, () => prisma.subscription.findUnique({ where: { tenantId } }));
  if (!sub || (sub.status !== 'ACTIVE' && sub.status !== 'PAST_DUE')) throw new HttpError(409, 'This organisation has no subscription');
  if (!sub.razorpaySubscriptionId) throw new HttpError(409, 'This plan was set up by the platform operator: contact us to change it');
  return sub;
}

/** Stops renewals at the end of the paid period. */
export async function cancelSubscription(tenantId: string, actor: Actor) {
  const sub = await currentPaidSubscription(tenantId);
  if (sub.cancelAtPeriodEnd) throw new HttpError(409, 'The subscription is already set to end');
  await razorpay().cancelSubscription(sub.razorpaySubscriptionId!, true);
  await runWithTenant(tenantId, () => prisma.subscription.update({ where: { tenantId }, data: { cancelAtPeriodEnd: true } }));
  await auditBilling(tenantId, 'SUBSCRIPTION_CANCEL_SCHEDULED', { currentPeriodEnd: iso(sub.currentPeriodEnd) }, actor);
}

/** Takes back a cancellation scheduled for the end of the period. */
export async function resumeSubscription(tenantId: string, actor: Actor) {
  const sub = await currentPaidSubscription(tenantId);
  if (!sub.cancelAtPeriodEnd) throw new HttpError(409, 'The subscription is not set to end');
  await razorpay().cancelScheduledChanges(sub.razorpaySubscriptionId!);
  await runWithTenant(tenantId, () => prisma.subscription.update({ where: { tenantId }, data: { cancelAtPeriodEnd: false } }));
  await auditBilling(tenantId, 'SUBSCRIPTION_RESUMED', {}, actor);
}

// --------------------------------------------------------------------------- applying a plan to the organisation

type Tx = Prisma.TransactionClient;

/**
 * Gives the organisation what the plan includes (tier, seats) and makes it a paying one: a trial organisation, or
 * one suspended because its trial or payment lapsed, becomes ACTIVE. An organisation the operator suspended stays so.
 */
async function applyPlan(tx: Tx, tenantId: string, plan: { tier: string }, seats: number): Promise<boolean> {
  const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true, trialExpiredAt: true } });
  if (!t) return false;
  const reopen = t.status === 'TRIAL' || (t.status === 'SUSPENDED' && !!t.trialExpiredAt);
  await tx.tenant.update({
    where: { id: tenantId },
    data: {
      tier: plan.tier as any,
      seatQuota: seats,
      ...(reopen ? { status: 'ACTIVE', trialEndsAt: null, trialExpiredAt: null, trialRemindersSent: 0 } : {}),
    },
  });
  return reopen;
}

/** An active organisation goes read-only (then, after ORG_TRIAL_GRACE_DAYS, suspended), as when a trial ends. */
async function lapseTenant(tx: Tx, tenantId: string, now: Date): Promise<boolean> {
  const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true, slug: true } });
  if (!t || t.status !== 'ACTIVE' || (config.PLATFORM_OPERATOR_TENANT && t.slug === config.PLATFORM_OPERATOR_TENANT)) return false;
  await tx.tenant.update({
    where: { id: tenantId },
    data: { status: 'TRIAL', trialEndsAt: now, trialExpiredAt: now, trialRemindersSent: 3 | PAYMENT_LAPSED },
  });
  return true;
}

// --------------------------------------------------------------------------- invoices

export async function issueInvoice(
  tx: Tx,
  tenantId: string,
  input: { totalPaise: number; description: string; paymentId: string | null; now: Date }
) {
  const profile = await tx.billingProfile.findUnique({ where: { tenantId } });
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  const seller = sellerParty();
  const buyer: Party = profile
    ? { legalName: profile.legalName, gstin: profile.gstin, address: profile.address, stateCode: profile.stateCode }
    : { legalName: tenant?.name ?? 'Customer', gstin: null, address: '', stateCode: seller.stateCode };
  const split = computeGst(input.totalPaise, buyer.stateCode, seller.stateCode);
  const { number, financialYear } = await nextInvoiceNumber(tx, input.now);
  return tx.invoice.create({
    data: {
      tenantId,
      number,
      financialYear,
      issuedAt: input.now,
      razorpayPaymentId: input.paymentId,
      description: input.description,
      ...split,
      buyerJson: buyer as any,
      sellerJson: seller as any,
    },
  });
}

export async function listInvoices(tenantId: string) {
  const rows = await runWithTenant(tenantId, () =>
    prisma.invoice.findMany({ where: { tenantId }, orderBy: { issuedAt: 'desc' }, take: 200 })
  );
  return rows.map((i) => ({
    id: i.id,
    number: i.number,
    issuedAt: i.issuedAt,
    amountPaise: i.totalPaise,
    taxPaise: i.cgstPaise + i.sgstPaise + i.igstPaise,
    status: i.status,
  }));
}

export async function invoicePdfFor(tenantId: string, id: string): Promise<{ number: string; pdf: Buffer }> {
  const i = await runWithTenant(tenantId, () => prisma.invoice.findFirst({ where: { id, tenantId } }));
  if (!i) throw new HttpError(404, 'Invoice not found');
  const pdf = invoicePdf({
    number: i.number,
    issuedAt: i.issuedAt,
    description: i.description,
    taxablePaise: i.taxablePaise,
    cgstPaise: i.cgstPaise,
    sgstPaise: i.sgstPaise,
    igstPaise: i.igstPaise,
    totalPaise: i.totalPaise,
    gstRatePercent: i.gstRatePercent,
    buyer: i.buyerJson as unknown as Party,
    seller: i.sellerJson as unknown as Party,
  });
  return { number: i.number, pdf };
}

// --------------------------------------------------------------------------- the webhook

export type WebhookResult = { status: 'handled' | 'duplicate' | 'ignored' };

interface RzpSubscription {
  id: string;
  quantity?: number;
  current_end?: number | null;
  notes?: Record<string, string> | unknown[];
}
interface RzpPayment {
  id: string;
  amount: number;
  currency?: string;
}
const HANDLED_EVENTS = new Set([
  'subscription.activated',
  'subscription.charged',
  'subscription.resumed',
  'subscription.pending',
  'subscription.halted',
  'subscription.cancelled',
  'subscription.completed',
]);
/** An INR payment of a positive whole number of paise: the only kind an invoice is issued for. */
const validPayment = (p: RzpPayment | undefined): p is RzpPayment =>
  !!p &&
  typeof p.id === 'string' &&
  p.id.length > 0 &&
  Number.isSafeInteger(p.amount) &&
  p.amount > 0 &&
  (!p.currency || p.currency === 'INR');

/**
 * Handles one Razorpay webhook delivery. `rawBody` is exactly what was received (the signature covers it);
 * `eventId` is the X-Razorpay-Event-Id header. Throws HttpError 400 for a bad signature or body, 503 when the
 * webhook secret is not set. An event already handled is acknowledged without changing anything.
 */
export async function handleWebhook(
  rawBody: string,
  signature: string | undefined,
  eventId: string | undefined,
  now = new Date()
): Promise<WebhookResult> {
  const secret = config.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(503, 'Webhooks are not set up');
  if (!validWebhookSignature(secret, rawBody, signature)) throw new HttpError(400, 'Invalid signature');
  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, 'Invalid body');
  }
  const type = typeof body?.event === 'string' ? body.event : '';
  const sub: RzpSubscription | undefined = body?.payload?.subscription?.entity;
  const payment: RzpPayment | undefined = body?.payload?.payment?.entity;
  // The idempotency key is the signed body itself: X-Razorpay-Event-Id is not covered by the signature, so keying on
  // it would let anyone who captured one signed delivery replay it under a fresh id. Razorpay's retries resend the
  // same bytes, so they still collapse into one.
  void eventId;
  const id = crypto.createHash('sha256').update(rawBody).digest('hex');
  const tenantId = sub && !Array.isArray(sub.notes) ? sub.notes?.tenantId : undefined;
  if (!HANDLED_EVENTS.has(type) || !sub?.id || typeof tenantId !== 'string' || !tenantId || tenantId.length > 128)
    return { status: 'ignored' };

  const result = await runInTenantTransaction(tenantId, async (tx) => {
    // ON CONFLICT DO NOTHING waits for a concurrent delivery of the same event, so exactly one of them proceeds.
    const { count } = await tx.billingEvent.createMany({ data: [{ id, type }], skipDuplicates: true });
    if (!count) return { status: 'duplicate' as const };
    const row = await tx.subscription.findUnique({ where: { tenantId } });
    // Only the subscription this organisation has started: an event for an older, replaced one changes nothing.
    // It is not remembered as seen, so a delivery that raced ahead of our own records can be evaluated again.
    if (!row || row.razorpaySubscriptionId !== sub.id) {
      await tx.billingEvent.delete({ where: { id } });
      return { status: 'ignored' as const };
    }
    const plan = await tx.plan.findUnique({ where: { id: row.planId } });
    const periodEnd = sub.current_end ? new Date(sub.current_end * 1000) : row.currentPeriodEnd;
    const seats = sub.quantity && sub.quantity > 0 ? sub.quantity : row.seats;
    const changes: Record<string, unknown> = { event: type };
    let sessions = false;

    // A cancelled subscription stays so: a late activation or failure event must not revive it. A charge that did go
    // through still gets its invoice.
    const dead = row.status === 'CANCELLED';
    if (dead && type !== 'subscription.charged') return { status: 'ignored' as const };

    switch (type) {
      case 'subscription.activated':
      case 'subscription.charged':
      case 'subscription.resumed': {
        if (!dead) {
          await tx.subscription.update({
            where: { tenantId },
            data: { status: 'ACTIVE', seats, currentPeriodEnd: periodEnd, pastDueSince: null },
          });
          if (plan) sessions = (await applyPlan(tx, tenantId, plan, seats)) || sessions;
        }
        if (type === 'subscription.charged' && plan && validPayment(payment)) {
          const already = await tx.invoice.findUnique({ where: { razorpayPaymentId: payment.id } });
          if (!already) {
            const inv = await issueInvoice(tx, tenantId, {
              totalPaise: payment.amount,
              description: `${plan.name} plan: ${seats} seat${seats === 1 ? '' : 's'}, ${row.interval === 'MONTH' ? 'monthly' : 'yearly'} subscription`,
              paymentId: payment.id,
              now,
            });
            changes.invoice = inv.number;
          }
        }
        break;
      }
      case 'subscription.pending':
      case 'subscription.halted':
        await tx.subscription.update({ where: { tenantId }, data: { status: 'PAST_DUE', pastDueSince: row.pastDueSince ?? now } });
        break;
      case 'subscription.cancelled':
      case 'subscription.completed':
        await tx.subscription.update({ where: { tenantId }, data: { status: 'CANCELLED', cancelAtPeriodEnd: false, pastDueSince: null } });
        sessions = await lapseTenant(tx, tenantId, now);
        changes.lapsed = sessions;
        break;
    }
    return { status: 'handled' as const, sessions, changes };
  });

  if (result.status === 'handled') {
    if (result.sessions) invalidateTenantSessions(tenantId);
    await auditBilling(tenantId, 'BILLING_EVENT', { ...result.changes, razorpaySubscriptionId: sub.id });
  }
  return { status: result.status };
}

// --------------------------------------------------------------------------- operator

export async function assignPlan(tenantId: string, input: { planId: string | null; seats?: number }, actor: Actor) {
  const tenant = await basePrisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, slug: true } });
  if (!tenant) throw new HttpError(404, 'Organisation not found');
  if (tenantId === actor.tenantId) throw new HttpError(409, 'The platform operator organisation has no plan');
  const existing = await runWithTenant(tenantId, () => prisma.subscription.findUnique({ where: { tenantId } }));
  if (existing?.razorpaySubscriptionId && (existing.status === 'ACTIVE' || existing.status === 'PAST_DUE'))
    throw new HttpError(409, 'This organisation pays through Razorpay: the subscription has to be cancelled first');

  if (input.planId === null) {
    if (existing) await runWithTenant(tenantId, () => prisma.subscription.delete({ where: { tenantId } }));
    await auditBilling(
      tenantId,
      'PLAN_UNASSIGNED',
      { tenant: tenant.slug, before: existing ? { planId: existing.planId, seats: existing.seats } : null },
      actor
    );
    return;
  }
  const plan = await basePrisma.plan.findUnique({ where: { id: input.planId } });
  if (!plan) throw new HttpError(404, 'Plan not found');
  const seats = input.seats ?? plan.seatLimit;
  if (seats > plan.seatLimit) throw new HttpError(400, `The ${plan.name} plan has at most ${plan.seatLimit} seats`);
  const { seats: used } = await usageOf(tenantId);
  if (seats < used) throw new HttpError(409, `${used} seats are in use, so at least ${used} are needed`);
  const data = {
    planId: plan.id,
    interval: 'MONTH',
    seats,
    status: 'ACTIVE',
    razorpaySubscriptionId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pastDueSince: null,
  };
  const reopened = await runInTenantTransaction(tenantId, async (tx) => {
    await tx.subscription.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
    return applyPlan(tx, tenantId, plan, seats);
  });
  if (reopened) invalidateTenantSessions(tenantId);
  await auditBilling(tenantId, 'PLAN_ASSIGNED', { tenant: tenant.slug, plan: plan.code, seats, reopened }, actor);
}

// --------------------------------------------------------------------------- the background job

/**
 * Subscriptions whose charge has been failing for longer than BILLING_GRACE_DAYS make their organisation
 * read-only. `now` is for tests. Returns the organisations lapsed.
 */
export async function runBillingJob(now = new Date()): Promise<number> {
  const notOperator = config.PLATFORM_OPERATOR_TENANT ? { NOT: { slug: config.PLATFORM_OPERATOR_TENANT } } : {};
  const tenants = await basePrisma.tenant.findMany({ where: { status: 'ACTIVE', ...notOperator }, select: { id: true, slug: true } });
  const cutoff = new Date(now.getTime() - config.BILLING_GRACE_DAYS * DAY_MS);
  let lapsed = 0;
  for (const t of tenants) {
    try {
      const overdue = await runWithTenant(t.id, () =>
        prisma.subscription.findFirst({ where: { tenantId: t.id, status: 'PAST_DUE', pastDueSince: { not: null, lte: cutoff } } })
      );
      if (!overdue) continue;
      const did = await runInTenantTransaction(t.id, (tx) => lapseTenant(tx, t.id, now));
      if (!did) continue;
      invalidateTenantSessions(t.id);
      lapsed++;
      await auditBilling(t.id, 'BILLING_LAPSED', {
        tenant: t.slug,
        pastDueSince: overdue.pastDueSince,
        graceDays: config.BILLING_GRACE_DAYS,
      });
    } catch (err) {
      logger.error({ err, tenantId: t.id }, 'billing job failed for an organisation');
    }
  }
  if (lapsed) logger.info({ lapsed }, 'billing job');
  return lapsed;
}

export const runBillingJobLocked = (now?: Date) => withJobLock(BILLING_JOB, () => runBillingJob(now));
export const startBillingJob = () => startPeriodicJob(BILLING_JOB, config.BILLING_JOB_INTERVAL_SECONDS, () => runBillingJob());
