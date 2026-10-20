import { logger } from '../lib/logger';
import { rateLimitStore } from '../lib/rate-limit-store';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { runWithTenant } from '@enterprise-lms/database';
import { basePrisma, prisma, runInTenantTransaction } from '../lib/prisma';
import { lookupTenant, resolveTenant } from '../lib/tenant';
import { tenantUrl } from '../lib/tenant-url';
import { logAuditEvent } from '../lib/audit';
import { config } from '../config';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  hashPassword,
  verifyPassword,
} from '../lib/password';
import { generateOneTimeToken, hashOneTimeToken } from '../lib/one-time-token';
import { sendMail } from '../lib/mailer';
import { verifySecondFactor } from '../lib/mfa';
import {
  authenticateJWT,
  clearAuthCookie,
  optionalAuth,
  startSession,
} from '../middleware/auth';
import { invalidateSessionCache, revokeSessions, TENANT_SUSPENDED_MESSAGE, tenantIsBlocked } from '../lib/session';

const router = Router();

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export const loginSchema = z.object({
  email: z.string().email('Invalid email address format').max(254),
  password: z.string().min(1, 'Password is required').max(PASSWORD_MAX_LENGTH),
  /** TOTP code or recovery code; required only when the account has MFA enabled. */
  mfaCode: z.string().trim().min(6).max(32).optional(),
});

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH);

export const forgotSchema = z.object({ email: z.string().email().max(254) });
export const resetSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const verifySchema = z.object({ token: z.string().min(20).max(200) });

const limiter = (name: string, limit: number, message: string) =>
  rateLimit({
    store: rateLimitStore(name),
    passOnStoreError: true,
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message },
  });

const loginLimiter = limiter('login', config.LOGIN_RATE_LIMIT_MAX, 'Too many login attempts. Try again later.');
const tokenFlowLimiter = limiter('token-flow', config.TOKEN_FLOW_RATE_LIMIT_MAX, 'Too many requests. Try again later.');

const publicUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  tenantId: true,
  status: true,
  avatarUrl: true,
  emailVerified: true,
  tenant: { select: { id: true, slug: true, name: true } },
} as const;

/**
 * POST /api/v1/auth/login
 * Verifies credentials, enforces lockout, and sets the session as an httpOnly cookie.
 */
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.format(),
      });
    }

    const { email, password, mfaCode } = parseResult.data;
    const invalid = () => res.status(401).json({ error: 'Invalid email or password' });

    const tenant = await lookupTenant(req.tenantHints);
    if (!tenant || tenantIsBlocked(tenant.status)) {
      await verifyPassword(password, null); // keep timing similar to the unknown-user path
      // Whether an organisation is suspended is not a secret of any account; its login page says so too.
      if (tenant) return res.status(403).json({ error: TENANT_SUSPENDED_MESSAGE, code: 'TENANT_SUSPENDED' });
      return invalid();
    }

    return await runWithTenant(tenant.id, async () => {

      const user = await prisma.user.findFirst({
        where: { tenantId: tenant.id, email: email.toLowerCase() },
      });

      if (user?.lockedUntil && user.lockedUntil > new Date()) {
        return res.status(423).json({
          error: 'Account temporarily locked due to repeated failed sign-ins. Try again later.',
          retryAfter: user.lockedUntil.toISOString(),
        });
      }

      const check = await verifyPassword(password, user?.passwordHash ?? null);

      if (!user || !check.valid) {
        if (user) {
          const { failedLoginCount } = await prisma.user.update({
            where: { id: user.id },
            data: { failedLoginCount: { increment: 1 } },
            select: { failedLoginCount: true },
          });

          if (failedLoginCount >= config.MAX_FAILED_LOGINS) {
            await prisma.user.update({
              where: { id: user.id },
              data: {
                failedLoginCount: 0,
                lockedUntil: new Date(Date.now() + config.LOCKOUT_MINUTES * 60 * 1000),
              },
            });
          }
        }

        await logAuditEvent({
          tenantId: tenant.id,
          userId: user?.id ?? null,
          action: 'USER_LOGIN_FAILED',
          resourceType: 'USER',
          resourceId: user?.id ?? null,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          diffJson: { email },
        });

        return invalid();
      }

      if (user.status !== 'ACTIVE') {
        return res.status(403).json({
          error: `Account is ${user.status.toLowerCase()}. Please contact your tenant administrator.`,
        });
      }

      if (user.mfaEnabled) {
        if (!mfaCode) {
          // Password was right; ask for the second factor without creating a session.
          return res.status(401).json({ error: 'Two-factor code required', mfaRequired: true });
        }
        if (!(await verifySecondFactor(user, mfaCode))) {
          const { failedLoginCount } = await prisma.user.update({
            where: { id: user.id },
            data: { failedLoginCount: { increment: 1 } },
            select: { failedLoginCount: true },
          });
          if (failedLoginCount >= config.MAX_FAILED_LOGINS) {
            await prisma.user.update({
              where: { id: user.id },
              data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + config.LOCKOUT_MINUTES * 60 * 1000) },
            });
          }
          await logAuditEvent({
            tenantId: tenant.id,
            userId: user.id,
            action: 'USER_LOGIN_FAILED',
            resourceType: 'USER',
            resourceId: user.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            diffJson: { reason: 'MFA_CODE_INVALID' },
          });
          return res.status(401).json({ error: 'Invalid two-factor code', mfaRequired: true });
        }
      }

      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
          ...(check.needsRehash ? { passwordHash: await hashPassword(password) } : {}),
        },
        select: publicUserSelect,
      });

      await startSession(res, {
        id: updatedUser.id,
        role: updatedUser.role,
        email: updatedUser.email,
        tenantId: updatedUser.tenantId,
      });

      await logAuditEvent({
        tenantId: tenant.id,
        userId: updatedUser.id,
        action: 'USER_LOGIN',
        resourceType: 'USER',
        resourceId: updatedUser.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.status(200).json({ user: updatedUser });
    });
  } catch (error: any) {
    logger.error({ err: error }, 'Error in POST /api/v1/auth/login');
    return res.status(500).json({ error: 'Internal server error during authentication' });
  }
});

