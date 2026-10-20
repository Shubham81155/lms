import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma } from '../lib/prisma';
import { HttpError, route } from '../lib/http';
import { httpUrl, parseBody, parseQuery } from '../lib/validate';
import { logAuditEvent } from '../lib/audit';
import { logger } from '../lib/logger';
import { mailDelivers, sendMail } from '../lib/mailer';
import { notify } from '../lib/notify';
import { generateOneTimeToken, hashOneTimeToken } from '../lib/one-time-token';
import { rateLimitStore } from '../lib/rate-limit-store';
import { tenantUrl } from '../lib/tenant-url';
import {
  MAX_OPEN_REQUESTS_PER_EMAIL, PENDING_HOLD_MS, SLUG_PROBLEM_MESSAGE, VERIFY_WINDOW_MS,
  openRequestsFor, operatorTenant, operatorUserIds, releaseLapsedHolds, requestedAddress, slugProblem,
} from '../lib/organizations';

// Mounted at /api/v1/organizations. Public: institutions ask for an organisation here, and the login page
// finds an organisation by its address. A request reaches the platform operator only once the applicant has
// confirmed their e-mail, and only becomes an organisation when the operator approves it (operator.routes.ts).

const router = Router();

const limiter = (name: string, windowMs: number, limit: number) =>
  rateLimit({
    store: rateLimitStore(name),
    passOnStoreError: true,
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again later.' },
  });
const lookupLimiter = limiter('org-lookup', 15 * 60 * 1000, 120);
const requestLimiter = limiter('org-request', 60 * 60 * 1000, config.ORG_REQUEST_RATE_LIMIT_MAX);
const confirmLimiter = limiter('org-request-confirm', 15 * 60 * 1000, 30);

export const INSTITUTION_TYPES = ['UNIVERSITY', 'COLLEGE', 'SCHOOL', 'TRAINING_PROVIDER', 'COMPANY', 'OTHER'] as const;

export const slugQuery = z.object({ slug: z.string().trim().toLowerCase().max(100) });

/**
 * GET /api/v1/organizations/availability?slug=: whether a new organisation could use this address, and (when
 * it can) the web address the organisation would have.
 */
router.get(
  '/availability',
  lookupLimiter,
  route('Failed to check the address', async (req, res) => {
    const { slug } = parseQuery(req, slugQuery);
    const reason = await slugProblem(slug);
    return res.json({ data: { slug, available: !reason, ...(reason ? { reason } : { url: tenantUrl({ slug }) }) } });
  })
);

/** GET /api/v1/organizations/lookup?slug=: an active organisation's name, so the login page can confirm it. */
router.get(
  '/lookup',
  lookupLimiter,
  route('Failed to find the organisation', async (req, res) => {
    const { slug } = parseQuery(req, slugQuery);
    const tenant = slug ? await basePrisma.tenant.findUnique({ where: { slug }, select: { slug: true, name: true, status: true } }) : null;
    if (!tenant || !['ACTIVE', 'TRIAL'].includes(tenant.status)) throw new HttpError(404, 'No organisation has that address');
    return res.json({ data: { slug: tenant.slug, name: tenant.name } });
  })
);

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);

/** No web addresses in names: they end up in e-mails and in the operator's queue. */
const noLinks = (v: string) => !v.includes('://') && !/www\./i.test(v);
const LINK_MESSAGE = 'Leave web addresses out of names';

