import { Router } from 'express';
import { basePrisma } from '../lib/prisma';
import { HttpError, route } from '../lib/http';
import { trialInfo } from '../lib/trial';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';

// Mounted at /api/v1/trial. Anyone signed in can see whether their organisation is on a free trial, when it
// ends, and whether it has ended (read-only); the administration page shows it as a banner. The operator's
// trial actions are in operator.routes.ts.

const router = Router();

/** GET /api/v1/trial: the organisation's trial: NONE, TRIAL (days left) or READ_ONLY (until it is suspended). */
router.get(
  '/',
  authenticateJWT,
  route('Failed to load the trial', async (req, res) => {
    const t = await basePrisma.tenant.findUnique({ where: { id: tenantIdOf(req) }, select: { status: true, trialEndsAt: true, trialExpiredAt: true, trialRemindersSent: true } });
    if (!t) throw new HttpError(404, 'Organisation not found');
    return res.json({ data: trialInfo(t) });
  })
);

export default router;
