import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';
import { HttpError, route } from '../lib/http';
import { parseBody } from '../lib/validate';
import { verifyPassword } from '../lib/password';
import { generateRecoveryCodes, generateSecret, otpauthUrl, verifyTotp } from '../lib/totp';
import { decryptSecret, encryptSecret, verifySecondFactor } from '../lib/mfa';

// Mounted at /api/v1/auth/mfa. Enrolment is two steps so a user can never lock themselves out with
// an authenticator that was not set up correctly: /setup stores a pending secret, /enable proves
// the app produces valid codes and only then turns MFA on.

const router = Router();
router.use(authenticateJWT);

const ISSUER = 'Enterprise LMS';
export const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export const disableSchema = z.object({ password: z.string().min(1).max(128), code: z.string().trim().min(6).max(32) });

const me = (req: any) =>
  prisma.user.findFirst({
    where: { id: req.user!.id, tenantId: tenantIdOf(req) },
    select: { id: true, email: true, mfaEnabled: true, mfaSecret: true, mfaRecoveryHashes: true, passwordHash: true },
  });

/** GET /api/v1/auth/mfa/status */
router.get(
  '/status',
  route('Failed to load MFA status', async (req, res) => {
    const u = await me(req);
    return res.json({ data: { enabled: !!u?.mfaEnabled, recoveryCodesRemaining: u?.mfaRecoveryHashes.length ?? 0 } });
  })
);

/** POST /api/v1/auth/mfa/setup: begins enrolment; returns the secret and otpauth:// URL once. */
router.post(
  '/setup',
  route('Failed to start MFA setup', async (req, res) => {
    const u = await me(req);
    if (!u) throw new HttpError(404, 'User not found');
    if (u.mfaEnabled) throw new HttpError(409, 'Two-factor authentication is already enabled');
    const secret = generateSecret();
    await prisma.user.update({ where: { id: u.id }, data: { mfaSecret: encryptSecret(secret) } });
    return res.json({ data: { secret, otpauthUrl: otpauthUrl(secret, u.email, ISSUER) } });
  })
);

/** POST /api/v1/auth/mfa/enable {code}: confirms the authenticator and returns recovery codes once. */
router.post(
  '/enable',
  route('Failed to enable MFA', async (req, res) => {
    const { code } = parseBody(req, codeSchema);
    const u = await me(req);
    if (!u) throw new HttpError(404, 'User not found');
    if (u.mfaEnabled) throw new HttpError(409, 'Two-factor authentication is already enabled');
    if (!u.mfaSecret) throw new HttpError(400, 'Start setup first');
    if (!verifyTotp(decryptSecret(u.mfaSecret), code)) throw new HttpError(400, 'That code is not valid');

    const { codes, hashes } = generateRecoveryCodes();
    await prisma.user.update({ where: { id: u.id }, data: { mfaEnabled: true, mfaRecoveryHashes: hashes } });
    await logAuditEvent({
      tenantId: tenantIdOf(req), userId: u.id, action: 'MFA_ENABLED', resourceType: 'USER', resourceId: u.id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    return res.json({ data: { enabled: true, recoveryCodes: codes } });
  })
);

/** POST /api/v1/auth/mfa/disable {password, code}: needs both factors. */
router.post(
  '/disable',
  route('Failed to disable MFA', async (req, res) => {
    const { password, code } = parseBody(req, disableSchema);
    const u = await me(req);
    if (!u) throw new HttpError(404, 'User not found');
    if (!u.mfaEnabled) throw new HttpError(409, 'Two-factor authentication is not enabled');

    const pw = await verifyPassword(password, u.passwordHash);
    if (!pw.valid || !(await verifySecondFactor(u, code))) throw new HttpError(401, 'Password or code is incorrect');

    await prisma.user.update({ where: { id: u.id }, data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryHashes: [] } });
    await logAuditEvent({
      tenantId: tenantIdOf(req), userId: u.id, action: 'MFA_DISABLED', resourceType: 'USER', resourceId: u.id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    return res.json({ data: { enabled: false } });
  })
);

export default router;
