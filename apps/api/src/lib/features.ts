import { prisma } from './prisma';
import { HttpError } from './http';

export const FEATURE_KEYS = ['lti13', 'sso', 'webhooks', 'scim', 'aiAssistant'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureFlags = Record<FeatureKey, boolean>;

const BASE: FeatureFlags = { lti13: false, sso: false, webhooks: false, scim: false, aiAssistant: false };

/** What each plan includes before a tenant admin toggles anything. */
export const TIER_DEFAULTS: Record<string, FeatureFlags> = {
  STARTER: BASE,
  PROFESSIONAL: { ...BASE, lti13: true, webhooks: true, aiAssistant: true },
  ENTERPRISE: { lti13: true, sso: true, webhooks: true, scim: true, aiAssistant: true },
};

/** Stored overrides win over the tier default; unknown keys in storage are ignored. */
export function resolveFeatures(tier: string, stored: unknown): FeatureFlags {
  const out = { ...(TIER_DEFAULTS[tier] ?? BASE) };
  if (stored && typeof stored === 'object') {
    for (const k of FEATURE_KEYS) {
      const v = (stored as Record<string, unknown>)[k];
      if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

export async function tenantFeatures(tenantId: string): Promise<FeatureFlags> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { tier: true, featureFlags: true } });
  return resolveFeatures(t?.tier ?? 'STARTER', t?.featureFlags);
}

export async function requireFeature(tenantId: string, key: FeatureKey): Promise<void> {
  if (!(await tenantFeatures(tenantId))[key]) {
    throw new HttpError(403, `The "${key}" feature is not enabled for this organisation`);
  }
}

/** Throws 409 when the tenant has a seat quota and every seat is taken by an active/invited user. */
export async function assertSeatAvailable(tenantId: string): Promise<void> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { seatQuota: true } });
  if (t?.seatQuota == null) return;
  const used = await prisma.user.count({ where: { tenantId, status: { in: ['ACTIVE', 'INVITED'] } } });
  if (used >= t.seatQuota) throw new HttpError(409, `Seat quota of ${t.seatQuota} reached`);
}
