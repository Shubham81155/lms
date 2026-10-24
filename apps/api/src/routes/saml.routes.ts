import express, { Router, Request, Response } from 'express';
import { runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma, prisma } from '../lib/prisma';
import { resolveTenant } from '../lib/tenant';
import { logAuditEvent } from '../lib/audit';
import { logger } from '../lib/logger';
import { tenantFeatures } from '../lib/features';
import { startSession } from '../middleware/auth';
import { cookiePath } from '../lib/cookie-name';
import { appOrigin, originFor } from '../lib/sso-origin';
import { resolveSsoUser } from '../lib/sso-user';
import {
  SAML_FLOW_COOKIE,
  SamlError,
  emailFromProfile,
  metadataXml,
  newRequestId,
  readSamlFlow,
  responseSucceeded,
  safeEqual,
  samlFor,
  signSamlFlow,
  subjectFromProfile,
  namesFromProfile,
} from '../lib/saml';

// Mounted at /api/v1/auth/saml. SP-initiated SAML 2.0 web SSO (HTTP-Redirect out, HTTP-POST back).
// Like OIDC sign-in it only signs in people who already exist in the tenant; it never creates
// accounts, and it refuses responses that do not answer a request this browser started.

const router = Router();
router.use(express.urlencoded({ extended: false, limit: '256kb' }));

const loginUrl = (origin: string, error?: string) => `${origin}/login${error ? `?error=${error}` : ''}`;

// The IdP posts back from another site, and browsers do not send SameSite=Lax cookies on a
// cross-site POST. In production (https) the flow cookie is therefore SameSite=None; Secure.
const cookieOpts = () => {
  const prod = config.NODE_ENV === 'production';
  return { httpOnly: true, secure: prod, sameSite: (prod ? 'none' : 'lax') as 'none' | 'lax', path: cookiePath('/api/v1/auth/saml') };
};

async function activeConnection(tenantId: string) {
  if (!(await tenantFeatures(tenantId)).sso) return null;
  const conn = await prisma.samlConnection.findUnique({ where: { tenantId } });
  return conn?.enabled ? conn : null;
}

/** GET /api/v1/auth/saml/start: redirects the browser to the identity provider with an AuthnRequest. */
router.get('/start', async (req: Request, res: Response) => {
  try {
    const tenant = await resolveTenant(req.tenantHints);
    if (!tenant) return res.redirect(302, loginUrl(appOrigin(), 'sso_unavailable'));
    const origin = originFor(tenant, req.publicHost);

    return await runWithTenant(tenant.id, async () => {
      const conn = await activeConnection(tenant.id);
      if (!conn) return res.redirect(302, loginUrl(origin, 'sso_unavailable'));

      const requestId = newRequestId();
      const saml = samlFor(conn, origin, tenant.slug, requestId);
      const url = await saml.getAuthorizeUrlAsync('', undefined, {});
      res.cookie(SAML_FLOW_COOKIE, signSamlFlow({ tenantId: tenant.id, requestId, origin }), { ...cookieOpts(), maxAge: 10 * 60 * 1000 });
      return res.redirect(302, url);
    });
  } catch (err) {
    logger.warn({ err, requestId: req.id }, 'saml start failed');
    return res.redirect(302, loginUrl(appOrigin(), 'sso_failed'));
  }
});

/** POST /api/v1/auth/saml/acs: the assertion consumer service. */
router.post('/acs', async (req: Request, res: Response) => {
  const flow = readSamlFlow(req.cookies?.[SAML_FLOW_COOKIE]);
  res.clearCookie(SAML_FLOW_COOKIE, cookieOpts());
  const origin = flow?.origin ?? appOrigin();

  const fail = (reason: string) => {
    logger.info({ reason, requestId: req.id }, 'saml sign-in refused');
    if (flow) {
      void runWithTenant(flow.tenantId, () =>
        logAuditEvent({
          tenantId: flow.tenantId,
          action: 'SAML_LOGIN_FAILED',
          resourceType: 'USER',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          diffJson: { reason },
        })
      );
    }
    // 303 turns the IdP's POST into a GET of the login page.
    return res.redirect(303, loginUrl(origin, 'sso_failed'));
  };

  try {
    if (!flow) return fail('missing or expired flow cookie');
    const samlResponse = typeof req.body?.SAMLResponse === 'string' ? req.body.SAMLResponse : '';
    if (!samlResponse) return fail('no SAMLResponse');
    if (!responseSucceeded(samlResponse)) return fail('response status is not Success');

    return await runWithTenant(flow.tenantId, async () => {
      const conn = await activeConnection(flow.tenantId);
      if (!conn) return fail('sso disabled');
      const tenant = await basePrisma.tenant.findUnique({ where: { id: flow.tenantId }, select: { slug: true } });
      if (!tenant) return fail('tenant not found');

      const saml = samlFor(conn, flow.origin, tenant.slug);
      const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
      if (!profile) return fail('no profile in response');
      // Must answer the request this browser started: refuses IdP-initiated, replayed and swapped responses.
      const answered = (profile as unknown as { inResponseTo?: string }).inResponseTo;
      if (!answered || !safeEqual(answered, flow.requestId)) return fail('response does not answer this request');
      if (profile.issuer !== conn.idpIssuer) return fail('unexpected issuer');

      const result = await resolveSsoUser({
        tenantId: flow.tenantId,
        provider: 'SAML',
        subject: subjectFromProfile(profile, conn.idpIssuer),
        email: emailFromProfile(profile, conn.emailAttribute),
        emailTrusted: true,
        allowedDomains: conn.allowedDomains,
        autoCreate: conn.autoCreateAccounts,
        ...namesFromProfile(profile),
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      if (!result.ok) return fail(result.reason);

      await startSession(res, { id: result.user.id, role: result.user.role, email: result.user.email, tenantId: result.user.tenantId });
      await logAuditEvent({
        tenantId: flow.tenantId,
        userId: result.user.id,
        action: 'USER_LOGIN',
        resourceType: 'USER',
        resourceId: result.user.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        diffJson: { method: 'SAML' },
      });
      return res.redirect(303, `${origin}/`);
    });
  } catch (err: any) {
    // Library errors (bad signature, expired, wrong audience...) are logged and audited, never shown.
    return fail(err instanceof SamlError || err instanceof Error ? String(err.message).slice(0, 120) : 'error');
  }
});

/** GET /api/v1/auth/saml/metadata/:slug: what the administrator gives the IdP (public information). */
router.get('/metadata/:slug', async (req: Request, res: Response) => {
  try {
    const tenant = await basePrisma.tenant.findUnique({
      where: { slug: String(req.params.slug) },
      select: { id: true, slug: true, customDomain: true, status: true },
    });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'ARCHIVED')
      return res.status(404).json({ error: 'Not found', requestId: req.id });
    const exists = await runWithTenant(
      tenant.id,
      async () => !!(await prisma.samlConnection.findUnique({ where: { tenantId: tenant.id }, select: { id: true } }))
    );
    if (!exists) return res.status(404).json({ error: 'Not found', requestId: req.id });
    res.type('application/samlmetadata+xml');
    return res.send(metadataXml(originFor(tenant, req.publicHost), tenant.slug));
  } catch {
    return res.status(404).json({ error: 'Not found', requestId: req.id });
  }
});

export default router;
