'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Lock, Mail, ArrowRight, ArrowLeft, AlertCircle, KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BrandLogo } from '@/components/BrandLogo';
import { api, ApiError } from '@/lib/api';
import { isOwnSubdomain } from '@/lib/org-address';
import { safeNextPath } from '@/lib/safe-redirect';
import { LanguageSwitcher, useT } from '@/lib/i18n';

// Error codes the API puts in /login?error= after a failed single sign-on round trip (messages: login.error.<code>).
const SSO_ERROR_CODES = ['sso_failed', 'sso_unavailable'] as const;

const DEMO_USERS = [
  {
    roleName: 'Platform Admin',
    email: 'platform@gurugyan.com',
    roleTag: 'Super Admin',
  },
  {
    roleName: 'Institution Admin',
    email: 'admin@gurugyan.edu',
    roleTag: 'Admin',
  },
  {
    roleName: 'Teacher',
    email: 'teacher@gurugyan.edu',
    roleTag: 'Faculty',
  },
  {
    roleName: 'Student',
    email: 'student@gurugyan.edu',
    roleTag: 'Learner',
  },
];

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const t = useT();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
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
      .get<{ enabled: boolean; oidc?: boolean; saml?: boolean }>('/api/v1/auth/sso/status')
      .then((r) => alive && setSso({ oidc: !!r.oidc, saml: !!r.saml }))
      .catch(() => alive && setSso({ oidc: false, saml: false }));
    api
      .get<{ slug: string }>('/api/v1/tenant/config')
      .then((r) => {
        if (!alive) return;
        setNoOrganisation(false);
        setSharedAddress(!isOwnSubdomain(window.location.hostname, r.slug));
      })
      .catch((e) => {
        if (!alive || !(e instanceof ApiError)) return;
        setNoOrganisation(e.status === 404);
        setSuspended(e.status === 403 && e.details?.code === 'TENANT_SUSPENDED');
      });
    return () => {
      alive = false;
    };
  }, []);

  const callbackError = searchParams.get('error');
  useEffect(() => {
    if (callbackError && (SSO_ERROR_CODES as readonly string[]).includes(callbackError))
      setErrorMsg(t.dyn(`login.error.${callbackError}`, callbackError));
  }, [callbackError, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!email || !password) {
      setErrorMsg(t('login.enterCredentials'));
      return;
    }

    setIsSubmitting(true);
    const result = await login(email, password, needsMfa ? mfaCode.trim() : undefined);

    if (result.success && result.targetRoute) {
      // Only follow same-site relative paths from ?next= (browsers read "/\evil.com" and "/<TAB>/evil.com" as off-site)
      router.push(safeNextPath(searchParams.get('next')) ?? result.targetRoute);
    } else if (result.mfaRequired) {
      // Either the code is still needed or the one entered was wrong; the server's message says which.
      setNeedsMfa(true);
      setMfaCode('');
      setErrorMsg(needsMfa ? result.error || t('login.codeRejected') : null);
      setIsSubmitting(false);
    } else {
      setNeedsMfa(false);
      setErrorMsg(result.error || t('login.failed'));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute top-24 left-1/2 -translate-x-1/2 h-[420px] w-[720px] max-w-full rounded-full bg-brand/15 blur-3xl"
      />
      <div aria-hidden="true" className="absolute bottom-0 right-0 h-[300px] w-[300px] rounded-full bg-accent/10 blur-3xl" />

      {/* Top Header */}
      <header className="relative border-b border-line bg-canvas/80 backdrop-blur-md px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted hover:text-brand-fg transition-colors p-1.5 -ml-1.5 rounded-lg hover:bg-raised"
              title={t('common.backToHome')}
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">{t('common.backToHome')}</span>
            </Link>
            <div className="h-4 w-px bg-line hidden sm:block" />
            <BrandLogo />
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Login Box */}
      <main className="relative flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md space-y-3">
          <div className="w-full bg-surface border border-line rounded-3xl p-8 space-y-6 shadow-2xl shadow-black/20">
          <div className="text-center space-y-2">
            <div className="mx-auto h-11 w-11 rounded-2xl bg-brand/10 border border-brand/20 text-brand-fg flex items-center justify-center">
              <Lock className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-extrabold text-ink">{t('login.title')}</h1>
            <p className="text-xs text-ink-muted">{t('login.subtitle')}</p>
          </div>

          {noOrganisation && (
            <div role="status" className="p-3.5 bg-accent/10 border border-accent/30 rounded-2xl flex items-start gap-2.5 text-xs text-ink">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-accent" />
              <span>
                {t('login.noOrganisationBefore')}{' '}
                <Link href="/find-organisation" className="font-semibold text-brand-fg hover:underline underline-offset-2">
                  {t('login.noOrganisationLink')}
                </Link>
                {t('login.noOrganisationAfter')}
              </span>
            </div>
          )}

          {suspended && (
            <div
              role="status"
              className="p-3.5 bg-danger/10 border border-danger/30 rounded-2xl flex items-start gap-2.5 text-xs text-danger"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{t('login.suspended')}</span>
            </div>
          )}

          {/* Error Banner */}
          {errorMsg && (
            <div
              role="alert"
              className="p-3.5 bg-danger/10 border border-danger/30 rounded-2xl flex items-start gap-2.5 text-xs text-danger animate-fadeIn"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Quick Demo Credentials */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-ink-muted">
              <span className="font-semibold uppercase tracking-wider">Quick Select Demo Role</span>
              <span className="text-[10px] font-mono bg-raised px-1.5 py-0.5 rounded border border-line text-brand-fg">Password123!</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_USERS.map((demo) => {
                const isSelected = email === demo.email;
                return (
                  <button
                    key={demo.email}
                    type="button"
                    onClick={() => {
                      setEmail(demo.email);
                      setPassword('Password123!');
                      setErrorMsg(null);
                    }}
                    className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between gap-1 text-xs ${
                      isSelected
                        ? 'border-brand bg-brand/10 text-brand-fg shadow-sm'
                        : 'border-line hover:border-brand/40 bg-canvas hover:bg-raised text-ink'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-bold text-[11px] leading-tight truncate">{demo.roleName}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-raised text-ink-muted border border-line font-medium shrink-0">
                        {demo.roleTag}
                      </span>
                    </div>
                    <span className="text-[10px] text-ink-muted truncate font-mono">{demo.email}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Credentials Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="text-xs font-semibold text-ink">
                {t('login.email')}
              </label>
              <div className="relative">
                <Mail className="h-4 w-4 text-ink-subtle absolute left-3.5 top-3" />
                <input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="username"
                  placeholder={t('common.emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-canvas border border-line rounded-xl pl-10 pr-4 py-2.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="login-password" className="text-xs font-semibold text-ink">
                  {t('login.password')}
                </label>
                <Link href="/forgot-password" className="text-[11px] text-brand-fg hover:underline underline-offset-2 transition-colors">
                  {t('login.forgot')}
                </Link>
              </div>
              <div className="relative">
                <Lock className="h-4 w-4 text-ink-subtle absolute left-3.5 top-3" />
                <input
                  id="login-password"
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
                  {t('login.mfaCode')}
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
                    placeholder={t('login.mfaPlaceholder')}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    className="w-full bg-canvas border border-line rounded-xl pl-10 pr-4 py-2.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors"
                  />
                </div>
                <p className="text-[11px] text-ink-subtle">{t('login.mfaHelp')}</p>
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
                <span>{t('login.remember')}</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-brand/25 transition-all"
            >
              {isSubmitting ? (
                <span>{t('login.submitting')}</span>
              ) : (
                <>
                  <span>{t('login.submit')}</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          {(sso.oidc || sso.saml) && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-[11px] text-ink-subtle">
                <span className="h-px flex-1 bg-line" />
                <span>{t('common.or')}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              {/* A full-page navigation: the identity provider redirects back to the API callback. */}
              {[
                { on: sso.oidc, href: '/api/v1/auth/sso/start', label: t('login.sso') },
                { on: sso.saml, href: '/api/v1/auth/saml/start', label: sso.oidc ? t('login.saml') : t('login.sso') },
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
              {t('login.newOrganisation')}{' '}
              <Link href="/register" className="font-semibold text-brand-fg hover:underline underline-offset-2">
                {t('common.registerOrganisation')}
              </Link>
            </p>
            {sharedAddress && (
              <p>
                <Link href="/find-organisation" className="text-brand-fg hover:underline underline-offset-2">
                  {t('login.cantFindAddress')}
                </Link>
              </p>
            )}
            <p>
              <Link href="/privacy" className="text-ink-muted hover:text-ink hover:underline underline-offset-2">
                Privacy notice
              </Link>
            </p>
          </div>
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
