import crypto from 'crypto';
import { z } from 'zod';
import { runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma, prisma, runInTenantTransaction } from './prisma';
import { HttpError } from './http';
import { logAuditEvent } from './audit';
import { logger } from './logger';
import { mailDelivers, sendMail } from './mailer';
import { InvitationResult, sendInvitation } from './invitations';
import { platformSubdomainLabels } from './platform-hosts';
import { tenantUrl } from './tenant-url';
import { newDomainToken } from './custom-domain';
import { initialTrial } from './trial';

// Creating organisations (tenants): from an approved registration request or directly by the platform
// operator. Both make the tenant and its first administrator, who gets an invitation to choose a password.

/**
 * 3-40 characters: lowercase letters, digits and hyphens, starting and ending with a letter or digit. Hyphens in
 * both the third and fourth place are refused: DNS keeps those labels for encodings, and "xn--" ones are
 * punycode, which browsers show as look-alike Unicode names.
 */
export const ORG_SLUG = /^(?![a-z0-9]{2}--)[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const orgSlugSchema = z.string().trim().toLowerCase().regex(ORG_SLUG, 'Use 3-40 lowercase letters, digits and hyphens, starting and ending with a letter or digit (and not "--" as the third and fourth characters)');

/** Addresses no organisation may have: service, mail and infrastructure names, and the platform's own pages. */
const RESERVED = [
  'www', 'api', 'app', 'admin', 'platform', 'operator', 'register', 'default-tenant',
  'auth', 'sso', 'id', 'login', 'logout', 'signup', 'account', 'accounts', 'oauth', 'saml', 'scim', 'lti',
  'cdn', 'static', 'assets', 'files', 'media', 'content', 'scorm', 'uploads', 'storage', 'livekit',
  'dev', 'staging', 'test', 'demo', 'beta', 'preview', 'sandbox', 'localhost', 'm', 'mobile',
  'mail', 'email', 'smtp', 'imap', 'pop', 'pop3', 'webmail', 'mx', 'autodiscover', 'autoconfig', 'ns', 'ns1', 'ns2', 'ns3', 'ns4', 'dns',
  'billing', 'security', 'status', 'help', 'support', 'docs', 'blog', 'abuse', 'postmaster', 'hostmaster', 'webmaster', 'root',
];

/** The configured service hosts under TENANT_BASE_DOMAIN (e.g. the SCORM content or API host), fixed at startup. */
const RESERVED_HOST_LABELS = platformSubdomainLabels();

export const isReservedSlug = (slug: string) =>
  RESERVED.includes(slug) || RESERVED_HOST_LABELS.includes(slug) || slug === config.PLATFORM_OPERATOR_TENANT || slug === config.DEFAULT_TENANT_SLUG;

export type SlugProblem = 'invalid' | 'reserved' | 'taken' | 'pending';

/** How long an applicant has to confirm their e-mail; an unconfirmed request holds its slug this long. */
export const VERIFY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** How long a confirmed request waiting for a decision holds its slug. Afterwards it is shown as expired. */
export const PENDING_HOLD_MS = 30 * 24 * 60 * 60 * 1000;
/** Open (unconfirmed or waiting) requests one e-mail address may have at a time. */
export const MAX_OPEN_REQUESTS_PER_EMAIL = 3;

/** Requests whose hold on their slug has not lapsed. */
export const holdingNow = () => ({ holdsSlug: true, holdExpiresAt: { gt: new Date() } });

/**
 * Why a slug cannot be used for a new organisation, or null when it is free. `allowPending` (the operator
 * creating an organisation directly) may take a slug that only a request holds.
 */
export async function slugProblem(slug: string, opts: { ignoreRequestId?: string; allowPending?: boolean } = {}): Promise<SlugProblem | null> {
  if (!ORG_SLUG.test(slug)) return 'invalid';
  if (isReservedSlug(slug)) return 'reserved';
  if (await basePrisma.tenant.findUnique({ where: { slug }, select: { id: true } })) return 'taken';
  // A deleted organisation's address stays reserved for ORG_DELETED_SLUG_HOLD_DAYS (lib/offboarding.ts), for everyone.
  if (await basePrisma.tenantDeletion.findFirst({ where: { slug, slugHeldUntil: { gt: new Date() } }, select: { id: true } })) return 'taken';
  if (opts.allowPending) return null;
  const pending = await basePrisma.organizationRequest.findFirst({
    where: { slug, ...holdingNow(), ...(opts.ignoreRequestId ? { NOT: { id: opts.ignoreRequestId } } : {}) },
    select: { id: true },
  });
  return pending ? 'pending' : null;
}

/** Lets go of holds that have lapsed on this slug, so a new request can take it (the unique index allows one holder). */
export const releaseLapsedHolds = (slug: string) =>
  basePrisma.organizationRequest.updateMany({ where: { slug, holdsSlug: true, holdExpiresAt: { lte: new Date() } }, data: { holdsSlug: false } });

/** Requests this e-mail address has open: unconfirmed with a live link, or waiting for a decision and not expired. */
export const openRequestsFor = (contactEmail: string) => {
  const now = new Date();
  return basePrisma.organizationRequest.count({
    where: {
      contactEmail,
      OR: [
        { status: 'UNVERIFIED', verificationExpiresAt: { gt: now } },
        { status: 'PENDING', holdExpiresAt: { gt: now } },
      ],
    },
  });
};

/** The address an organisation with this slug would have, as people see it: "st-marys.example.com". */
export const requestedAddress = (slug: string) => new URL(tenantUrl({ slug })).host;

export const SUPERSEDED_NOTE = 'The address was given to another organisation.';

/**
 * Closes the open requests for a slug an organisation now has (except `exceptId`, the one being approved).
 * Applicants who confirmed their e-mail are told; unconfirmed addresses are never mailed again.
 */
export async function supersedeRequests(slug: string, exceptId?: string): Promise<void> {
  const open = await basePrisma.organizationRequest.findMany({
    where: { slug, status: { in: ['UNVERIFIED', 'PENDING'] }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true, status: true, contactEmail: true, contactFirstName: true },
  });
  for (const r of open) {
    const closed = await basePrisma.organizationRequest.updateMany({
      where: { id: r.id, status: r.status },
      data: { status: 'REJECTED', holdsSlug: false, decidedAt: new Date(), decisionNote: SUPERSEDED_NOTE },
    });
    if (closed.count === 1 && r.status === 'PENDING') {
      await mailApplicant(
        r.contactEmail,
        'Your organisation request',
        `Hello ${r.contactFirstName},\n\nThe web address you asked for, ${requestedAddress(slug)}, has been given to another organisation, so your request has been closed. You are welcome to send a new request with a different address.`
      );
    }
  }
}

export const SLUG_PROBLEM_MESSAGE: Record<SlugProblem, string> = {
  invalid: 'That address is not valid',
  reserved: 'That address is reserved',
  taken: 'That address is already taken',
  pending: 'Someone has already asked for that address',
};

export interface NewOrganization {
  name: string;
  slug: string;
  tier: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  /** null: no seat limit. */
  seatQuota: number | null;
  /** Waits for DNS verification (lib/custom-domain.ts); it is not live until then. */
  customDomain?: string | null;
  admin: { email: string; firstName: string; lastName: string };
  /** A free trial of this many days (lib/trial.ts); 0 or unset: active (paid) from the start. */
  trialDays?: number;
}

export interface Actor {
  tenantId: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Creates an organisation (active, or on a trial of `trialDays`) and its first administrator (INVITED), then sends the invitation. The
 * tenant and the account are created together, so a failure leaves neither. 409 when the slug or domain is
 * taken. `requestId` is the request being approved: it keeps its own slug and is linked to the organisation
 * in the same transaction. The operator creating directly may take a slug only requests hold; those
 * requests are closed. A custom domain starts out waiting for verification. Once the transaction has committed this does not throw: invitation and audit
 * problems are logged (and reported in `invitation`).
 */
export async function createOrganization(input: NewOrganization, actor: Actor, opts: { requestId?: string; via: 'REQUEST' | 'OPERATOR' }) {
  const problem = await slugProblem(input.slug, { ignoreRequestId: opts.requestId, allowPending: opts.via === 'OPERATOR' });
  if (problem) throw new HttpError(problem === 'invalid' ? 400 : 409, SLUG_PROBLEM_MESSAGE[problem]);
  if (input.customDomain && (await basePrisma.tenant.findFirst({ where: { OR: [{ customDomain: input.customDomain }, { pendingCustomDomain: input.customDomain }] }, select: { id: true } }))) {
    throw new HttpError(409, 'That domain is already used by another organisation');
  }

  const id = crypto.randomUUID();
  const email = input.admin.email.toLowerCase().trim();
  let created;
  try {
    created = await runInTenantTransaction(id, async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          id, slug: input.slug, name: input.name, tier: input.tier, ...initialTrial(input.trialDays ?? 0), seatQuota: input.seatQuota, setupChecklist: true,
          ...(input.customDomain ? { pendingCustomDomain: input.customDomain, customDomainToken: newDomainToken(), customDomainRequestedAt: new Date() } : {}),
        },
        select: {
          id: true, slug: true, name: true, tier: true, status: true, seatQuota: true, featureFlags: true, customDomain: true, pendingCustomDomain: true,
          customDomainFailingSince: true, trialEndsAt: true, trialExpiredAt: true,
        },
      });
      const admin = await tx.user.create({
        data: { tenantId: id, email, firstName: input.admin.firstName, lastName: input.admin.lastName, role: 'TENANT_ADMIN', status: 'INVITED', passwordHash: null, emailVerified: false },
        select: { id: true, email: true, firstName: true, tenantId: true },
      });
      if (opts.requestId) {
        // The request is linked here, so it can never look undecided while its organisation exists.
        const linked = await tx.organizationRequest.updateMany({
          where: { id: opts.requestId, status: 'APPROVED', createdTenantId: null },
          data: { createdTenantId: id, holdsSlug: false },
        });
        if (linked.count !== 1) throw new HttpError(409, 'This request has already been decided');
      }
      return { tenant, admin };
    });
  } catch (err: any) {
    if (err?.code === 'P2002') throw new HttpError(409, 'That address or domain is already taken');
    throw err;
  }

  // The organisation exists from here on: nothing below may undo or hide that.
  const afterCommit = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      logger.error({ err, tenantId: id }, `organisation created, but ${what} failed`);
    }
  };
  const invitation: InvitationResult = await runWithTenant(id, () => sendInvitation(created.admin, { newOrganization: input.name })).catch((err) => {
    logger.error({ err, tenantId: id }, 'organisation created, but the invitation failed');
    return 'failed' as const;
  });
  await afterCommit('closing other requests for its address', () => supersedeRequests(input.slug, opts.requestId));
  const entry = {
    action: 'ORGANIZATION_CREATED',
    resourceType: 'TENANT',
    resourceId: id,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    diffJson: { slug: input.slug, name: input.name, tier: input.tier, seatQuota: input.seatQuota, pendingCustomDomain: input.customDomain ?? null, adminEmail: email, via: opts.via, invitation, trialEndsAt: created.tenant.trialEndsAt?.toISOString() ?? null },
  };
  await afterCommit('the audit entry', () => runWithTenant(actor.tenantId, () => logAuditEvent({ ...entry, tenantId: actor.tenantId, userId: actor.userId })));
  await afterCommit('the audit entry', () => runWithTenant(id, () => logAuditEvent({ ...entry, tenantId: id, userId: undefined })));
  return { tenant: created.tenant, adminId: created.admin.id, invitation };
}

/** The platform operator's own organisation, when one is configured and exists. */
export async function operatorTenant() {
  if (!config.PLATFORM_OPERATOR_TENANT) return null;
  return basePrisma.tenant.findUnique({ where: { slug: config.PLATFORM_OPERATOR_TENANT }, select: { id: true, slug: true } });
}

/** Mails the applicant; mail problems are logged, never fatal (the request itself is what matters). */
export async function mailApplicant(to: string, subject: string, text: string): Promise<void> {
  if (!mailDelivers()) return;
  try {
    await sendMail({ to, subject, text });
  } catch (err) {
    logger.warn({ err }, 'could not e-mail an organisation applicant');
  }
}

/** Active super administrators of the operator organisation, to be told about new requests. */
export async function operatorUserIds(tenantId: string): Promise<string[]> {
  const users = await runWithTenant(tenantId, () =>
    prisma.user.findMany({ where: { tenantId, role: 'SUPER_ADMIN', status: 'ACTIVE' }, select: { id: true } })
  );
  return users.map((u) => u.id);
}
