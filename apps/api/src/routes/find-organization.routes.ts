import { Router } from 'express';
import rateLimit, { MemoryStore, type Options, type Store } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { basePrisma } from '../lib/prisma';
import { route } from '../lib/http';
import { parseBody } from '../lib/validate';
import { logger } from '../lib/logger';
import { sendMail } from '../lib/mailer';
import { rateLimitStore } from '../lib/rate-limit-store';
import { tenantUrl } from '../lib/tenant-url';
import { requireCaptcha } from '../lib/captcha';

// Mounted at /api/v1/organizations. Public: on the platform's bare address nobody can tell which organisation
// they belong to, so a visitor gives their e-mail address and is e-mailed the sign-in links of the
// organisations where it has an account. The answer is always the same, so the endpoint reveals nothing.

const router = Router();

const WINDOW_MS = 60 * 60 * 1000;
/** Lookups one e-mail address may ask for per hour; beyond that no more mail is sent to it. */
export const MAX_FIND_MAILS_PER_EMAIL = 3;
/** Organisations listed in one e-mail. */
export const MAX_FIND_RESULTS = 20;

const ipLimiter = rateLimit({
  store: rateLimitStore('org-find'),
  passOnStoreError: true,
  windowMs: WINDOW_MS,
  limit: config.FIND_ORG_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again later.' },
});

/** Counts lookups per e-mail address (shared through Redis like the limiters). Over the limit the answer stays the same; only the mail is skipped. */
const perEmail: Store = rateLimitStore('org-find-email') ?? new MemoryStore();
void perEmail.init?.({ windowMs: WINDOW_MS } as Options);

async function withinEmailLimit(email: string): Promise<boolean> {
  try {
    return (await perEmail.increment(email)).totalHits <= MAX_FIND_MAILS_PER_EMAIL;
  } catch (err) {
    logger.warn({ err }, 'could not count organisation lookups for an e-mail address');
    return true; // like passOnStoreError: the per-IP limit still applies
  }
}

export const findOrganizationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  /** The Turnstile token, when the CAPTCHA is on (see lib/captcha.ts). */
  captchaToken: z.string().max(2048).optional(),
});

export const FIND_ORGANIZATION_CAPTCHA_ACTION = 'find-organisation';

const ACCEPTED = { message: 'If this e-mail address has an account with any organisation, we have sent it a list of where to sign in.' };

/**
 * The organisations (that people can use) where this address has an active or invited account. Users are
 * tenant-scoped under RLS, so the lookup across organisations is the database function find_tenants_for_email
 * (migration 20261103000004_find_tenants_function), which returns organisation ids and nothing else; which of
 * those organisations count is decided here.
 */
async function organisationsFor(email: string) {
  const rows = await basePrisma.$queryRaw<{ tenant_id: string }[]>`SELECT tenant_id FROM find_tenants_for_email(${email})`;
  if (!rows.length) return [];
  return basePrisma.tenant.findMany({
    where: {
      id: { in: rows.map((r) => r.tenant_id) },
      status: { in: ['ACTIVE', 'TRIAL'] },
      ...(config.PLATFORM_OPERATOR_TENANT ? { NOT: { slug: config.PLATFORM_OPERATOR_TENANT } } : {}),
    },
    select: { id: true, slug: true, name: true, customDomain: true },
    orderBy: { name: 'asc' },
    take: MAX_FIND_RESULTS,
  });
}

const mailText = (orgs: { name: string; slug: string; customDomain: string | null }[]) =>
  `Hello,\n\nSomeone, hopefully you, asked which organisations on the learning platform this e-mail address can sign in to. It has an account with:\n\n${orgs
    .map((o) => `${o.name}\n${tenantUrl(o)}/login`)
    .join(
      '\n\n'
    )}\n\nEach organisation has its own web address: bookmark yours to sign in directly next time.\n\nIf you did not ask for this, you can ignore this e-mail.`;

/**
 * POST /api/v1/organizations/find: e-mails the address the sign-in links of its organisations. Always 202
 * with the same body; nothing is sent when the address has no accounts, or has asked too often.
 */
router.post(
  '/find',
  ipLimiter,
  // Before any lookup or mail: the per-address limit stops floods at one inbox, the CAPTCHA scripted sweeps.
  requireCaptcha(FIND_ORGANIZATION_CAPTCHA_ACTION),
  route('Failed to look up organisations', async (req, res) => {
    const { email } = parseBody(req, findOrganizationSchema);
    const orgs = (await withinEmailLimit(email)) ? await organisationsFor(email) : [];
    if (orgs.length) {
      // Not awaited: how long delivery takes would tell whether the address has accounts.
      sendMail({ to: email, subject: 'Your organisations on the learning platform', text: mailText(orgs) }).catch((err) =>
        logger.warn({ err }, 'could not e-mail an organisation lookup')
      );
    }
    return res.status(202).json(ACCEPTED);
  })
);

export default router;
