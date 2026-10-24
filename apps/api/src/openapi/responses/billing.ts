import { z } from 'zod';
import type { OperationDoc } from '../docs';
import { createPlanSchema, profileSchema, subscribeSchema, updatePlanSchema } from '../../lib/billing';
import { assignPlanSchema } from '../../routes/operator-billing.routes';

/** Billing (routes/billing.routes.ts, operator-billing.routes.ts): plans, subscription, GST invoices, Razorpay webhook. */

const ok = (schema: z.ZodTypeAny, status = 200) => ({ status, schema });

const Plan = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  tier: z.enum(['STARTER', 'PROFESSIONAL', 'ENTERPRISE']),
  /** Most seats one subscription can buy. */
  seatLimit: z.number(),
  courseLimit: z.number().nullable(),
  storageGb: z.number().nullable(),
  /** Per seat, in paise, GST included. */
  monthlyPaise: z.number(),
  yearlyPaise: z.number(),
});

const OperatorPlan = Plan.extend({ active: z.boolean(), sortOrder: z.number(), razorpayRegistered: z.boolean() });

const Profile = z.object({ legalName: z.string(), gstin: z.string().nullable(), address: z.string(), stateCode: z.string() });

const Billing = z.object({
  plan: Plan.nullable(),
  /** NONE: no subscription (a trial, or checkout not completed). */
  status: z.enum(['NONE', 'ACTIVE', 'PAST_DUE', 'CANCELLED']),
  interval: z.enum(['MONTH', 'YEAR']).nullable(),
  seats: z.number().nullable(),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  /** Limits are null while there is no subscription in force. */
  usage: z.object({
    seats: z.number(),
    seatLimit: z.number().nullable(),
    courses: z.number(),
    courseLimit: z.number().nullable(),
    storageBytes: z.number(),
    storageLimitBytes: z.number().nullable(),
  }),
  profile: Profile.nullable(),
  razorpayKeyId: z.string().nullable(),
  /** False when the platform has no Razorpay keys: subscribing answers 503. */
  configured: z.boolean(),
});

const InvoiceItem = z.object({
  id: z.string(),
  number: z.string(),
  issuedAt: z.string(),
  amountPaise: z.number(),
  taxPaise: z.number(),
  status: z.string(),
});

export const BILLING_DOCS: Record<string, OperationDoc> = {
  'GET /api/v1/billing/plans': {
    summary: 'Administrators: the plans on sale (prices per seat in paise, GST included).',
    response: ok(z.object({ data: z.array(Plan) })),
  },
  'GET /api/v1/billing': {
    summary:
      "Administrators: the organisation's plan and subscription state, usage against the plan's limits, billing details and whether online payment is set up.",
    response: ok(z.object({ data: Billing })),
  },
  'PUT /api/v1/billing/profile': {
    summary:
      'Administrators: save the legal details invoices are issued to (name, GSTIN if registered, address, two-digit GST state code; the GSTIN must start with the state code). Audited.',
    body: profileSchema,
    response: ok(z.object({ data: Profile })),
    errors: [400],
  },
  'POST /api/v1/billing/subscribe': {
    summary:
      "Administrators: start a subscription (plan, MONTH or YEAR, seats). Needs billing details (409) and at least as many seats as are in use. Returns Razorpay's hosted payment page (`shortUrl`); the subscription becomes active when the webhook confirms payment. 503 when online payment is not set up. Audited.",
    body: subscribeSchema,
    response: ok(
      z.object({ data: z.object({ subscriptionId: z.string(), razorpayKeyId: z.string().nullable(), shortUrl: z.string() }) }),
      201
    ),
    errors: [400, 404, 409, 502, 503],
  },
  'POST /api/v1/billing/cancel': {
    summary:
      'Administrators: end the subscription when the paid period ends. 409 when there is none, it is already ending, or the operator assigned the plan by hand. Audited.',
    response: ok(z.object({ data: Billing })),
    errors: [409, 502],
  },
  'POST /api/v1/billing/resume': {
    summary: 'Administrators: take back a cancellation made for the end of the period. Audited.',
    response: ok(z.object({ data: Billing })),
    errors: [409, 502],
  },
  'GET /api/v1/billing/invoices': {
    summary: "Administrators: the organisation's GST invoices, newest first.",
    response: ok(z.object({ data: z.array(InvoiceItem) })),
  },
  'GET /api/v1/billing/invoices/:id/pdf': {
    summary: 'Administrators: a GST invoice as a PDF (attachment).',
    response: { status: 200, contentType: 'application/pdf', schema: z.string(), description: 'The PDF.' },
    errors: [404],
  },
  'POST /api/v1/billing/webhook': {
    summary:
      'Razorpay webhook (public; the X-Razorpay-Signature HMAC of the raw body is checked, X-Razorpay-Event-Id makes redelivery harmless). subscription.activated/charged/resumed activate the plan, convert a trial organisation to paid and (charged) issue the invoice; pending/halted make it PAST_DUE; cancelled/completed make the organisation read-only. 400 for a bad signature, 503 without a webhook secret.',
    response: ok(z.object({ data: z.object({ status: z.enum(['handled', 'duplicate', 'ignored']) }) })),
    errors: [400, 503],
  },
  'GET /api/v1/operator/plans': {
    summary: 'Platform operator: every plan, inactive ones included.',
    response: ok(z.object({ data: z.array(OperatorPlan) })),
  },
  'POST /api/v1/operator/plans': {
    summary: 'Platform operator: create a plan (prices per seat in paise, GST included). Audited.',
    body: createPlanSchema,
    response: ok(z.object({ data: OperatorPlan }), 201),
    errors: [400, 409],
  },
  'PATCH /api/v1/operator/plans/:id': {
    summary:
      'Platform operator: change a plan. A new price is registered with Razorpay on its next use; running subscriptions keep their price. Audited.',
    body: updatePlanSchema,
    response: ok(z.object({ data: OperatorPlan })),
    errors: [400, 404],
  },
  'POST /api/v1/operator/organizations/:id/plan': {
    summary:
      "Platform operator: assign a plan to an organisation by hand (seats default to the plan's limit; `planId` null removes a manual assignment). Applies the tier and seat quota and ends a trial or lapse. 409 for an organisation that pays through Razorpay. Audited in both trails.",
    body: assignPlanSchema,
    response: ok(z.object({ data: z.object({ assigned: z.boolean() }) })),
    errors: [400, 404, 409],
  },
};
