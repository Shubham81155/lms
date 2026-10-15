import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { assertSafeWebhookUrl as assertSafeUrl } from './webhooks';

// OpenID Connect authorization-code flow with PKCE, as a relying party. Only what a login needs:
// discovery, the code exchange, and strict ID-token validation. Failures throw OidcError; callers
// turn them into a generic "sign-in failed" and never show the reason to the browser.

export class OidcError extends Error {}

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const TIMEOUT_MS = 5000;
const normalise = (u: string) => u.replace(/\/+$/, '');

async function getJson(url: string): Promise<any> {
  assertSafeUrl(url);
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error', headers: { accept: 'application/json' } });
  if (!res.ok) throw new OidcError(`GET ${new URL(url).pathname} -> ${res.status}`);
  return res.json();
}

/** Reads the provider's configuration and checks it really belongs to the configured issuer. */
export async function discover(issuer: string): Promise<Discovery> {
  const doc = await getJson(`${normalise(issuer)}/.well-known/openid-configuration`);
  if (typeof doc?.issuer !== 'string' || normalise(doc.issuer) !== normalise(issuer)) {
    throw new OidcError('issuer in the discovery document does not match');
  }
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (typeof doc[k] !== 'string') throw new OidcError(`discovery document has no ${k}`);
    assertSafeUrl(doc[k]);
  }
  return doc as Discovery;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

export function newPkce() {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

export const randomToken = () => b64url(crypto.randomBytes(24));

export interface FlowState {
  state: string;
  nonce: string;
  verifier: string;
  tenantId: string;
  /** The redirect URI used for this flow; the token exchange must send the identical value. */
  redirectUri: string;
}

const FLOW_AUDIENCE = 'sso-flow';
const FLOW_TTL = '10m';

/** The in-flight state lives in a short-lived signed cookie, so no server-side session is needed. */
export const signFlow = (f: FlowState) =>
  jwt.sign(f, config.JWT_SECRET, { algorithm: 'HS256', audience: FLOW_AUDIENCE, expiresIn: FLOW_TTL });

export function readFlow(token: string | undefined): FlowState | null {
  if (!token) return null;
  try {
    const d = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'], audience: FLOW_AUDIENCE }) as any;
    return d.state && d.nonce && d.verifier && d.tenantId && d.redirectUri ? { state: d.state, nonce: d.nonce, verifier: d.verifier, tenantId: d.tenantId, redirectUri: d.redirectUri } : null;
  } catch {
    return null;
  }
}

export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function authorizationUrl(d: Discovery, p: { clientId: string; redirectUri: string; state: string; nonce: string; challenge: string }) {
  const u = new URL(d.authorization_endpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', p.clientId);
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', p.state);
  u.searchParams.set('nonce', p.nonce);
  u.searchParams.set('code_challenge', p.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export async function exchangeCode(
  d: Discovery,
  p: { clientId: string; clientSecret: string; redirectUri: string; code: string; verifier: string }
): Promise<string> {
  assertSafeUrl(d.token_endpoint);
  const res = await fetch(d.token_endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: p.code,
      redirect_uri: p.redirectUri,
      client_id: p.clientId,
      client_secret: p.clientSecret,
      code_verifier: p.verifier,
    }),
  });
  if (!res.ok) throw new OidcError(`token endpoint -> ${res.status}`);
  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new OidcError('no id_token in the token response');
  return body.id_token;
}

export interface IdClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

/**
 * Verifies signature (RS256 against the provider's JWKS), issuer, audience, expiry and nonce.
 * Anything else, including `alg: none` and HMAC tokens, is rejected.
 */
export async function verifyIdToken(idToken: string, d: Discovery, p: { clientId: string; nonce: string }): Promise<IdClaims> {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || decoded.header.alg !== 'RS256') throw new OidcError('unsupported token algorithm');

  const { keys } = (await getJson(d.jwks_uri)) as { keys?: (crypto.JsonWebKey & { kid?: string; use?: string })[] };
  const jwk = keys?.find((k) => k.use !== 'enc' && (!decoded.header.kid || k.kid === decoded.header.kid));
  if (!jwk) throw new OidcError('no matching signing key');

  let claims: any;
  try {
    claims = jwt.verify(idToken, crypto.createPublicKey({ key: jwk, format: 'jwk' }), {
      algorithms: ['RS256'],
      issuer: [d.issuer, normalise(d.issuer), `${normalise(d.issuer)}/`],
      audience: p.clientId,
    });
  } catch (e: any) {
    throw new OidcError(`token rejected: ${e.message}`);
  }
  if (typeof claims.nonce !== 'string' || !safeEqual(claims.nonce, p.nonce)) throw new OidcError('nonce mismatch');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new OidcError('no subject');
  return claims as IdClaims;
}
