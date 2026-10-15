import { Router, Request, Response } from 'express';
import { runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { resolveTenant } from '../lib/tenant';
import { logAuditEvent } from '../lib/audit';
import { tenantFeatures } from '../lib/features';
import { decryptSecret } from '../lib/mfa';
import { startSession } from '../middleware/auth';
import {
  authorizationUrl, discover, exchangeCode, newPkce, randomToken, readFlow, safeEqual, signFlow, verifyIdToken, IdClaims,
} from '../lib/oidc';
import { logger } from '../lib/logger';
import { resolveSsoUser } from '../lib/sso-user';
import { appOrigin, callbackUri, originFor } from '../lib/sso-origin';

// Mounted at /api/v1/auth/sso. The browser is redirected to the tenant's identity provider and
// returns to /callback. This only signs in users that already exist in the tenant (matched by the
// provider's subject, or by a verified e-mail address); it never creates accounts.

const router = Router();

const FLOW_COOKIE = 'lms_sso';
const loginUrl = (origin: string, error?: string) => `${origin}/login${error ? `?error=${error}` : ''}`;
const cookieOpts = () => ({ httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/api/v1/auth/sso' });

/** The tenant's connection when SSO is both switched on for the plan and enabled by the admin. */
async function activeConnection(tenantId: string) {
  if (!(await tenantFeatures(tenantId)).sso) return null;
  const conn = await prisma.ssoConnection.findUnique({ where: { tenantId } });
  return conn?.enabled ? conn : null;
}

/** GET /api/v1/auth/sso/status: lets the login page decide whether to show the SSO button. */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const tenant = await resolveTenant(req.tenantHints);
    if (!tenant) return res.json({ enabled: false });
    return await runWithTenant(tenant.id, async () => {
      const features = await tenantFeatures(tenant.id);
      const [oidc, saml] = await Promise.all([
        features.sso ? prisma.ssoConnection.findUnique({ where: { tenantId: tenant.id }, select: { enabled: true } }) : null,
        features.sso ? prisma.samlConnection.findUnique({ where: { tenantId: tenant.id }, select: { enabled: true } }) : null,
      ]);
      return res.json({ enabled: !!(oidc?.enabled || saml?.enabled), oidc: !!oidc?.enabled, saml: !!saml?.enabled });
    });
  } catch {
    return res.json({ enabled: false });
  }
});

/** GET /api/v1/auth/sso/start: redirects to the identity provider. */
router.get('/start', async (req: Request, res: Response) => {
  try {
    const tenant = await resolveTenant(req.tenantHints);
    if (!tenant) return res.redirect(302, loginUrl(appOrigin(), 'sso_unavailable'));
    const origin = originFor(tenant, req.publicHost);

    return await runWithTenant(tenant.id, async () => {
      const conn = await activeConnection(tenant.id);
      if (!conn) return res.redirect(302, loginUrl(origin, 'sso_unavailable'));

      const d = await discover(conn.issuer);
      const pkce = newPkce();
      const flow = { state: randomToken(), nonce: randomToken(), verifier: pkce.verifier, tenantId: tenant.id, redirectUri: callbackUri(origin) };
      res.cookie(FLOW_COOKIE, signFlow(flow), { ...cookieOpts(), maxAge: 10 * 60 * 1000 });
      return res.redirect(302, authorizationUrl(d, { clientId: conn.clientId, redirectUri: flow.redirectUri, state: flow.state, nonce: flow.nonce, challenge: pkce.challenge }));
    });
  } catch (err) {
    logger.warn({ err, requestId: req.id }, 'sso start failed');
    return res.redirect(302, loginUrl(appOrigin(), 'sso_failed'));
  }
});

/** GET /api/v1/auth/sso/callback */
router.get('/callback', async (req: Request, res: Response) => {
  const flow = readFlow(req.cookies?.[FLOW_COOKIE]);
  res.clearCookie(FLOW_COOKIE, cookieOpts());
  // Return the browser to the host it started on (the flow cookie is signed, so this cannot be forged).
  const origin = flow ? new URL(flow.redirectUri).origin : appOrigin();
  const fail = (reason: string, tenantId?: string) => {
    logger.info({ reason, requestId: req.id }, 'sso sign-in refused');
    if (tenantId) {
      void runWithTenant(tenantId, () =>
        logAuditEvent({ tenantId, action: 'SSO_LOGIN_FAILED', resourceType: 'USER', ipAddress: req.ip, userAgent: req.headers['user-agent'], diffJson: { reason } })
      );
    }
    return res.redirect(302, loginUrl(origin, 'sso_failed'));
  };

  try {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (!flow) return fail('missing or expired flow cookie');
    if (error) return fail(`provider returned ${String(error).slice(0, 40)}`, flow.tenantId);
    if (typeof code !== 'string' || typeof state !== 'string' || !safeEqual(state, flow.state)) return fail('state mismatch', flow.tenantId);

    return await runWithTenant(flow.tenantId, async () => {
      const conn = await activeConnection(flow.tenantId);
      if (!conn) return fail('sso disabled', flow.tenantId);

      const d = await discover(conn.issuer);
      const idToken = await exchangeCode(d, {
        clientId: conn.clientId, clientSecret: decryptSecret(conn.clientSecretEnc), redirectUri: flow.redirectUri, code, verifier: flow.verifier,
      });
      const claims = await verifyIdToken(idToken, d, { clientId: conn.clientId, nonce: flow.nonce });

      const result = await resolveSsoUser({
        tenantId: flow.tenantId,
        provider: 'OIDC',
        subject: claims.sub,
        email: claims.email,
        emailTrusted: claims.email_verified === true,
        allowedDomains: conn.allowedDomains,
      });
      if (!result.ok) return fail(result.reason, flow.tenantId);

      await startSession(res, { id: result.user.id, role: result.user.role, email: result.user.email, tenantId: result.user.tenantId });
      await logAuditEvent({
        tenantId: flow.tenantId, userId: result.user.id, action: 'USER_LOGIN', resourceType: 'USER', resourceId: result.user.id,
        ipAddress: req.ip, userAgent: req.headers['user-agent'], diffJson: { method: 'OIDC' },
      });
      // The home page forwards a signed-in user to their own portal.
      return res.redirect(302, `${origin}/`);
    });
  } catch (err: any) {
    return fail(String(err?.message ?? err).slice(0, 120), flow?.tenantId);
  }
});

export default router;