/** Letters in any script, digits, spaces and common punctuation (. , ' & ( ) -). */
export const organizationNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[\p{L}\p{M}\p{N} .,'’&()-]+$/u, "Use letters, digits, spaces and . , ' & ( ) - only")
  .refine(noLinks, LINK_MESSAGE);

const personName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{M} .'’-]+$/u, "Use letters, spaces and . ' - only")
  .refine(noLinks, LINK_MESSAGE);

export const organizationRequestSchema = z.object({
  organizationName: organizationNameSchema,
  slug: z.string().trim().toLowerCase().max(100),
  institutionType: z.enum(INSTITUTION_TYPES),
  country: optionalText(80),
  website: httpUrl.refine((u) => u.startsWith('https://'), 'The website must start with https://').refine((u) => u.length <= 300, 'Too long').optional(),
  expectedLearners: z.number().int().min(1).max(1_000_000).optional(),
  contactFirstName: personName,
  contactLastName: personName,
  contactEmail: z.string().trim().toLowerCase().email().max(254),
  contactPhone: optionalText(40),
  message: optionalText(2000),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Accept the terms to continue' }) }),
});

const confirmLink = (token: string) => `${config.APP_URL.replace(/\/+$/, '')}/register?confirm=${encodeURIComponent(token)}`;

/**
 * POST /api/v1/organizations/requests: ask for an organisation. Nothing reaches the platform operator yet:
 * the applicant is e-mailed a link to confirm their address first (POST /requests/confirm). Until then the
 * request holds its address for 24 hours.
 */
router.post(
  '/requests',
  requestLimiter,
  route('Failed to send the request', async (req, res) => {
    if (!config.ORG_REGISTRATION_ENABLED) throw new HttpError(403, 'Organisation registration is closed');
    const input = parseBody(req, organizationRequestSchema);
    const problem = await slugProblem(input.slug);
    if (problem === 'invalid') throw new HttpError(400, SLUG_PROBLEM_MESSAGE.invalid);
    if (problem) throw new HttpError(409, SLUG_PROBLEM_MESSAGE[problem]);
    if (!mailDelivers()) throw new HttpError(503, 'This server cannot send e-mail, so a request cannot be confirmed. Please contact us instead.');
    if ((await openRequestsFor(input.contactEmail)) >= MAX_OPEN_REQUESTS_PER_EMAIL) {
      throw new HttpError(429, 'This e-mail address already has several open requests. Wait for them to be decided, or for unconfirmed ones to expire.');
    }

    const { token, tokenHash } = generateOneTimeToken();
    const expiresAt = new Date(Date.now() + VERIFY_WINDOW_MS);
    let request;
    try {
      const { acceptTerms: _accepted, ...fields } = input;
      await releaseLapsedHolds(input.slug);
      request = await basePrisma.organizationRequest.create({
        data: {
          ...fields, status: 'UNVERIFIED', ipAddress: req.ip ?? null,
          verificationTokenHash: tokenHash, verificationExpiresAt: expiresAt, holdsSlug: true, holdExpiresAt: expiresAt,
        },
      });
    } catch (err: any) {
      // Two requests for the same address at once: the partial unique index lets only one hold it.
      if (err?.code === 'P2002') throw new HttpError(409, SLUG_PROBLEM_MESSAGE.pending);
      throw err;
    }

    // The applicant's own words stay out of the subject; the body names only the checked address.
    try {
      await sendMail({
        to: input.contactEmail,
        subject: 'Confirm your organisation request',
        text: `Hello ${input.contactFirstName},\n\nPlease confirm your e-mail address to send your request for a new organisation on the learning platform.\n\nRequested address: ${requestedAddress(input.slug)}\n\nUse this link within 24 hours:\n${confirmLink(token)}\n\nOnce it is confirmed, the platform team reviews the request and e-mails you when it has been decided.\n\nIf you did not ask for this, ignore this email: nothing is sent without confirmation.`,
      });
    } catch (err) {
      logger.warn({ err }, 'could not e-mail an organisation request confirmation');
      await basePrisma.organizationRequest.delete({ where: { id: request.id } }).catch(() => undefined);
      throw new HttpError(503, 'The confirmation e-mail could not be sent. Please try again later.');
    }

    return res.status(201).json({
      data: { status: 'UNVERIFIED', slug: request.slug, contactEmail: request.contactEmail, url: tenantUrl({ slug: request.slug }), confirmBy: expiresAt.toISOString() },
    });
  })
);

export const confirmRequestSchema = z.object({ token: z.string().min(16).max(200) }).strict();

/**
 * POST /api/v1/organizations/requests/confirm: the link from the confirmation e-mail. The request then goes
 * to the platform operator's queue (the operators are notified) and holds its address for 30 days.
 * Confirming again reports the request's current state.
 */
router.post(
  '/requests/confirm',
  confirmLimiter,
  route('Failed to confirm the request', async (req, res) => {
    const { token } = parseBody(req, confirmRequestSchema);
    const request = await basePrisma.organizationRequest.findUnique({ where: { verificationTokenHash: hashOneTimeToken(token) } });
    if (!request) throw new HttpError(400, 'This confirmation link is not valid');
    const answer = (r: { status: string; slug: string; organizationName: string; contactEmail: string }) =>
      res.json({ data: { status: r.status, slug: r.slug, organizationName: r.organizationName, contactEmail: r.contactEmail, url: tenantUrl({ slug: r.slug }) } });
    if (request.verifiedAt) return answer(request);
    if (request.status !== 'UNVERIFIED') throw new HttpError(409, 'This request is closed. Send a new request.');
    if (!request.verificationExpiresAt || request.verificationExpiresAt <= new Date()) {
      throw new HttpError(410, 'This confirmation link has expired. Send the request again.');
    }
    const problem = await slugProblem(request.slug, { ignoreRequestId: request.id });
    if (problem) {
      await basePrisma.organizationRequest.updateMany({
        where: { id: request.id, status: 'UNVERIFIED' },
        data: { status: 'REJECTED', holdsSlug: false, decidedAt: new Date(), decisionNote: 'The address was no longer available when the e-mail was confirmed.' },
      });
      throw new HttpError(409, `${SLUG_PROBLEM_MESSAGE[problem]}. Send a new request with another address.`);
    }

    const now = new Date();
    let confirmed;
    try {
      await releaseLapsedHolds(request.slug);
      confirmed = await basePrisma.organizationRequest.updateMany({
        where: { id: request.id, status: 'UNVERIFIED', verifiedAt: null },
        data: { status: 'PENDING', verifiedAt: now, holdsSlug: true, holdExpiresAt: new Date(now.getTime() + PENDING_HOLD_MS) },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') throw new HttpError(409, `${SLUG_PROBLEM_MESSAGE.pending}. Send a new request with another address.`);
      throw err;
    }
    const saved = await basePrisma.organizationRequest.findUniqueOrThrow({ where: { id: request.id } });
    // A second click confirmed it at the same moment; that one tells the operators.
    if (confirmed.count !== 1) return answer(saved);

    const op = await operatorTenant();
    if (op) {
      await runWithTenant(op.id, async () => {
        const operators = await operatorUserIds(op.id);
        await Promise.all(
          operators.map((userId) =>
            notify({
              tenantId: op.id,
              userId,
              category: 'SYSTEM',
              title: `New organisation request: ${saved.organizationName}`,
              body: `${saved.contactFirstName} ${saved.contactLastName} (${saved.contactEmail}) asked for "${saved.slug}".`,
              link: '/platform#requests',
            })
          )
        );
        await logAuditEvent({
          tenantId: op.id, action: 'ORGANIZATION_REQUESTED', resourceType: 'ORGANIZATION_REQUEST', resourceId: saved.id,
          ipAddress: req.ip, userAgent: req.headers['user-agent'],
          diffJson: { organizationName: saved.organizationName, slug: saved.slug, contactEmail: saved.contactEmail, requestedFrom: saved.ipAddress },
        });
      });
    }
    return answer(saved);
  })
);

export default router;
