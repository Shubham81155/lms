import { config } from '../config';

// Which origin an SSO round trip should use. A tenant can be served from the platform's own address
// (APP_URL) or from its custom domain, and the identity provider must send the browser back to the
// same host that started the flow: the flow cookie is host-only and the redirect URI sent in the
// token exchange must match the one sent to the authorisation endpoint.
//
// The request's Host is never trusted blindly. It only selects among the origins this tenant is
// entitled to, so a forged Host (or another tenant's domain) falls back to APP_URL and can never
// steer a sign-in, or its redirect, to an arbitrary site.

const CALLBACK_PATH = '/api/v1/auth/sso/callback';

export interface TenantDomain {
  customDomain: string | null;
}

export const appOrigin = () => new URL(config.APP_URL).origin;

/** The platform address first, then the tenant's custom domain when it has one. */
export function allowedOrigins(tenant: TenantDomain): string[] {
  const app = new URL(config.APP_URL);
  const origins = [app.origin];
  if (tenant.customDomain) {
    // Production custom domains are always https; elsewhere follow APP_URL so local setups work.
    const scheme = config.NODE_ENV === 'production' ? 'https:' : app.protocol;
    origins.push(`${scheme}//${tenant.customDomain.toLowerCase()}`);
  }
  return origins;
}

/** `publicHost` is the request's host (with port, if any), as resolved by the tenant resolver. */
export function originFor(tenant: TenantDomain, publicHost?: string): string {
  const host = publicHost?.trim().toLowerCase();
  const match = host ? allowedOrigins(tenant).find((o) => new URL(o).host === host) : undefined;
  return match ?? appOrigin();
}

export const callbackUri = (origin: string) => `${origin}${CALLBACK_PATH}`;

/** Every redirect URI an administrator must register at the identity provider. */
export const redirectUrisFor = (tenant: TenantDomain) => allowedOrigins(tenant).map(callbackUri);
