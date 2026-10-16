import { NextRequest, NextResponse } from "next/server";
import { canAccess, routeForRole } from "@/lib/roles";

const API_URL = (process.env.API_URL || "http://localhost:4000").replace(/\/+$/, "");

/**
 * Server-side route protection. The session is validated by the API itself (/auth/me), which
 * also rejects accounts that were locked or suspended after the token was issued. If the API
 * cannot be reached the request is treated as unauthenticated (fail closed).
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const cookie = req.headers.get("cookie") ?? "";

  let role: string | null = null;
  if (cookie.includes("lms_token=")) {
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/me`, {
        headers: { cookie },
        cache: "no-store",
      });
      if (res.ok) role = (await res.json())?.user?.role ?? null;
    } catch {
      role = null;
    }
  }

  if (!role) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (!canAccess(role, pathname)) {
    return NextResponse.redirect(new URL(routeForRole(role), req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/student/:path*", "/teacher/:path*", "/admin/:path*", "/audit/:path*"],
};
