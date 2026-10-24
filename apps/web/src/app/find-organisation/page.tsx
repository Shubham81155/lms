'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Mail, MailCheck, Search } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BrandLogo } from '@/components/BrandLogo';
import { api, ApiError } from '@/lib/api';
import { Captcha, type CaptchaHandle } from '@/components/Captcha';
import { LanguageSwitcher, useT } from '@/lib/i18n';

const CAPTCHA_ACTION = 'find-organisation';

// "Find my organisation": every organisation has its own web address, so someone on the shared address may not
// know where to sign in. We e-mail them the sign-in links of the organisations where their address has an
// account. The answer is the same whether or not it has any, so this page never says which.

const card = 'bg-surface border border-line rounded-3xl p-6 sm:p-8 space-y-5 shadow-2xl shadow-black/20';

export default function FindOrganisationPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  // undefined while loading; null when the platform has no CAPTCHA (the API enforces it either way).
  const [captchaKey, setCaptchaKey] = useState<string | null | undefined>(undefined);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captcha = useRef<CaptchaHandle>(null);
  useEffect(() => {
    let alive = true;
    api
      .get<{ data: { siteKey: string | null } }>('/api/v1/organizations/captcha')
      .then((r) => alive && setCaptchaKey(r.data.siteKey || null))
      .catch(() => alive && setCaptchaKey(null));
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const address = email.trim();
    if (!address) {
      setError(t('find.enterEmail'));
      return;
    }
    if (captchaKey && !captchaToken) {
      setError(t('find.captcha'));
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/v1/organizations/find', { email: address, ...(captchaToken ? { captchaToken } : {}) });
      setSentTo(address);
      setCaptchaToken(null); // spent; "Try another address" shows a fresh widget
    } catch (err) {
      // A token is good for one check only.
      captcha.current?.reset();
      setCaptchaToken(null);
      if (err instanceof ApiError && err.status === 429) setError(t('find.tooMany'));
      else if (err instanceof ApiError && err.status === 400) setError(t('find.invalidEmail'));
      else setError(err instanceof ApiError ? err.message : t('find.wrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute top-24 left-1/2 -translate-x-1/2 h-[420px] w-[720px] max-w-full rounded-full bg-brand/15 blur-3xl"
      />
      <div aria-hidden="true" className="absolute bottom-0 right-0 h-[300px] w-[300px] rounded-full bg-accent/10 blur-3xl" />

      <header className="relative border-b border-line bg-canvas/80 backdrop-blur-md px-4 sm:px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <BrandLogo />
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-xs font-semibold text-ink-muted hover:text-brand-fg transition-colors">
              {t('common.signIn')}
            </Link>
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="relative flex-1 px-4 sm:px-6 py-10">
        <div className="mx-auto w-full max-w-md space-y-6">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-brand-fg">
            <ArrowLeft className="h-3.5 w-3.5" /> {t('common.backToHome')}
          </Link>

          {sentTo ? (
            <section className={card} aria-labelledby="done-h">
              <div className="mx-auto h-12 w-12 rounded-2xl bg-brand/10 border border-brand/30 text-brand-fg flex items-center justify-center">
                <MailCheck className="h-6 w-6" />
              </div>
              <div className="text-center space-y-2">
                <h1 id="done-h" className="text-2xl font-extrabold text-ink">
                  {t('find.doneTitle')}
                </h1>
                <p className="text-xs text-ink-muted">
                  {t('find.doneBefore')} <span className="font-semibold text-ink">{sentTo}</span> {t('find.doneAfter')}
                </p>
              </div>
              <p className="text-[11px] text-ink-subtle text-center">{t('find.doneHelp')}</p>
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setSentTo(null)}
                  className="px-5 py-2.5 border border-line hover:border-brand bg-canvas text-ink rounded-xl text-xs font-bold transition-colors"
                >
                  {t('find.another')}
                </button>
                <Link href="/" className="px-5 py-2.5 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold">
                  {t('common.backToHome')}
                </Link>
              </div>
            </section>
          ) : (
            <section className={card} aria-labelledby="find-h">
              <div className="space-y-2">
                <div className="h-11 w-11 rounded-2xl bg-brand/10 border border-brand/20 text-brand-fg flex items-center justify-center">
                  <Search className="h-5 w-5" />
                </div>
                <h1 id="find-h" className="text-2xl font-extrabold text-ink">
                  {t('find.title')}
                </h1>
                <p className="text-xs text-ink-muted leading-relaxed">{t('find.intro')}</p>
              </div>

              {error && (
                <div
                  role="alert"
                  className="p-3.5 bg-danger/10 border border-danger/30 rounded-2xl flex items-start gap-2.5 text-xs text-danger"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="find-email" className="block text-xs font-semibold text-ink">
                    {t('find.email')}
                  </label>
                  <div className="relative">
                    <Mail className="h-4 w-4 text-ink-subtle absolute left-3.5 top-3" aria-hidden="true" />
                    <input
                      id="find-email"
                      type="email"
                      required
                      maxLength={254}
                      autoComplete="email"
                      placeholder={t('common.emailPlaceholder')}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-canvas border border-line rounded-xl pl-10 pr-4 py-2.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors"
                    />
                  </div>
                </div>
                <Captcha ref={captcha} siteKey={captchaKey} action={CAPTCHA_ACTION} onToken={setCaptchaToken} />
                <button
                  type="submit"
                  disabled={busy || captchaKey === undefined || (!!captchaKey && !captchaToken)}
                  className="w-full py-3 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold shadow-lg shadow-brand/25 transition-all"
                >
                  {busy ? t('find.sending') : t('find.submit')}
                </button>
              </form>

              <p className="text-center text-[11px] text-ink-muted">
                {t('find.notOnPlatform')}{' '}
                <Link href="/register" className="font-semibold text-brand-fg hover:underline underline-offset-2">
                  {t('common.registerOrganisation')}
                </Link>
              </p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
