import express, { Router, Request } from 'express';
import { route } from '../lib/http';
import { parseBody } from '../lib/validate';
import {
  billingOverview,
  cancelSubscription,
  handleWebhook,
  invoicePdfFor,
  listActivePlans,
  listInvoices,
  planView,
  profileSchema,
  resumeSubscription,
  saveProfile,
  subscribe,
  subscribeSchema,
} from '../lib/billing';
import type { Actor } from '../lib/organizations';
import { authenticateJWT, requireRole, tenantIdOf } from '../middleware/auth';

// Mounted at /api/v1/billing: an organisation's plan, usage, billing details, subscription and invoices, for its
// administrators. The Razorpay webhook (billingWebhookRouter) is public and signature-checked; the operator's plan
// routes are in operator-billing.routes.ts.

const router = Router();

const actorOf = (req: Request): Actor => ({ tenantId: tenantIdOf(req), userId: req.user!.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] });

router.use(authenticateJWT, requireRole('TENANT_ADMIN', 'SUPER_ADMIN'));

/** GET /api/v1/billing/plans: the plans on sale. */
router.get(
  '/plans',
  route('Failed to load the plans', async (_req, res) => res.json({ data: (await listActivePlans()).map(planView) }))
);

/** GET /api/v1/billing: plan, subscription state, usage against the limits, billing details. */
router.get(
  '/',
  route('Failed to load billing', async (req, res) => res.json({ data: await billingOverview(tenantIdOf(req)) }))
);

/** PUT /api/v1/billing/profile: the legal details invoices are issued to. */
router.put(
  '/profile',
  route('Failed to save the billing details', async (req, res) => {
    const input = parseBody(req, profileSchema);
    await saveProfile(tenantIdOf(req), input, actorOf(req));
    return res.json({ data: { legalName: input.legalName, gstin: input.gstin, address: input.address, stateCode: input.stateCode } });
  })
);

/** POST /api/v1/billing/subscribe: starts a subscription; the customer pays on Razorpay's page (shortUrl). */
router.post(
  '/subscribe',
  route('Failed to start the subscription', async (req, res) => {
    const input = parseBody(req, subscribeSchema);
    return res.status(201).json({ data: await subscribe(tenantIdOf(req), input, actorOf(req)) });
  })
);

/** POST /api/v1/billing/cancel: the subscription ends with the paid period. */
router.post(
  '/cancel',
  route('Failed to cancel the subscription', async (req, res) => {
    await cancelSubscription(tenantIdOf(req), actorOf(req));
    return res.json({ data: await billingOverview(tenantIdOf(req)) });
  })
);

/** POST /api/v1/billing/resume: takes back a cancellation made for the end of the period. */
router.post(
  '/resume',
  route('Failed to resume the subscription', async (req, res) => {
    await resumeSubscription(tenantIdOf(req), actorOf(req));
    return res.json({ data: await billingOverview(tenantIdOf(req)) });
  })
);

/** GET /api/v1/billing/invoices */
router.get(
  '/invoices',
  route('Failed to load the invoices', async (req, res) => res.json({ data: await listInvoices(tenantIdOf(req)) }))
);

/** GET /api/v1/billing/invoices/:id/pdf */
router.get(
  '/invoices/:id/pdf',
  route('Failed to load the invoice', async (req, res) => {
    const { number, pdf } = await invoicePdfFor(tenantIdOf(req), String(req.params.id));
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${number.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf"`);
    return res.send(pdf);
  })
);

export default router;

// ----------------------------------------------------------------------------- the webhook

/** Mounted at /api/v1/billing/webhook ahead of the JSON parser: the signature covers the exact bytes received. */
export const billingWebhookRouter = Router();

billingWebhookRouter.post(
  '/',
  express.raw({ type: '*/*', limit: '1mb' }),
  route('Failed to handle the webhook', async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const eventId = req.headers['x-razorpay-event-id'];
    const result = await handleWebhook(raw, String(req.headers['x-razorpay-signature'] ?? ''), typeof eventId === 'string' ? eventId : undefined);
    return res.json({ data: result });
  })
);
