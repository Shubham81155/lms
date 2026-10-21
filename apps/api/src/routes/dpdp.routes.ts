import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { basePrisma } from '../lib/prisma';
import { authenticateJWT, requireRole, tenantIdOf } from '../middleware/auth';
import { HttpError, route } from '../lib/http';
import { idSchema, parseBody, parseQuery } from '../lib/validate';
import { logAuditEvent } from '../lib/audit';
import { rateLimitStore } from '../lib/rate-limit-store';
import { resolveTenant } from '../lib/tenant';
import { consentReport, listPurposes, myConsents, purposeView, savePurposes, savePurposesSchema, setConsent } from '../lib/consent';
import { breachQuerySchema, breachView, createBreach, createBreachSchema, getBreach, listBreaches, updateBreach, updateBreachSchema } from '../lib/breaches';
import { confirmGuardianConsent, guardianConsentInfo, guardianRequestSchema, guardianTokenSchema, guardianWithdrawalInfo, minorStatus, requestGuardianConsent, setMinor, setMinorSchema, withdrawGuardianConsent } from '../lib/guardian';

// Mounted at /api/v1/privacy, after routes/privacy.routes.ts: the DPDP Act side of privacy. Consent purposes and each
// person's answers (/consents), the personal-data breach register with its 72-hour clock (/breaches), the
// grievance officer (/grievance-officer, public to read), and a minor's guardian consent (/me/minor,
// /me/guardian-consent, /users/:id/minor, and the public /guardian-consent link pages).

const router = Router();

const ctxOf = (req: any) => ({ ipAddress: req.ip as string | undefined, userAgent: req.headers['user-agent'] as string | undefined });
const adminOnly = [authenticateJWT, requireRole('SUPER_ADMIN', 'TENANT_ADMIN')] as const;
const isAdmin = (req: any) => req.user?.role === 'SUPER_ADMIN' || req.user?.role === 'TENANT_ADMIN';

const publicLimiter = rateLimit({
  store: rateLimitStore('dpdp-public'),
  passOnStoreError: true,
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again later.' },
});

export const consentKeyParams = z.object({ key: z.string().min(2).max(40) });
export const grievanceOfficerSchema = z
  .object({
    name: z.string().trim().min(2).max(120).nullable(),
    email: z.string().trim().email().max(320).nullable(),
    phone: z.string().trim().max(40).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    /** Days within which the organisation commits to answer a grievance. */
    responseDays: z.number().int().min(1).max(90).nullable().optional(),
  })
  .refine((b) => (b.name === null) === (b.email === null), { message: 'Give both a name and an e-mail address, or neither' });

// ---------------------------------------------------------------------------- consent

/** GET /api/v1/privacy/consents - the organisation's active purposes with the caller's answer to each */
router.get('/consents', authenticateJWT, route('Failed to load consents', async (req, res) => res.json({ data: await myConsents(tenantIdOf(req), req.user!.id) })));

/** GET /api/v1/privacy/consents/report - per purpose and version: granted, withdrawn, no answer (administrators) */
router.get('/consents/report', ...adminOnly, route('Failed to build the consent report', async (req, res) => res.json({ data: await consentReport(tenantIdOf(req)) })));

/** POST /api/v1/privacy/consents/:key/grant */
router.post(
  '/consents/:key/grant',
  authenticateJWT,
  route('Failed to record consent', async (req, res) => {
    const { key } = consentKeyParams.parse(req.params);
    return res.json({ data: await setConsent(tenantIdOf(req), req.user!, key, true, ctxOf(req)) });
  })
);

/** POST /api/v1/privacy/consents/:key/withdraw - as easy as giving; takes effect at once */
router.post(
  '/consents/:key/withdraw',
  authenticateJWT,
  route('Failed to withdraw consent', async (req, res) => {
    const { key } = consentKeyParams.parse(req.params);
    return res.json({ data: await setConsent(tenantIdOf(req), req.user!, key, false, ctxOf(req)) });
  })
);

/** GET /api/v1/privacy/consent-purposes - every purpose, inactive ones too, with the lawful-basis note (administrators) */
router.get('/consent-purposes', ...adminOnly, route('Failed to load purposes', async (req, res) => res.json({ data: (await listPurposes(tenantIdOf(req), true)).map((p) => purposeView(p, true)) })));

