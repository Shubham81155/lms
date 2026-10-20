import { NextRequest, NextResponse } from "next/server";
import { canView, homeFor, type Viewer } from "@/lib/roles";

const API_URL = (process.env.API_URL || "http://localhost:4000").replace(/\/+$/, "");

/**
 * Server-side route protection. The session is validated by the API itself (/auth/me), which
 * also rejects accounts that were locked or suspended after the token was issued. If the API
 * cannot be reached the request is treated as unauthenticated (fail closed).
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const cookie = req.headers.get("cookie") ?? "";

  let viewer: Viewer | null = null;
  // The session cookie is lms_token, or __Host-lms_token in production; this matches both.
  if (cookie.includes("lms_token=")) {
    try {
      // Pass on the client address the proxy set, so the API's per-IP limits count the visitor, not this server.
      const forwardedFor = req.headers.get("x-forwarded-for");
      const res = await fetch(`${API_URL}/api/v1/auth/me`, {
        headers: { cookie, ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}) },
        cache: "no-store",
      });
      const user = res.ok ? (await res.json())?.user : null;
      if (user?.role) viewer = { role: user.role, platformOperator: user.platformOperator === true };
    } catch {
      viewer = null;
    }
  }

  if (!viewer) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  // Platform operators only use the platform console; everyone else stays out of it.
  if (!canView(viewer, pathname)) {
    return NextResponse.redirect(new URL(homeFor(viewer), req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/student/:path*", "/teacher/:path*", "/admin/:path*", "/audit/:path*", "/platform/:path*"],
};
