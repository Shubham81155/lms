import { prisma } from './prisma';
import { tenantIsBlocked } from './session';

export interface ResolvedTenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  customDomain: string | null;
}

/**
 * Resolves an unauthenticated tenant hint to a tenant row. Hints are tried in priority order
 * (explicit header, then host / custom domain, then subdomain, then the configured default);
 * each may be a tenant id, slug or custom domain. Suspended and archived tenants never resolve.
 * The result's `id` is the only tenant identifier the rest of the system uses.
 */
export async function resolveTenant(hints: string[] | undefined): Promise<ResolvedTenant | null> {
  const tenant = await lookupTenant(hints);
  return tenant && !tenantIsBlocked(tenant.status) ? tenant : null;
}

/** The tenant the hints name, whatever its status; only for telling people why they cannot sign in. */
export async function lookupTenant(hints: string[] | undefined): Promise<ResolvedTenant | null> {
  for (const hint of hints ?? []) {
    if (!hint) continue;
    const tenant = await prisma.tenant.findFirst({
      where: { OR: [{ id: hint }, { slug: hint }, { customDomain: hint }] },
      select: { id: true, slug: true, name: true, status: true, customDomain: true },
    });
    if (tenant) return tenant;
  }
  return null;
}