/** PUT /api/v1/privacy/consent-purposes - create or update purposes by key (administrators) */
router.put(
  '/consent-purposes',
  ...adminOnly,
  route('Failed to save purposes', async (req, res) => {
    const { purposes } = parseBody(req, savePurposesSchema);
    const saved = await savePurposes(tenantIdOf(req), req.user!, purposes, ctxOf(req));
    return res.json({ data: saved.map((p) => purposeView(p, true)) });
  })
);

// ---------------------------------------------------------------------------- breach register

/** GET /api/v1/privacy/breaches - the register, newest first, with how many are open and overdue (administrators) */
router.get(
  '/breaches',
  ...adminOnly,
  route('Failed to load the breach register', async (req, res) => {
    const q = parseQuery(req, breachQuerySchema);
    const out = await listBreaches(tenantIdOf(req), q);
    return res.json({ data: out.rows.map((b) => breachView(b)), summary: { open: out.open, overdue: out.overdue } });
  })
);

/** POST /api/v1/privacy/breaches - log a breach; the 72-hour clock starts at detection (administrators) */
router.post(
  '/breaches',
  ...adminOnly,
  route('Failed to register the breach', async (req, res) => {
    const input = parseBody(req, createBreachSchema);
    return res.status(201).json({ data: breachView(await createBreach(tenantIdOf(req), req.user!, input, ctxOf(req))) });
  })
);

/** GET /api/v1/privacy/breaches/:id */
router.get('/breaches/:id', ...adminOnly, route('Failed to load the breach', async (req, res) => res.json({ data: breachView(await getBreach(tenantIdOf(req), String(req.params.id))) })));

/** PATCH /api/v1/privacy/breaches/:id - record containment, notifications, owner; closing needs a notification or a reason (administrators) */
router.patch(
  '/breaches/:id',
  ...adminOnly,
  route('Failed to update the breach', async (req, res) => {
    const input = parseBody(req, updateBreachSchema);
    return res.json({ data: breachView(await updateBreach(tenantIdOf(req), String(req.params.id), req.user!, input, ctxOf(req))) });
  })
);

// ---------------------------------------------------------------------------- grievance officer

/** GET /api/v1/privacy/grievance-officer - public: whom to complain to at the organisation named by the address */
router.get(
  '/grievance-officer',
  publicLimiter,
  route('Failed to load the grievance officer', async (req, res) => {
    const tenant = await resolveTenant(req.tenantHints);
    if (!tenant) throw new HttpError(404, 'Organisation not found');
    const t = await basePrisma.tenant.findUnique({ where: { id: tenant.id }, select: { name: true, grievanceName: true, grievanceEmail: true, grievancePhone: true, grievanceAddress: true, grievanceSlaDays: true } });
    return res.json({
      data: {
        organisation: t?.name ?? tenant.name,
        officer: t?.grievanceName && t.grievanceEmail ? { name: t.grievanceName, email: t.grievanceEmail, phone: t.grievancePhone, address: t.grievanceAddress } : null,
        responseDays: t?.grievanceSlaDays ?? null,
      },
    });
  })
);

/** PUT /api/v1/privacy/grievance-officer - set (or clear) the officer shown on the notice (administrators) */
router.put(
  '/grievance-officer',
  ...adminOnly,
  route('Failed to save the grievance officer', async (req, res) => {
    const b = parseBody(req, grievanceOfficerSchema);
    const tenantId = tenantIdOf(req);
    const t = await basePrisma.tenant.update({
      where: { id: tenantId },
      data: { grievanceName: b.name, grievanceEmail: b.email, grievancePhone: b.name ? b.phone ?? null : null, grievanceAddress: b.name ? b.address ?? null : null, grievanceSlaDays: b.responseDays ?? null },
      select: { name: true, grievanceName: true, grievanceEmail: true, grievancePhone: true, grievanceAddress: true, grievanceSlaDays: true },
    });
    await logAuditEvent({ tenantId, userId: req.user!.id, action: 'GRIEVANCE_OFFICER_SET', resourceType: 'TENANT', resourceId: tenantId, ...ctxOf(req), diffJson: { officer: t.grievanceName ? true : false, responseDays: t.grievanceSlaDays } });
    return res.json({
      data: {
        organisation: t.name,
        officer: t.grievanceName && t.grievanceEmail ? { name: t.grievanceName, email: t.grievanceEmail, phone: t.grievancePhone, address: t.grievanceAddress } : null,
        responseDays: t.grievanceSlaDays,
      },
    });
  })
);

