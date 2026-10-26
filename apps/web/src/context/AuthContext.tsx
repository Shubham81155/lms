'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { PUBLIC_PATHS, canView, homeFor, type Role } from '@/lib/roles';

export interface UserSession {
  id: string;
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string | null;
  role: Role;
  tenantId: string;
  tenantName: string;
  /** Used in public links, e.g. certificate verification. */
  tenantSlug: string;
  /** The organisation's own web address (subdomain or custom domain), when the API reports it. */
  organizationUrl: string | null;
  /** Super administrator of the platform operator organisation: may use /platform. */
  platformOperator: boolean;
  targetRoute: string;
}

interface ApiUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  role: Role;
  tenantId: string;
  tenant?: { name?: string; slug?: string; logoUrl?: string | null };
  platformOperator?: boolean;
  organizationUrl?: string | null;
}

interface AuthContextType {
  user: UserSession | null;
  isLoading: boolean;
  login: (
    email: string,
    password: string,
    mfaCode?: string
  ) => Promise<{ success: boolean; targetRoute?: string; error?: string; mfaRequired?: boolean }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUserSession: (patch: Partial<UserSession>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function toSession(u: ApiUser): UserSession {
  return {
    id: u.id,
    email: u.email,
    name: `${u.firstName} ${u.lastName}`.trim(),
    firstName: u.firstName,
    lastName: u.lastName,
    avatarUrl: u.avatarUrl ?? null,
    role: u.role,
    tenantId: u.tenantId,
    tenantName: u.tenant?.name ?? '',
    tenantSlug: u.tenant?.slug ?? '',
    organizationUrl: u.organizationUrl ?? null,
    platformOperator: u.platformOperator === true,
    // Operators land in the platform console; everyone else in their role's area.
    targetRoute: homeFor({ role: u.role, platformOperator: u.platformOperator === true }),
  };
}

// The session itself lives in an httpOnly cookie that scripts cannot read; this context only
// mirrors what the API says about the current user.
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.get<{ user: ApiUser }>('/api/v1/auth/me');
      setUser(toSession(data.user));
    } catch {
      // ignore if unauthenticated
    }
  }, []);

  const updateUserSession = useCallback((patch: Partial<UserSession>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ user: ApiUser }>('/api/v1/auth/me')
      .then((data) => {
        if (!cancelled) setUser(toSession(data.user));
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // UX-only guard; the real enforcement is middleware.ts and the API.
  useEffect(() => {
    if (isLoading) return;

    // Links from notifications and emails sign people in themselves (see DeepLink), keeping the destination.
    if (PUBLIC_PATHS.includes(pathname) || ['/courses/', '/quizzes/', '/assignments/'].some((p) => pathname.startsWith(p))) return;

    if (!user) {
      router.replace('/login');
      return;
    }

    if (!canView(user, pathname)) {
      router.replace(user.targetRoute || '/login');
    }
  }, [user, isLoading, pathname, router]);

  const login = useCallback(async (email: string, password: string, mfaCode?: string) => {
    try {
      const data = await api.post<{ user: ApiUser }>('/api/v1/auth/login', {
        email,
        password,
        ...(mfaCode ? { mfaCode } : {}),
      });
      const session = toSession(data.user);
      setUser(session);
      return { success: true, targetRoute: session.targetRoute };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Unable to reach the server. Please try again.';
      // The password was right but the account needs its second factor.
      const mfaRequired = err instanceof ApiError && err.status === 401 && err.details?.mfaRequired === true;
      return { success: false, error: message, mfaRequired };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/v1/auth/logout');
    } finally {
      setUser(null);
      router.push('/login');
    }
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, refreshUser, updateUserSession }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
