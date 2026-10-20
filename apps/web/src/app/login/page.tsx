"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Lock,
  Mail,
  ArrowRight,
  AlertCircle,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandLogo } from "@/components/BrandLogo";
import { api, ApiError } from "@/lib/api";
import { isOwnSubdomain } from "@/lib/org-address";

// Error codes the API puts in /login?error= after a failed single sign-on round trip.
const SSO_ERRORS: Record<string, string> = {
  sso_failed: "Single sign-on failed. Your account may not be set up for this organisation, or the sign-in expired. Try again or use your password.",
  sso_unavailable: "Single sign-on is not available for this organisation.",
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [sso, setSso] = useState<{ oidc: boolean; saml: boolean }>({ oidc: false, saml: false });
  // The organisation is the one this web address belongs to (its own subdomain or custom domain); the header
  // shows its name and logo. Offer single sign-on only when it has it switched on.
  // An address that names no organisation (e.g. a mistyped subdomain) has nobody to sign in to.
  const [noOrganisation, setNoOrganisation] = useState(false);
  // A suspended organisation: nobody can sign in until the platform operator reactivates it.
  const [suspended, setSuspended] = useState(false);
  // On the shared address (not an organisation's own subdomain) people may not know where to sign in.
  const [sharedAddress, setSharedAddress] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .get<{ enabled: boolean; oidc?: boolean; saml?: boolean }>("/api/v1/auth/sso/status")
      .then((r) => alive && setSso({ oidc: !!r.oidc, saml: !!r.saml }))
      .catch(() => alive && setSso({ oidc: false, saml: false }));
    api
      .get<{ slug: string }>("/api/v1/tenant/config")
      .then((r) => {
        if (!alive) return;
        setNoOrganisation(false);
        setSharedAddress(!isOwnSubdomain(window.location.hostname, r.slug));
      })
      .catch((e) => {
        if (!alive || !(e instanceof ApiError)) return;
        setNoOrganisation(e.status === 404);
        setSuspended(e.status === 403 && e.details?.code === "TENANT_SUSPENDED");
      });
    return () => {
      alive = false;
    };
  }, []);

  const callbackError = searchParams.get("error");
  useEffect(() => {
    if (callbackError && SSO_ERRORS[callbackError]) setErrorMsg(SSO_ERRORS[callbackError]);
  }, [callbackError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!email || !password) {
      setErrorMsg("Please enter your institutional email address and password.");
      return;
    }

    setIsSubmitting(true);
    const result = await login(email, password, needsMfa ? mfaCode.trim() : undefined);

    if (result.success && result.targetRoute) {
      // Only follow same-site relative paths from ?next=
      const next = searchParams.get("next");
      router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : result.targetRoute);
    } else if (result.mfaRequired) {
      // Either the code is still needed or the one entered was wrong; the server's message says which.
      setNeedsMfa(true);
      setMfaCode("");
      setErrorMsg(needsMfa ? result.error || "That code was not accepted." : null);
      setIsSubmitting(false);
    } else {
      setNeedsMfa(false);
      setErrorMsg(result.error || "Authentication failed. Please check your credentials.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col relative overflow-hidden">
      <div aria-hidden="true" className="absolute top-24 left-1/2 -translate-x-1/2 h-[420px] w-[720px] max-w-full rounded-full bg-brand/15 blur-3xl" />
      <div aria-hidden="true" className="absolute bottom-0 right-0 h-[300px] w-[300px] rounded-full bg-accent/10 blur-3xl" />

      {/* Top Header */}
      <header className="relative border-b border-line bg-canvas/80 backdrop-blur-md px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <BrandLogo />
          <ThemeToggle />
        </div>
      </header>

      {/* Main Login Box */}
      <main className="relative flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-surface border border-line rounded-3xl p-8 space-y-6 shadow-2xl shadow-black/20">
          <div className="text-center space-y-2">
            <div className="mx-auto h-11 w-11 rounded-2xl bg-brand/10 border border-brand/20 text-brand-fg flex items-center justify-center">
              <Lock className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-extrabold text-ink">Welcome back</h1>
            <p className="text-xs text-ink-muted">
              Enter your institutional credentials to access your portal.
            </p>
          </div>

          {noOrganisation && (
            <div role="status" className="p-3.5 bg-accent/10 border border-accent/30 rounded-2xl flex items-start gap-2.5 text-xs text-ink">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-accent" />
              <span>
                No organisation uses this web address. Check the address your organisation gave you, or{" "}
                <Link href="/find-organisation" className="font-semibold text-brand-fg hover:underline underline-offset-2">
                  find my organisation
                </Link>{" "}
                by e-mail. New here? Register your organisation below.
              </span>
            </div>
          )}

          {suspended && (
            <div role="status" className="p-3.5 bg-danger/10 border border-danger/30 rounded-2xl flex items-start gap-2.5 text-xs text-danger">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>This organisation has been suspended, so nobody can sign in to it for now. Contact the platform operator.</span>
            </div>
          )}

          {/* Error Banner */}
          {errorMsg && (
            <div role="alert" className="p-3.5 bg-danger/10 border border-danger/30 rounded-2xl flex items-start gap-2.5 text-xs text-danger animate-fadeIn">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Credentials Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-ink">
                Institutional Email
              </label>
              <div className="relative">
                <Mail className="h-4 w-4 text-ink-subtle absolute left-3.5 top-3" />
                <input
                  type="email"
                  required
                  placeholder="e.g. name@university.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-canvas border border-line rounded-xl pl-10 pr-4 py-2.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-ink">Password</label>
                <Link
                  href="/forgot-password"
                  className="text-[11px] text-brand-fg hover:underline underline-offset-2 transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="h-4 w-4 text-ink-subtle absolute left-3.5 top-3" />
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-canvas border border-line rounded-xl pl-10 pr-4 py-2.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors"
                />
              </div>
            </div>

            {needsMfa && (
              <div className="space-y-1.5">
                <label htmlFor="mfa-code" className="text-xs font-semibold text-ink">
                  Authentication code
                </label>
                <div className="relative">
                  <ShieldCheck className="h-4 w-4 text-ink-subtle absolute left-3.5 top-3" />
                  <input
                    id="mfa-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    required
                    maxLength={32}
                    placeholder="6-digit code or recovery code"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    className="w-full bg-canvas border border-line rounded-xl pl-10 pr-4 py-2.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors"
                  />
                </div>
                <p className="text-[11px] text-ink-subtle">
                  Open your authenticator app, or enter one of your single-use recovery codes.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-ink-muted">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-line accent-brand"
                />
                <span>Remember this workstation</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-brand/25 transition-all"
            >
              {isSubmitting ? (
                <span>Signing In...</span>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          {(sso.oidc || sso.saml) && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-[11px] text-ink-subtle">
                <span className="h-px flex-1 bg-line" />
                <span>or</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              {/* A full-page navigation: the identity provider redirects back to the API callback. */}
              {[
                { on: sso.oidc, href: "/api/v1/auth/sso/start", label: "Sign in with single sign-on" },
                { on: sso.saml, href: "/api/v1/auth/saml/start", label: sso.oidc ? "Sign in with SAML" : "Sign in with single sign-on" },
              ]
                .filter((m) => m.on)
                .map((m) => (
                  <a
                    key={m.href}
                    href={m.href}
                    className="w-full py-3 bg-canvas hover:bg-raised border border-line text-ink rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all"
                  >
                    <KeyRound className="h-4 w-4 text-brand-fg" />
                    <span>{m.label}</span>
                  </a>
                ))}
            </div>
          )}

          <div className="space-y-1.5 text-center text-[11px]">
            <p className="text-ink-muted">
              New organisation?{" "}
              <Link href="/register" className="font-semibold text-brand-fg hover:underline underline-offset-2">
                Register your organisation
              </Link>
            </p>
            {sharedAddress && (
              <p>
                <Link href="/find-organisation" className="text-brand-fg hover:underline underline-offset-2">
                  Can&apos;t find your organisation&apos;s address?
                </Link>
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
