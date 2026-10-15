"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { canAccess, routeForRole, type Role } from "@/lib/roles";

export interface UserSession {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
  tenantName: string;
  targetRoute: string;
}

interface ApiUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  tenantId: string;
  tenant?: { name?: string };
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function toSession(u: ApiUser): UserSession {
  return {
    id: u.id,
    email: u.email,
    name: `${u.firstName} ${u.lastName}`.trim(),
    role: u.role,
    tenantId: u.tenantId,
    tenantName: u.tenant?.name ?? "",
    targetRoute: routeForRole(u.role),
  };
}

// The session itself lives in an httpOnly cookie that scripts cannot read; this context only
// mirrors what the API says about the current user.
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ user: ApiUser }>("/api/v1/auth/me")
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

    const publicPaths = ["/", "/login", "/forgot-password", "/reset-password", "/verify-email", "/verify"];
    // Links from notifications and emails sign people in themselves (see DeepLink), keeping the destination.
    if (publicPaths.includes(pathname) || ["/courses/", "/quizzes/", "/assignments/"].some((p) => pathname.startsWith(p))) return;

    if (!user) {
      router.replace("/login");
      return;
    }

    if (!canAccess(user.role, pathname)) {
      router.replace(user.targetRoute || "/login");
    }
  }, [user, isLoading, pathname, router]);

  const login = useCallback(async (email: string, password: string, mfaCode?: string) => {
    try {
      const data = await api.post<{ user: ApiUser }>("/api/v1/auth/login", {
        email,
        password,
        ...(mfaCode ? { mfaCode } : {}),
      });
      const session = toSession(data.user);
      setUser(session);
      return { success: true, targetRoute: session.targetRoute };
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Unable to reach the server. Please try again.";
      // The password was right but the account needs its second factor.
      const mfaRequired = err instanceof ApiError && err.status === 401 && err.details?.mfaRequired === true;
      return { success: false, error: message, mfaRequired };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/api/v1/auth/logout");
    } finally {
      setUser(null);
      router.push("/login");
    }
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
