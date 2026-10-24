import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { SAML, generateServiceProviderMetadata, Profile, ValidateInResponseTo } from '@node-saml/node-saml';
import { config } from '../config';
import { assertSafeWebhookUrl as assertSafeUrl } from './webhooks';
import { splitName } from './sso-user';
import { cookieName } from './cookie-name';

// SAML 2.0 web-browser SSO as a service provider. XML signature and condition checking is done by
// @node-saml/node-saml; this file adds the parts it leaves to the application:
//  * the response must answer the AuthnRequest this browser started (InResponseTo is bound to a
//    signed, short-lived cookie), so unsolicited / IdP-initiated and replayed responses are refused
//    without needing a shared cache, which would not work across several API servers;
//  * the IdP's signing key is pinned per tenant and the audience is the tenant's own entity id, so a
//    response issued for another tenant or another service provider is rejected.

export class SamlError extends Error {}

const FLOW_AUDIENCE = 'saml-flow';
export const SAML_FLOW_COOKIE = cookieName('lms_saml');
const CLOCK_SKEW_MS = 60_000;
const MAX_ASSERTION_AGE_MS = 10 * 60_000;

export interface SamlConn {
  entryPoint: string;
  idpIssuer: string;
  idpCert: string;
  emailAttribute: string;
}

/** Entity id the tenant's IdP should address assertions to. Unique per tenant even on a shared origin. */
export const spEntityId = (origin: string, slug: string) => `${origin}/api/v1/auth/saml/metadata/${encodeURIComponent(slug)}`;
export const acsUrl = (origin: string) => `${origin}/api/v1/auth/saml/acs`;

export function samlFor(conn: SamlConn, origin: string, slug: string, requestId?: string): SAML {
  assertSafeUrl(conn.entryPoint);
  return new SAML({
    entryPoint: conn.entryPoint,
    idpIssuer: conn.idpIssuer,
    idpCert: conn.idpCert,
    issuer: spEntityId(origin, slug),
    callbackUrl: acsUrl(origin),
    audience: spEntityId(origin, slug),
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    acceptedClockSkewMs: CLOCK_SKEW_MS,
    maxAssertionAgeMs: MAX_ASSERTION_AGE_MS,
    signatureAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
    disableRequestedAuthnContext: true,
    identifierFormat: null,
    // The library's request-id cache is per process; the flow cookie below does this job instead.
    validateInResponseTo: ValidateInResponseTo.never,
    ...(requestId ? { generateUniqueId: () => requestId } : {}),
  });
}

export const newRequestId = () => `_${crypto.randomBytes(20).toString('hex')}`;

export interface SamlFlow {
  tenantId: string;
  requestId: string;
  /** Origin the flow started on; the response must come back to it. */
  origin: string;
}

export const signSamlFlow = (f: SamlFlow) =>
  jwt.sign(f, config.JWT_SECRET, { algorithm: 'HS256', audience: FLOW_AUDIENCE, expiresIn: '10m' });

export function readSamlFlow(token: string | undefined): SamlFlow | null {
  if (!token) return null;
  try {
    const d = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'], audience: FLOW_AUDIENCE }) as any;
    return d.tenantId && d.requestId && d.origin ? { tenantId: d.tenantId, requestId: d.requestId, origin: d.origin } : null;
  } catch {
    return null;
  }
}

export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Validates and normalises what an administrator pastes as the IdP's signing key: a certificate
 * (checked for validity dates) or a public key. A private key is refused outright.
 */