/**
 * POST /api/v1/auth/logout
 * Always clears the session cookie, even if the token has already expired.
 */
router.post('/logout', optionalAuth, async (req: Request, res: Response) => {
  clearAuthCookie(res);

  if (req.user) {
    // Sign out invalidates the token itself, not just the browser cookie (so a copied token is dead too).
    await revokeSessions(req.user.id);
    await logAuditEvent({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'USER_LOGOUT',
      resourceType: 'USER',
      resourceId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  return res.status(200).json({ message: 'Successfully logged out' });
});

/**
 * GET /api/v1/auth/me
 * Current user profile. Also rejects sessions whose account has since been locked or suspended.
 */
router.get('/me', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findFirst({
      where: { id: req.user!.id, tenantId: req.user!.tenantId },
      select: {
        ...publicUserSelect,
        mfaEnabled: true,
        lastLoginAt: true,
        createdAt: true,
        tenant: { select: { id: true, slug: true, name: true, logoUrl: true, primaryColor: true } },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      clearAuthCookie(res);
      return res.status(401).json({ error: 'Session is no longer valid' });
    }

    // Platform operators (super administrators of PLATFORM_OPERATOR_TENANT) also get the platform admin page.
    const platformOperator = user.role === 'SUPER_ADMIN' && !!config.PLATFORM_OPERATOR_TENANT && user.tenant?.slug === config.PLATFORM_OPERATOR_TENANT;
    return res.status(200).json({ user: { ...user, platformOperator } });
  } catch (error: any) {
    logger.error({ err: error }, 'Error in GET /api/v1/auth/me');
    return res.status(500).json({ error: 'Internal server error retrieving user profile' });
  }
});

const GENERIC_FORGOT_RESPONSE = {
  message: 'If an account exists for that email, a password reset link has been sent.',
};

/**
 * POST /api/v1/auth/forgot-password
 * Always answers identically so the endpoint cannot be used to discover accounts.
 */
router.post('/forgot-password', tokenFlowLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = forgotSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
    }

    const tenant = await resolveTenant(req.tenantHints);
    if (tenant) {
      await runWithTenant(tenant.id, () => sendResetLink(req, tenant, parsed.data.email));
    }

    return res.status(200).json(GENERIC_FORGOT_RESPONSE);
  } catch (error: any) {
    logger.error({ err: error }, 'Error in POST /api/v1/auth/forgot-password');
    return res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

async function sendResetLink(req: Request, tenant: { id: string; slug: string; customDomain: string | null }, email: string): Promise<void> {
  const tenantId = tenant.id;
  {
    const user = await prisma.user.findFirst({
      where: { tenantId, email: email.toLowerCase(), status: 'ACTIVE' },
      select: { id: true, email: true, tenantId: true },
    });

    if (user) {
      const { token, tokenHash } = generateOneTimeToken();
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await prisma.passwordResetToken.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });

      await sendMail({
        to: user.email,
        subject: 'Reset your password',
        text: `Use this link to choose a new password (valid for 1 hour):\n${tenantUrl(tenant)}/reset-password?token=${token}\n\nIf you did not request this, you can ignore this email.`,
      });

      await logAuditEvent({
        tenantId: user.tenantId,
        userId: user.id,
        action: 'PASSWORD_RESET_REQUESTED',
        resourceType: 'USER',
        resourceId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
  }
}

/**
 * POST /api/v1/auth/reset-password
 * Consumes a reset token, sets the new password and clears any lockout.
 */
router.post('/reset-password', tokenFlowLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
    }

    // Token tables are outside RLS (looked up by secret hash); the token carries the tenant.
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashOneTimeToken(parsed.data.token) },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired' });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const now = new Date();

    const changed = await runInTenantTransaction(record.tenantId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: record.userId },
        select: { status: true },
      });
      // An invited person accepts by choosing a password, which activates the account. Anyone else
      // must already be active; suspended and locked accounts cannot use a link.
      if (!user || (user.status !== 'ACTIVE' && user.status !== 'INVITED')) return null;

      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null, emailVerified: true, status: 'ACTIVE', tokenVersion: { increment: 1 } },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: now },
      });
      return user.status;
    });

    invalidateSessionCache(record.userId);
    if (!changed) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired' });
    }

    await runWithTenant(record.tenantId, () =>
      logAuditEvent({
        tenantId: record.tenantId,
        userId: record.userId,
        action: changed === 'INVITED' ? 'USER_INVITATION_ACCEPTED' : 'PASSWORD_RESET_COMPLETED',
        resourceType: 'USER',
        resourceId: record.userId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      })
    );

    // Which organisation to sign in to, and its address: the link may have been opened on another host.
    const tenant = await basePrisma.tenant.findUnique({ where: { id: record.tenantId }, select: { slug: true, name: true, customDomain: true } });
    return res.status(200).json({
      message: changed === 'INVITED' ? 'Your account is ready. You can now sign in.' : 'Password updated. You can now sign in.',
      ...(tenant ? { organization: { slug: tenant.slug, name: tenant.name, url: tenantUrl(tenant) } } : {}),
    });
  } catch (error: any) {
    logger.error({ err: error }, 'Error in POST /api/v1/auth/reset-password');
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

/**
 * POST /api/v1/auth/verify-email
 * Consumes an email verification token.
 */
router.post('/verify-email', tokenFlowLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
    }

    const record = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashOneTimeToken(parsed.data.token) },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return res.status(400).json({ error: 'This verification link is invalid or has expired' });
    }

    await runInTenantTransaction(record.tenantId, async (tx) => {
      await tx.user.update({ where: { id: record.userId }, data: { emailVerified: true } });
      await tx.emailVerificationToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
    });

    await runWithTenant(record.tenantId, () =>
      logAuditEvent({
        tenantId: record.tenantId,
        userId: record.userId,
        action: 'EMAIL_VERIFIED',
        resourceType: 'USER',
        resourceId: record.userId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      })
    );

    return res.status(200).json({ message: 'Email verified' });
  } catch (error: any) {
    logger.error({ err: error }, 'Error in POST /api/v1/auth/verify-email');
    return res.status(500).json({ error: 'Failed to verify email' });
  }
});

/**
 * POST /api/v1/auth/resend-verification
 * Sends a fresh verification link to the signed-in user.
 */
router.post('/resend-verification', authenticateJWT, tokenFlowLimiter, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findFirst({
      where: { id: req.user!.id, tenantId: req.user!.tenantId },
      select: { id: true, email: true, emailVerified: true },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.emailVerified) return res.status(200).json({ message: 'Email is already verified' });

    const { token, tokenHash } = generateOneTimeToken();
    await prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await prisma.emailVerificationToken.create({
      data: {
        tenantId: req.user!.tenantId,
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
      },
    });

    const tenant = await basePrisma.tenant.findUnique({ where: { id: req.user!.tenantId }, select: { slug: true, customDomain: true } });
    await sendMail({
      to: user.email,
      subject: 'Verify your email address',
      text: `Confirm your email address (valid for 24 hours):\n${tenant ? tenantUrl(tenant) : config.APP_URL}/verify-email?token=${token}`,
    });

    return res.status(200).json({ message: 'Verification email sent' });
  } catch (error: any) {
    logger.error({ err: error }, 'Error in POST /api/v1/auth/resend-verification');
    return res.status(500).json({ error: 'Failed to send verification email' });
  }
});

export default router;
