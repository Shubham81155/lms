import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { runWithTenant } from '@enterprise-lms/database';
import { prisma } from '../lib/prisma';
import { HttpError, route } from '../lib/http';
import { verifyUnsubscribeToken } from '../lib/digest';
import { rateLimitStore } from '../lib/rate-limit-store';
import { z } from 'zod';
import { parseQuery } from '../lib/validate';

// Mounted at /api/v1/notifications/unsubscribe, ahead of the signed-in notification routes. The link in a digest
// e-mail carries a signed token (lib/digest.ts), so these work without signing in. They can only turn the
// person's digests off. POST is what mail clients call for List-Unsubscribe one-click (RFC 8058).

const router = Router();

const limiter = rateLimit({
  store: rateLimitStore('digest-unsubscribe'),
  passOnStoreError: true,
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again later.' },
});
router.use(limiter);

export const tokenQuery = z.object({ token: z.string().min(10).max(400) });

const NOT_VALID = 'This link is not valid.';

const recipient = (req: Parameters<typeof parseQuery>[0]) => {
  const claims = verifyUnsubscribeToken(parseQuery(req, tokenQuery).token);
  if (!claims) throw new HttpError(400, NOT_VALID);
  return claims;
};

/** GET /api/v1/notifications/unsubscribe?token=: what the link is for (the page asks before it unsubscribes). */
router.get(
  '/',
  route('Failed to check the link', async (req, res) => {
    const { tenantId, userId } = recipient(req);
    const pref = await runWithTenant(tenantId, () =>
      prisma.notificationPreference.findUnique({ where: { userId }, select: { digestFrequency: true } })
    );
    const user = await runWithTenant(tenantId, () =>
      prisma.user.findFirst({ where: { id: userId }, select: { id: true, tenant: { select: { name: true } } } })
    );
    if (!user) throw new HttpError(400, NOT_VALID);
    return res.json({ data: { organisation: user.tenant.name, digestFrequency: pref?.digestFrequency ?? 'WEEKLY' } });
  })
);

/** POST /api/v1/notifications/unsubscribe?token=: turns the person's digest e-mails off. */
router.post(
  '/',
  route('Failed to unsubscribe', async (req, res) => {
    const { tenantId, userId } = recipient(req);
    const done = await runWithTenant(tenantId, async () => {
      const user = await prisma.user.findFirst({ where: { id: userId }, select: { id: true } });
      if (!user) return false;
      await prisma.notificationPreference.upsert({
        where: { userId },
        create: { tenantId, userId, digestFrequency: 'OFF' },
        update: { digestFrequency: 'OFF' },
      });
      return true;
    });
    if (!done) throw new HttpError(400, NOT_VALID);
    return res.json({ data: { digestFrequency: 'OFF' } });
  })
);

export default router;
