import { config } from '../config';

// The host names this deployment answers on itself (web app, API, SCORM content, media and file servers), and
// how they relate to TENANT_BASE_DOMAIN. No organisation may take one of them as its address or custom domain.

const hostOf = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
};

/** TENANT_BASE_DOMAIN without its port, or null when organisations have no subdomains. */
export const baseDomainHost = (): string | null => config.TENANT_BASE_DOMAIN?.split(':')[0] ?? null;

/** True for the base domain itself and for any host below it. */
export function isUnderBaseDomain(host: string): boolean {
  const base = baseDomainHost();
  return !!base && (host === base || host.endsWith(`.${base}`));
}

/** Host names of the configured service URLs. */
export function platformHostnames(): string[] {
  const urls = [
    config.APP_URL,
    config.API_PUBLIC_URL,
    config.SCORM_CONTENT_ORIGIN,
    config.LIVEKIT_URL,
    config.S3_ENDPOINT,
    ...config.corsOrigins,
  ];
  // CUSTOM_DOMAIN_TARGET is a bare host name (the CNAME target for custom domains), not a URL.
  const target = config.CUSTOM_DOMAIN_TARGET?.toLowerCase().replace(/\.$/, '') || null;
  return [...new Set([...urls.map(hostOf), target].filter((h): h is string => !!h))];
}

/**
 * Labels that would make `<label>.<base>` one of the platform's own hosts, or a parent of one: for
 * content.lms.example.com under lms.example.com, "content"; for media.eu.lms.example.com, "eu".
 */
export function platformSubdomainLabels(): string[] {
  const base = baseDomainHost();
  if (!base) return [];
  return platformHostnames()
    .filter((h) => h.endsWith(`.${base}`))
    .map((h) =>
      h
        .slice(0, -(base.length + 1))
        .split('.')
        .pop()!
    )
    .filter(Boolean);
}

/**
 * Strict-Transport-Security value for a request host. includeSubDomains only on the platform's own hosts: a
 * customer's own domain is theirs, and pinning its other subdomains to HTTPS is not ours to decide. No preload
 * anywhere (one-way door; the proxy policy in deploy/Caddyfile says the same).
 */
export function hstsHeaderFor(hostname: string): string {
  const host = hostname.toLowerCase();
  const own = isUnderBaseDomain(host) || platformHostnames().includes(host);
  return own ? 'max-age=31536000; includeSubDomains' : 'max-age=31536000';
}
