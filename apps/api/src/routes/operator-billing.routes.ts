import { Router, Request } from 'express';
import { z } from 'zod';
import { basePrisma } from '../lib/prisma';
import { HttpError, route } from '../lib/http';
import { idSchema, parseBody } from '../lib/validate';
import { assignPlan, createPlanSchema, planView, updatePlanSchema } from '../lib/billing';
import { logAuditEvent } from '../lib/audit';
import type { Actor } from '../lib/organizations';
import { authenticateJWT, requireRole, tenantIdOf } from '../middleware/auth';
import { requireOperator } from './operator.routes';

// Mounted at /api/v1/operator (after operator.routes.ts). The platform operator edits the plans on sale and
// assigns a plan to an organisation by hand (for customers who pay by invoice or a contract rather than Razorpay).

const router = Router();
// Guards per route, not router.use: this router sits before operatorRoutes, whose own guard must not run twice.
const guard = [authenticateJWT, requireRole('SUPER_ADMIN'), requireOperator];

const actorOf = (req: Request): Actor => ({
  tenantId: tenantIdOf(req),
  userId: req.user!.id,
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});

const operatorPlanView = (p: Awaited<ReturnType<typeof basePrisma.plan.findFirstOrThrow>>) => ({
  ...planView(p),
  active: p.active,
  sortOrder: p.sortOrder,
  razorpayRegistered: !!(p.razorpayMonthlyPlanId || p.razorpayYearlyPlanId),
});

async function audit(req: Request, action: string, id: string, diffJson: Record<string, unknown>) {
  await logAuditEvent({
    tenantId: tenantIdOf(req),
    userId: req.user!.id,
    action,
    resourceType: 'PLAN',
    resourceId: id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    diffJson,
  });
}

/** GET /api/v1/operator/plans: every plan, inactive ones included. */
router.get(
  '/plans',
  ...guard,
  route('Failed to list the plans', async (_req, res) => {
    const plans = await basePrisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return res.json({ data: plans.map(operatorPlanView) });
  })
);

/** POST /api/v1/operator/plans */
router.post(
  '/plans',
  ...guard,
  route('Failed to create the plan', async (req, res) => {
    const input = parseBody(req, createPlanSchema);
    if (await basePrisma.plan.findUnique({ where: { code: input.code } })) throw new HttpError(409, 'A plan with that code exists');
    const plan = await basePrisma.plan.create({ data: input });
    await audit(req, 'PLAN_CREATED', plan.id, { ...input });
    return res.status(201).json({ data: operatorPlanView(plan) });
  })
);

/**
 * PATCH /api/v1/operator/plans/:id. A new price is registered with Razorpay afresh on its next use; subscriptions
 * already running keep the price they were bought at.
 */
router.patch(
  '/plans/:id',
  ...guard,
  route('Failed to update the plan', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const input = parseBody(req, updatePlanSchema);
    const before = await basePrisma.plan.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, 'Plan not found');
    const plan = await basePrisma.plan.update({
      where: { id },
      data: {
        ...input,
        ...(input.monthlyPaise !== undefined && input.monthlyPaise !== before.monthlyPaise ? { razorpayMonthlyPlanId: null } : {}),
        ...(input.yearlyPaise !== undefined && input.yearlyPaise !== before.yearlyPaise ? { razorpayYearlyPlanId: null } : {}),
      },
    });
    await audit(req, 'PLAN_UPDATED', id, {
      before: Object.fromEntries(Object.keys(input).map((k) => [k, (before as any)[k]])),
      after: input,
    });
    return res.json({ data: operatorPlanView(plan) });
  })
);

export const assignPlanSchema = z
  .object({ planId: z.string().min(1).max(64).nullable(), seats: z.number().int().min(1).max(10_000_000).optional() })
  .strict();

/** POST /api/v1/operator/organizations/:id/plan: assigns a plan by hand (planId null removes a manual assignment). */
router.post(
  '/organizations/:id/plan',
  ...guard,
  route('Failed to assign the plan', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    await assignPlan(id, parseBody(req, assignPlanSchema), actorOf(req));
    return res.json({ data: { assigned: true } });
  })
);

export default router;
