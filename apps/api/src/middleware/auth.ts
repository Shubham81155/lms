import { Request, Response, NextFunction, CookieOptions } from 'express';
import jwt from 'jsonwebtoken';
import { runWithTenant } from '@enterprise-lms/database';
import { UserRole } from '@enterprise-lms/security';
import { config } from '../config';
import { loadSession, sessionIsValid, tenantIsBlocked, tenantIsReadOnly, PAYMENT_LAPSED, TENANT_SUSPENDED_MESSAGE } from '../lib/session';
import { refuseTrialWrite } from '../lib/trial-guard';
import { loadSupportSession, refuseSupportWrite } from '../lib/support-access';
import { HttpError } from '../lib/http';
import { cookieName } from '../lib/cookie-name';

/** The session cookie: `__Host-lms_token` in production (see lib/cookie-name.ts), `lms_token` elsewhere. */
export const AUTH_COOKIE = cookieName('lms_token');

export interface AuthUser {
  id: string;
  role: UserRole;
  email: string;
  tenantId: string;
}

declare global {
  namespace Express {
    interface Request {
      /** Authoritative tenant id; only set after authentication, taken from the verified token. */
      tenantId?: string;
      /** Unauthenticated tenant hints in priority order; must be resolved against the DB before use. */
      tenantHints?: string[];
      /** Host the browser used (with port), lower-cased. Only meaningful for choosing among a tenant's own origins. */
      publicHost?: string;
      user?: AuthUser;
      /** Set by authentication: the organisation's trial has ended, so changes are refused (lib/trial-guard.ts). */
      tenantReadOnly?: boolean;
      /** With tenantReadOnly: it is because billing lapsed, not because a trial ended. */
      tenantPaymentLapsed?: boolean;
    }
  }
}

/** Generates a signed JWT. */
export function generateToken(user: { id: string; role: string; email: string; tenantId: string; tokenVersion?: number }): string {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email, tenantId: user.tenantId, tv: user.tokenVersion ?? 0 },
    config.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
  );
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

export function setAuthCookie(res: Response, token: string): void {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  res.cookie(AUTH_COOKIE, token, {
    ...cookieOptions(),
    ...(decoded?.exp ? { expires: new Date(decoded.exp * 1000) } : {}),
  });
}

/**
 * Issues the session cookie for a user, stamped with their current token version. Refuses (403) when the
 * organisation is suspended, whichever sign-in path (password, SSO, LTI) got here.
 */
export async function startSession(res: Response, user: { id: string; role: string; email: string; tenantId: string }): Promise<void> {
  const state = await loadSession(user.id, user.tenantId, true);
  if (tenantIsBlocked(state?.tenantStatus)) throw new HttpError(403, TENANT_SUSPENDED_MESSAGE);
  setAuthCookie(res, generateToken({ ...user, tokenVersion: state?.tokenVersion ?? 0 }));
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE, cookieOptions());
}

/** Bearer header (API clients) or the httpOnly session cookie (browser). */
export function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.substring(7).trim() || null;
  }
  const cookie = req.cookies?.[AUTH_COOKIE];
  return typeof cookie === 'string' && cookie ? cookie : null;
}

export function verifyToken(token: string): (AuthUser & { tv: number; sp?: string; op?: string }) | null {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as Partial<AuthUser> & {
      tv?: number;
      sp?: string;
      op?: string;
    };
    if (!decoded.id || !decoded.role || !decoded.tenantId || !decoded.email) return null;
    return {
      id: decoded.id,
      role: decoded.role,
      email: decoded.email,
      tenantId: decoded.tenantId,
      tv: decoded.tv ?? 0,
      // A platform-operator support session (lib/support-access.ts): its pass, and the operator's e-mail.
      ...(typeof decoded.sp === 'string' ? { sp: decoded.sp, op: typeof decoded.op === 'string' ? decoded.op : '' } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Verifies the token and re-checks the user server-side (still active, token not revoked, organisation
 * not suspended). The role comes from the database, not the token, so a demotion applies immediately.
 */
async function authenticate(req: Request): Promise<AuthUser | null | 'TENANT_SUSPENDED'> {
  const token = extractToken(req);
  const claims = token ? verifyToken(token) : null;
  if (!claims) return null;
  const state = await loadSession(claims.id, claims.tenantId);
  if (!sessionIsValid(state, claims.tv)) return null;
  if (tenantIsBlocked(state.tenantStatus)) return 'TENANT_SUSPENDED';
  req.tenantReadOnly = tenantIsReadOnly(state);
  req.tenantPaymentLapsed = req.tenantReadOnly && (state.tenantTrialRemindersSent & PAYMENT_LAPSED) !== 0;
  if (claims.sp) {
    // A support session lasts only while its pass is in force: revoked or expired ends it at once.
    const support = await loadSupportSession(claims.sp, claims.tenantId, claims.op ?? '');
    if (!support) return null;
    req.support = support;
  }
  return { id: claims.id, role: state.role as UserRole, email: claims.email, tenantId: claims.tenantId };
}

/** Requires a valid token. Sets req.user and req.tenantId from it; nothing client-supplied is trusted. */
export const authenticateJWT = (req: Request, res: Response, next: NextFunction) => {
  if (!extractToken(req)) {
    return res.status(401).json({ error: 'Unauthorized: Authentication token is required' });
  }
  authenticate(req).then(
    (user) => {
      if (!user) return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
      // 403, not 401: the session is fine, the organisation is not. The web app shows the message.
      if (user === 'TENANT_SUSPENDED') return res.status(403).json({ error: TENANT_SUSPENDED_MESSAGE, code: 'TENANT_SUSPENDED' });
      req.user = user;
      req.tenantId = user.tenantId;
      if (refuseTrialWrite(req, res)) return;
      if (refuseSupportWrite(req, res)) return;
      // Everything downstream (handlers, audit logging) runs scoped to this tenant at the database.
      return runWithTenant(user.tenantId, () => next());
    },
    () => res.status(503).json({ error: 'Unable to verify session' })
  );
};

/** Attaches req.user when a valid token is present but never rejects the request. */
export const optionalAuth = (req: Request, _res: Response, next: NextFunction) => {
  authenticate(req).then(
    (user) => {
      if (!user || user === 'TENANT_SUSPENDED') return next();
      req.user = user;
      req.tenantId = user.tenantId;
      return runWithTenant(user.tenantId, () => next());
    },
    () => next()
  );
};

/** Tenant of an authenticated request. Never read the tenant from headers or the body. */
export function tenantIdOf(req: Request): string {
  const tenantId = req.user?.tenantId;
  if (!tenantId) throw new Error('tenantIdOf() called on a request that is not authenticated');
  return tenantId;
}

/** Role-Based Access Control Middleware Factory */
export function requireRole(...roles: UserRole[]) {
  const middleware = (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden: Insufficient permissions',
        requiredRoles: roles,
        userRole: req.user.role,
      });
    }

    return next();
  };
  // Lets the API description (openapi/inventory.ts) list which roles a route needs.
  return Object.assign(middleware, { requiredRoles: roles as readonly string[] });
}
