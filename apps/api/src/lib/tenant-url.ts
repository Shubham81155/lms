import { config } from '../config';

// The address an organisation is used at. Every organisation has its own: its custom domain when it has one,
// otherwise `<slug>.<TENANT_BASE_DOMAIN>`. Without TENANT_BASE_DOMAIN (a single-organisation install) it is
// APP_URL. Links in e-mails and responses use this, so people always land on their own organisation.

export interface TenantAddress {
  slug: string;
  customDomain?: string | null;
}

/** https in production; elsewhere APP_URL's scheme, so local http setups work. */
export const tenantScheme = () => (config.NODE_ENV === 'production' ? 'https:' : new URL(config.APP_URL).protocol);

/** The origin of the organisation's subdomain, or null without TENANT_BASE_DOMAIN. */
export function subdomainOrigin(slug: string): string | null {
  const base = config.TENANT_BASE_DOMAIN;
  return base ? `${tenantScheme()}//${slug.toLowerCase()}.${base}` : null;
}

export function tenantUrl(t: TenantAddress): string {
  if (t.customDomain) return `${tenantScheme()}//${t.customDomain.toLowerCase()}`;
  return subdomainOrigin(t.slug) ?? new URL(config.APP_URL).origin;
}
