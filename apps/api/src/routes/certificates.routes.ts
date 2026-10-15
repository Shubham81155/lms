import { Router } from 'express';
import { z } from 'zod';
import { runWithTenant } from '@enterprise-lms/database';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma';
import { resolveTenant } from '../lib/tenant';
import { HttpError, route } from '../lib/http';
import { parseQuery } from '../lib/validate';

import { rateLimitStore } from '../lib/rate-limit-store';

const router = Router();

const verifyLimiter = rateLimit({
  store: rateLimitStore('cert-verify'),
  passOnStoreError: true,
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many verification requests. Try again later.' },
});

export const verifyQuery = z.object({ tenant: z.string().trim().min(1).max(100).optional() });

/**
 * GET /api/v1/certificates/verify/:number?tenant=<slug>
 * Public. Confirms that a certificate exists and who it was issued to, revealing nothing else.
 * The tenant comes from the link (?tenant=) or the usual tenant hints.
 */
router.get(
  '/verify/:number',
  verifyLimiter,
  route('Failed to verify certificate', async (req, res) => {
    const { tenant: tenantParam } = parseQuery(req, verifyQuery);
    const number = String(req.params.number);
    if (!/^CERT-\d{4}-[0-9A-F]{10}$/.test(number)) throw new HttpError(404, 'Certificate not found');

    const tenant = await resolveTenant([...(tenantParam ? [tenantParam] : []), ...(req.tenantHints ?? [])]);
    if (!tenant) throw new HttpError(404, 'Certificate not found');

    const certificate = await runWithTenant(tenant.id, () =>
      prisma.certificate.findFirst({
        where: { certificateNumber: number, enrollment: { tenantId: tenant.id } },
        select: {
          certificateNumber: true,
          issuedAt: true,
          expiresAt: true,
          enrollment: {
            select: {
              completedAt: true,
              user: { select: { firstName: true, lastName: true } },
              course: { select: { title: true, code: true } },
            },
          },
        },
      })
    );
    if (!certificate) throw new HttpError(404, 'Certificate not found');

    const expired = !!certificate.expiresAt && certificate.expiresAt < new Date();
    return res.status(200).json({
      valid: !expired,
      certificateNumber: certificate.certificateNumber,
      issuedAt: certificate.issuedAt,
      expiresAt: certificate.expiresAt,
      issuedTo: `${certificate.enrollment.user.firstName} ${certificate.enrollment.user.lastName}`.trim(),
      course: certificate.enrollment.course,
      institution: tenant.name,
    });
  })
);

export default router;