// ---------------------------------------------------------------------------- children and guardians

/** GET /api/v1/privacy/me/minor - whether the caller is marked under 18 and whether a guardian has consented */
router.get('/me/minor', authenticateJWT, route('Failed to load the status', async (req, res) => res.json({ data: await minorStatus(tenantIdOf(req), req.user!.id) })));

/** PUT /api/v1/privacy/me/minor - declare yourself under 18 (cannot be undone by you) */
router.put(
  '/me/minor',
  authenticateJWT,
  route('Failed to save', async (req, res) => {
    const b = parseBody(req, setMinorSchema);
    return res.json({ data: await setMinor(tenantIdOf(req), req.user!.id, { id: req.user!.id, admin: false }, b, ctxOf(req)) });
  })
);

/** POST /api/v1/privacy/me/guardian-consent - e-mail your parent or guardian the consent link */
router.post(
  '/me/guardian-consent',
  authenticateJWT,
  route('Failed to ask the guardian', async (req, res) => {
    const { guardianEmail } = parseBody(req, guardianRequestSchema);
    return res.json({ data: await requestGuardianConsent(tenantIdOf(req), req.user!.id, guardianEmail, req.user!, ctxOf(req)) });
  })
);

/** GET /api/v1/privacy/users/:id/minor - a person's under-18 and guardian status (administrators) */
router.get(
  '/users/:id/minor',
  ...adminOnly,
  route('Failed to load the status', async (req, res) => res.json({ data: await minorStatus(tenantIdOf(req), idSchema.parse(String(req.params.id))) }))
);

/** PUT /api/v1/privacy/users/:id/minor - mark or clear a person as under 18 (administrators) */
router.put(
  '/users/:id/minor',
  ...adminOnly,
  route('Failed to save', async (req, res) => {
    const b = parseBody(req, setMinorSchema);
    const id = idSchema.parse(String(req.params.id));
    return res.json({ data: await setMinor(tenantIdOf(req), id, { id: req.user!.id, admin: isAdmin(req) }, b, ctxOf(req)) });
  })
);

/** POST /api/v1/privacy/users/:id/guardian-consent - e-mail a minor's guardian the consent link (administrators) */
router.post(
  '/users/:id/guardian-consent',
  ...adminOnly,
  route('Failed to ask the guardian', async (req, res) => {
    const { guardianEmail } = parseBody(req, guardianRequestSchema);
    const id = idSchema.parse(String(req.params.id));
    return res.json({ data: await requestGuardianConsent(tenantIdOf(req), id, guardianEmail, req.user!, ctxOf(req)) });
  })
);

/** GET /api/v1/privacy/guardian-consent?token= - public: what the guardian is asked to confirm (changes nothing) */
router.get(
  '/guardian-consent',
  publicLimiter,
  route('Failed to check the link', async (req, res) => {
    const { token } = parseQuery(req, guardianTokenSchema);
    return res.json({ data: await guardianConsentInfo(token) });
  })
);

/** POST /api/v1/privacy/guardian-consent - public: the guardian confirms; the link works once */
router.post(
  '/guardian-consent',
  publicLimiter,
  route('Failed to record consent', async (req, res) => {
    const { token } = parseBody(req, guardianTokenSchema);
    return res.json({ data: await confirmGuardianConsent(token, ctxOf(req)) });
  })
);

/** GET /api/v1/privacy/guardian-consent/withdraw?token= - public: what withdrawing consent means (changes nothing) */
router.get(
  '/guardian-consent/withdraw',
  publicLimiter,
  route('Failed to check the link', async (req, res) => {
    const { token } = parseQuery(req, guardianTokenSchema);
    return res.json({ data: await guardianWithdrawalInfo(token) });
  })
);

/** POST /api/v1/privacy/guardian-consent/withdraw - public: the guardian withdraws consent */
router.post(
  '/guardian-consent/withdraw',
  publicLimiter,
  route('Failed to withdraw consent', async (req, res) => {
    const { token } = parseBody(req, guardianTokenSchema);
    return res.json({ data: await withdrawGuardianConsent(token, ctxOf(req)) });
  })
);

export default router;
