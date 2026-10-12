import { Request, Response, NextFunction, CookieOptions } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@enterprise-lms/security';
import { config } from '../config';

export const AUTH_COOKIE = 'lms_token';

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
      /** Unauthenticated tenant hint (header / subdomain); must be resolved against the DB before use. */
      tenantHint?: string;
      user?: AuthUser;
    }
  }
}

/** Generates a signed JWT. */
export function generateToken(user: { id: string; role: string; email: string; tenantId: string }): string {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email, tenantId: user.tenantId },
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

export function verifyToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as Partial<AuthUser>;
    if (!decoded.id || !decoded.role || !decoded.tenantId || !decoded.email) return null;
    return { id: decoded.id, role: decoded.role, email: decoded.email, tenantId: decoded.tenantId };
  } catch {
    return null;
  }
}

/** Requires a valid token. Sets req.user and req.tenantId from it; nothing client-supplied is trusted. */
export const authenticateJWT = (req: Request, res: Response, next: NextFunction) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Authentication token is required' });
  }

  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }

  req.user = user;
  req.tenantId = user.tenantId;
  return next();
};

/** Attaches req.user when a valid token is present but never rejects the request. */
export const optionalAuth = (req: Request, _res: Response, next: NextFunction) => {
  const token = extractToken(req);
  const user = token ? verifyToken(token) : null;
  if (user) {
    req.user = user;
    req.tenantId = user.tenantId;
  }
  next();
};

/** Role-Based Access Control Middleware Factory */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
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
}
