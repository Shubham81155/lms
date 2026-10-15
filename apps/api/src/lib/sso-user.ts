import { prisma } from './prisma';

// Account matching shared by every single sign-on protocol (OIDC and SAML). SSO never creates
// accounts; it only signs in people who already exist in the tenant.

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
}

export type SsoResolution =
  | { ok: true; user: { id: string; email: string; role: string; tenantId: string } }
  | { ok: false; reason: string };

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
    if (!domain || !id.allowedDomains.map((d) => d.toLowerCase()).includes(domain)) return { ok: false, reason: 'email domain not allowed' };
  }

  let user = id.subject ? await prisma.user.findFirst({ where: { tenantId: id.tenantId, idpSubjectId: id.subject } }) : null;
  if (!user) {
    if (!email || !id.emailTrusted) return { ok: false, reason: 'no verified email' };
    user = await prisma.user.findFirst({ where: { tenantId: id.tenantId, email } });
    if (!user) return { ok: false, reason: 'no matching account' };
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
