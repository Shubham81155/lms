import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { z } from 'zod';
import { runWithTenant } from '@enterprise-lms/database';
import { prisma } from '../lib/prisma';
import { resolveTenant } from '../lib/tenant';
import { logAuditEvent } from '../lib/audit';
import { startSession } from '../middleware/auth';
import { HttpError, route } from '../lib/http';
import { parseBody } from '../lib/validate';
import { requireFeature } from '../lib/features';

// LTI 1.3 launch (this LMS acting as the tool). The id_token is verified against the platform's
// JWKS using the registered deployment; nothing in the body is trusted before that. The launching
// user must already exist in the tenant (matched by email); launches never create accounts.

const router = Router();

const CLAIM = 'https://purl.imsglobal.org/spec/lti/claim';
const launchSchema = z.object({ id_token: z.string().min(20).max(20_000) });

type Jwk = crypto.JsonWebKey & { kid?: string };

async function fetchKey(keySetUrl: string, kid?: string) {
  const res = await fetch(keySetUrl, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!res.ok) throw new HttpError(502, 'Could not fetch the platform key set');
  const { keys } = (await res.json()) as { keys?: Jwk[] };
  const jwk = keys?.find((k) => (kid ? k.kid === kid : true) && (k as any).use !== 'enc');
  if (!jwk) throw new HttpError(401, 'No matching platform key');
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

/** POST /api/v1/lti/launch {id_token} */
router.post(
  '/launch',
  route('LTI launch failed', async (req, res) => {
    const { id_token } = parseBody(req, launchSchema);
    const decoded = jwt.decode(id_token, { complete: true });
    const claims = decoded && typeof decoded.payload === 'object' ? (decoded.payload as Record<string, any>) : null;
    if (!decoded || !claims || decoded.header.alg !== 'RS256') throw new HttpError(401, 'Invalid LTI token');
    if (claims[`${CLAIM}/version`] !== '1.3.0') throw new HttpError(400, 'Unsupported LTI version');

    const tenant = await resolveTenant(req.tenantHints);
    if (!tenant) throw new HttpError(404, 'Tenant not found');

    return runWithTenant(tenant.id, async () => {
      await requireFeature(tenant.id, 'lti13');
      const clientId = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
      const deployment = await prisma.ltiDeployment.findFirst({
        where: { tenantId: tenant.id, issuer: String(claims.iss), clientId: String(clientId), deploymentId: String(claims[`${CLAIM}/deployment_id`]), isActive: true },
      });
      if (!deployment) throw new HttpError(401, 'Unknown LTI deployment');

      const key = await fetchKey(deployment.keySetUrl, decoded.header.kid);
      let verified: any;
      try {
        verified = jwt.verify(id_token, key, { algorithms: ['RS256'], issuer: deployment.issuer, audience: deployment.clientId });
      } catch {
        throw new HttpError(401, 'LTI token verification failed');
      }
      if (!verified.nonce) throw new HttpError(401, 'LTI token has no nonce');

      const email = typeof verified.email === 'string' ? verified.email.toLowerCase() : '';
      const user = email ? await prisma.user.findFirst({ where: { tenantId: tenant.id, email, status: 'ACTIVE' } }) : null;
      if (!user) throw new HttpError(403, 'No active account in this organisation matches the launching user');

      await startSession(res, { id: user.id, role: user.role, email: user.email, tenantId: user.tenantId });
      await logAuditEvent({
        tenantId: tenant.id, userId: user.id, action: 'LTI_LAUNCH', resourceType: 'LTI_DEPLOYMENT', resourceId: deployment.id,
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
      });
      return res.json({
        status: 'authenticated',
        ltiVersion: '1.3.0',
        targetLinkUri: verified[`${CLAIM}/target_link_uri`] ?? null,
        user: { id: user.id, role: user.role },
      });
    });
  })
);

export default router;