export function parseIdpKey(input: string): {
  pem: string;
  kind: 'CERTIFICATE' | 'PUBLIC KEY';
  fingerprint: string;
  notAfter: Date | null;
} {
  const raw = input.trim();
  if (/PRIVATE KEY/.test(raw)) throw new SamlError("That is a private key. Paste the IdP's public certificate instead.");

  const pemOf = (label: string, b64: string) =>
    `-----BEGIN ${label}-----\n${b64
      .replace(/\s+/g, '')
      .replace(/(.{64})/g, '$1\n')
      .trim()}\n-----END ${label}-----`;
  try {
    if (/BEGIN PUBLIC KEY/.test(raw)) {
      const key = crypto.createPublicKey(raw);
      const der = key.export({ type: 'spki', format: 'der' });
      return { pem: raw, kind: 'PUBLIC KEY', fingerprint: crypto.createHash('sha256').update(der).digest('hex'), notAfter: null };
    }
    const pem = /BEGIN CERTIFICATE/.test(raw) ? raw : pemOf('CERTIFICATE', raw); // bare base64 is what IdP metadata contains
    const cert = new crypto.X509Certificate(pem);
    const now = Date.now();
    if (new Date(cert.validTo).getTime() < now) throw new SamlError('That certificate has expired.');
    if (new Date(cert.validFrom).getTime() > now + 86_400_000) throw new SamlError('That certificate is not valid yet.');
    return { pem, kind: 'CERTIFICATE', fingerprint: cert.fingerprint256.replace(/:/g, '').toLowerCase(), notAfter: new Date(cert.validTo) };
  } catch (e) {
    if (e instanceof SamlError) throw e;
    throw new SamlError('Could not read that certificate or public key.');
  }
}

export const DEFAULT_EMAIL_ATTRIBUTE = 'email';

/**
 * The person's e-mail. With the default configuration the usual aliases ("email", "mail") and an
 * e-mail-format NameID are accepted. Once an administrator names a specific attribute, only that
 * attribute is used: guessing at other fields could pick up a value the IdP never meant as the
 * login address.
 */
export function emailFromProfile(profile: Profile, attribute: string): string | null {
  const bag = profile as unknown as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null);
  if (attribute !== DEFAULT_EMAIL_ATTRIBUTE) return pick(bag[attribute])?.trim() || null;
  const direct = pick(bag.email) ?? pick(bag.mail);
  if (direct) return direct.trim();
  return /emailAddress$/i.test(profile.nameIDFormat ?? '') ? profile.nameID : null;
}

/** First StatusCode of the Response, which must be Success. The response wrapper itself is unsigned. */
export function responseSucceeded(samlResponseBase64: string): boolean {
  let xml: string;
  try {
    xml = Buffer.from(samlResponseBase64, 'base64').toString('utf8');
  } catch {
    return false;
  }
  const m = /<(?:[\w-]+:)?StatusCode\b[^>]*\bValue="([^"]+)"/.exec(xml);
  return !!m && m[1] === 'urn:oasis:names:tc:SAML:2.0:status:Success';
}

/**
 * Stable identifier to bind to the account, or null when the IdP issues a different one each time
 * (a transient NameID), in which case the account is found by e-mail on every sign-in.
 */
// Name attributes as Azure AD / Entra, Okta, Google, Shibboleth (eduPerson OIDs) and ADFS send them.
const GIVEN_NAME = [
  'givenName',
  'firstName',
  'given_name',
  'urn:oid:2.5.4.42',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
];
const SURNAME = [
  'sn',
  'surname',
  'lastName',
  'family_name',
  'urn:oid:2.5.4.4',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
];
const DISPLAY_NAME = [
  'displayName',
  'cn',
  'name',
  'urn:oid:2.16.840.1.113730.3.1.241',
  'http://schemas.microsoft.com/identity/claims/displayname',
];

/** The person's names from the assertion's attributes, for an account created at first sign-in. */
export function namesFromProfile(profile: Profile): { firstName: string | null; lastName: string | null } {
  const bag = profile as unknown as Record<string, unknown>;
  const pick = (keys: string[]) => {
    for (const k of keys) {
      const v = bag[k];
      const s = typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null;
      if (s?.trim()) return s.trim();
    }
    return null;
  };
  return splitName(pick(GIVEN_NAME), pick(SURNAME), pick(DISPLAY_NAME));
}

export function subjectFromProfile(profile: Profile, idpIssuer: string): string | null {
  if (!profile.nameID || /:transient$/i.test(profile.nameIDFormat ?? '')) return null;
  const subject = `saml:${idpIssuer}|${profile.nameID}`;
  return subject.length <= 255 ? subject : null;
}

export function metadataXml(origin: string, slug: string): string {
  return generateServiceProviderMetadata({
    issuer: spEntityId(origin, slug),
    callbackUrl: acsUrl(origin),
    wantAssertionsSigned: true,
    identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  });
}
