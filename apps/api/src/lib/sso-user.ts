import { prisma } from './prisma';
import { withSeat } from './features';
import { HttpError } from './http';
import { logAuditEvent } from './audit';
import { dispatchWebhook } from './webhooks';

// Account matching shared by every single sign-on protocol (OIDC and SAML). By default SSO only signs in
// people who already exist in the tenant. An organisation can let it create a learner account at someone's
// first sign-in, but only for its own allowed e-mail domains and only from a trusted e-mail address.

export type SsoProvider = 'OIDC' | 'SAML';

export interface SsoIdentity {
  tenantId: string;
  provider: SsoProvider;
  /** The provider's stable identifier for the person, or null when it is not stable (transient SAML NameID). */
  subject: string | null;
  email?: string | null;
  /**
   * Whether the e-mail may be used to find an account the first time. OIDC passes the provider's
   * `email_verified`; SAML passes true, because the tenant administrator chose to trust that IdP.
   */
  emailTrusted: boolean;
  allowedDomains: string[];
  /** The connection's autoCreateAccounts setting; ignored unless allowedDomains is non-empty. */
  autoCreate?: boolean;
  /** Names from the provider, used only when an account is created. */
  firstName?: string | null;
  lastName?: string | null;
  /** For the audit entry of a created account. */
  ipAddress?: string;
  userAgent?: string;
}

export type SsoResolution =
  { ok: true; user: { id: string; email: string; role: string; tenantId: string }; created?: boolean } | { ok: false; reason: string };

/**
 * Maps a verified identity to a local account. A bound subject is authoritative. Otherwise the
 * account is found by trusted e-mail. An account already bound to a *different* identity from the
 * same provider is never rebound, but one provisioned by SCIM (which only carries the directory's
 * external id) or previously bound through the other protocol (the tenant changed IdP) may be.
 */
export async function resolveSsoUser(id: SsoIdentity): Promise<SsoResolution> {
  const email = id.email?.toLowerCase().trim() || undefined;

  if (id.allowedDomains.length > 0) {
    const domain = email?.split('@')[1];
    if (!domain || !id.allowedDomains.map((d) => d.toLowerCase()).includes(domain))
      return { ok: false, reason: 'email domain not allowed' };
  }

  let user = id.subject ? await prisma.user.findFirst({ where: { tenantId: id.tenantId, idpSubjectId: id.subject } }) : null;
  if (!user) {
    if (!email || !id.emailTrusted) return { ok: false, reason: 'no verified email' };
    user = await prisma.user.findFirst({ where: { tenantId: id.tenantId, email } });
    if (!user) {
      if (!id.autoCreate || id.allowedDomains.length === 0) return { ok: false, reason: 'no matching account' };
      return createSsoUser(id, email);
    }
    if (id.subject && user.idpSubjectId && user.idpSubjectId !== id.subject && user.idpProvider === id.provider) {
      return { ok: false, reason: 'account is bound to a different identity' };
    }
  }
  if (user.status !== 'ACTIVE') return { ok: false, reason: `account is ${user.status.toLowerCase()}` };
  if (user.lockedUntil && user.lockedUntil > new Date()) return { ok: false, reason: 'account locked' };

  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      failedLoginCount: 0,
      emailVerified: true,
      // A transient identifier is not stored: it would differ on the next sign-in.
      ...(id.subject ? { idpProvider: id.provider, idpSubjectId: id.subject } : {}),
    },
  });
  return { ok: true, user };
}

/** Given and family name from the provider, or a full name split at its last space. */
export function splitName(
  given?: string | null,
  family?: string | null,
  full?: string | null
): { firstName: string | null; lastName: string | null } {
  if (given?.trim() || family?.trim()) return { firstName: given?.trim() || null, lastName: family?.trim() || null };
  const parts = full?.trim().split(/\s+/) ?? [];
  if (parts.length === 0 || !parts[0]) return { firstName: null, lastName: null };
  return parts.length === 1
    ? { firstName: parts[0], lastName: null }
    : { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

const clean = (v: string | null | undefined, max = 100) => v?.replace(/\s+/g, ' ').trim().slice(0, max) || null;

/** First sign-in of someone from an allowed domain: a learner account, bound to this identity. */
async function createSsoUser(id: SsoIdentity, email: string): Promise<SsoResolution> {
  let user;
  try {
    // The seat check and the insert are one transaction, so two first sign-ins cannot both take the last seat.
    user = await withSeat(id.tenantId, (tx) =>
      tx.user.create({
        data: {
          tenantId: id.tenantId,
          email,
          firstName: clean(id.firstName) ?? email.split('@')[0].slice(0, 100),
          lastName: clean(id.lastName) ?? '-',
          role: 'STUDENT', // staff are promoted by an administrator
          status: 'ACTIVE',
          passwordHash: null, // signs in through the identity provider
          emailVerified: true,
          lastLoginAt: new Date(),
          ...(id.subject ? { idpProvider: id.provider, idpSubjectId: id.subject } : {}),
        },
      })
    );
  } catch (err: any) {
    if (err instanceof HttpError && err.status === 409) return { ok: false, reason: 'no seats left' };
    // Two first sign-ins at once: the other one created the account, so sign in as it.
    if (err?.code === 'P2002') return resolveSsoUser({ ...id, autoCreate: false });
    throw err;
  }
  await logAuditEvent({
    tenantId: id.tenantId,
    userId: user.id,
    action: 'SSO_USER_CREATED',
    resourceType: 'USER',
    resourceId: user.id,
    ipAddress: id.ipAddress,
    userAgent: id.userAgent,
    diffJson: { provider: id.provider, email },
  });
  void dispatchWebhook(id.tenantId, 'user.provisioned', { userId: user.id, email });
  return { ok: true, user, created: true };
}
