"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  GraduationCap,
  Lock,
  Mail,
  ArrowRight,
  AlertCircle,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { api } from "@/lib/api";

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

  // Offer single sign-on only when this organisation has it switched on.
  useEffect(() => {
    let alive = true;
    api
      .get<{ enabled: boolean; oidc?: boolean; saml?: boolean }>("/api/v1/auth/sso/status")
      .then((r) => alive && setSso({ oidc: !!r.oidc, saml: !!r.saml }))
      .catch(() => alive && setSso({ oidc: false, saml: false }));
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 font-bold text-lg text-white">
            <div className="h-9 w-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="leading-tight">
                Apex<span className="text-blue-500">LMS</span>
              </span>
              <span className="text-[10px] text-slate-400 font-normal">Enterprise Education</span>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Login Box */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 space-y-6 shadow-2xl">
          <div className="text-center space-y-1.5">
            <h1 className="text-2xl font-extrabold text-white">Sign In</h1>
            <p className="text-xs text-slate-400">
              Enter your institutional credentials to access your portal.
            </p>
          </div>

          {/* Error Banner */}
          {errorMsg && (
            <div className="p-3.5 bg-rose-950/50 border border-rose-800/80 rounded-2xl flex items-start gap-2.5 text-xs text-rose-300 animate-fadeIn">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Credentials Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Institutional Email
              </label>
              <div className="relative">
                <Mail className="h-4 w-4 text-slate-500 absolute left-3.5 top-3" />
                <input
                  type="email"
                  required
                  placeholder="e.g. name@university.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300">Password</label>
                <Link
                  href="/forgot-password"
                  className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="h-4 w-4 text-slate-500 absolute left-3.5 top-3" />
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            {needsMfa && (
              <div className="space-y-1.5">
                <label htmlFor="mfa-code" className="text-xs font-semibold text-slate-300">
                  Authentication code
                </label>
                <div className="relative">
                  <ShieldCheck className="h-4 w-4 text-slate-500 absolute left-3.5 top-3" />
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
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  Open your authenticator app, or enter one of your single-use recovery codes.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-slate-400">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-950 text-blue-600 focus:ring-blue-500"
                />
                <span>Remember this workstation</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 transition-all"
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
              <div className="flex items-center gap-3 text-[11px] text-slate-500">
                <span className="h-px flex-1 bg-slate-800" />
                <span>or</span>
                <span className="h-px flex-1 bg-slate-800" />
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
                    className="w-full py-3 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all"
                  >
                    <KeyRound className="h-4 w-4 text-blue-400" />
                    <span>{m.label}</span>
                  </a>
                ))}
            </div>
          )}
        </div>
      </main>

      <div />
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
