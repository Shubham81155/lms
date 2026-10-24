'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Building2, CheckCircle2, Loader2, MailCheck, XCircle } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageSwitcher, useT, type Translator } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n-core';
import { BrandLogo } from '@/components/BrandLogo';
import { Captcha, type CaptchaHandle } from '@/components/Captcha';
import { api, ApiError } from '@/lib/api';
import { displayAddress, guessOrgUrl, isOrgSlug, suggestSlug } from '@/lib/org-address';
import { orgNameProblem, personNameProblem, platformMessageKey } from '@/lib/platform';

// Public request to bring a new organisation onto the platform. The applicant first confirms their e-mail
// address with the link we send (it comes back here as ?confirm=); only then does the platform team see the
// request. On approval the contact person gets an e-mail to choose a password and becomes the organisation's
// first administrator.

const TYPES = [
  { value: 'UNIVERSITY', label: 'site.reg.type.UNIVERSITY' },
  { value: 'COLLEGE', label: 'site.reg.type.COLLEGE' },
  { value: 'SCHOOL', label: 'site.reg.type.SCHOOL' },
  { value: 'TRAINING_PROVIDER', label: 'site.reg.type.TRAINING_PROVIDER' },
  { value: 'COMPANY', label: 'site.reg.type.COMPANY' },
  { value: 'OTHER', label: 'site.reg.type.OTHER' },
] as const satisfies readonly { value: string; label: MessageKey }[];

/** A message shown to the person: a catalogue key (translated when drawn) or text the API sent. */
type Msg = { key: MessageKey } | { text: string };
const msgText = (t: Translator, m: Msg) => ('key' in m ? t(m.key) : m.text);

// The shared validators in lib/platform.ts return English; platformMessageKey maps them to their keys.
const problemMsg = (text: string): Msg => {
  const key = platformMessageKey(text);
  return key ? { key } : { text };
};

/** Puts an element where a message has its {slot} (messages cannot hold elements). */
const SLOT = '@@slot@@';
const withSlot = (text: string, node: React.ReactNode) => {
  const [before, after = ''] = text.split(SLOT);
  return (
    <>
      {before}
      {node}
      {after}
    </>
  );
};

type Availability =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; url?: string }
  | { state: 'unavailable'; reason: 'invalid' | 'reserved' | 'taken' | 'pending' }
  | { state: 'error' };

/** The widget action the API expects for this form (ORG_REQUEST_CAPTCHA_ACTION). */
const CAPTCHA_ACTION = 'org-request';

const REASON_TEXT: Record<'invalid' | 'reserved' | 'taken' | 'pending', MessageKey> = {
  invalid: 'site.reg.slug.reason.invalid',
  reserved: 'site.reg.slug.reason.reserved',
  taken: 'site.reg.slug.reason.taken',
  pending: 'site.reg.slug.reason.pending',
};

const input =
  'w-full bg-canvas border border-line rounded-xl px-3.5 py-2.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors';
const label = 'block text-xs font-semibold text-ink';

const Field: React.FC<{
  id: string;
  text: string;
  optional?: boolean;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ id, text, optional, hint, className, children }) => {
  const t = useT();
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <label htmlFor={id} className={label}>
        {text} {optional && <span className="font-normal text-ink-subtle">{t('site.reg.optional')}</span>}
      </label>
      {children}
      {hint && (
        <div id={`${id}-hint`} className="text-[11px] text-ink-subtle">
          {hint}
        </div>
      )}
    </div>
  );
};

type Confirmation =
  | { state: 'working' }
  | { state: 'done'; status: 'PENDING' | 'APPROVED' | 'REJECTED'; organizationName: string; contactEmail: string; url: string }
  | { state: 'error'; message: Msg };

const Steps: React.FC<{ email: string; url: string | null }> = ({ email, url }) => {
  const t = useT();
  return (
    <ol className="space-y-3 text-xs text-ink-muted">
      <li className="flex gap-3">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[11px] font-bold text-brand-fg">
          1
        </span>
        {t('site.reg.step1')}
      </li>
      <li className="flex gap-3">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[11px] font-bold text-brand-fg">
          2
        </span>
        {t('site.reg.step2', { email })}
      </li>
      <li className="flex gap-3">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[11px] font-bold text-brand-fg">
          3
        </span>
        {withSlot(
          t('site.reg.step3', { address: SLOT }),
          url ? <span className="font-mono text-ink">{displayAddress(url)}</span> : t('site.reg.step3.fallback')
        )}
      </li>
    </ol>
  );
};

const card = 'bg-surface border border-line rounded-3xl p-6 sm:p-8 space-y-5 shadow-2xl shadow-black/20';

/** What the confirmation link opens: confirms the request and says what happens next. */
const ConfirmRequest: React.FC<{ token: string; onRestart: () => void }> = ({ token, onRestart }) => {
  const t = useT();
  const [result, setResult] = useState<Confirmation>({ state: 'working' });
  useEffect(() => {
    let alive = true;
    api
      .post<{ data: { status: 'PENDING' | 'APPROVED' | 'REJECTED'; organizationName: string; contactEmail: string; url: string } }>(
        '/api/v1/organizations/requests/confirm',
        { token }
      )
      .then((r) => alive && setResult({ state: 'done', ...r.data }))
      .catch((err) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 429) setResult({ state: 'error', message: { key: 'site.reg.confirm.tooMany' } });
        else
          setResult({
            state: 'error',
            message: err instanceof ApiError ? { text: err.message } : { key: 'site.reg.confirm.wrong' },
          });
      });
    return () => {
      alive = false;
    };
  }, [token]);

  if (result.state === 'working') {
    return (
      <section className={card} aria-busy="true">
        <p className="flex items-center justify-center gap-2 text-xs text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t('site.reg.confirm.working')}
        </p>
      </section>
    );
  }
  if (result.state === 'error') {
    return (
      <section className={card} aria-labelledby="confirm-h">
        <div className="mx-auto h-12 w-12 rounded-2xl bg-danger/10 border border-danger/30 text-danger flex items-center justify-center">
          <XCircle className="h-6 w-6" />
        </div>
        <div className="text-center space-y-2">
          <h1 id="confirm-h" className="text-2xl font-extrabold text-ink">
            {t('site.reg.confirm.failedTitle')}
          </h1>
          <p role="alert" className="text-xs text-ink-muted">
            {msgText(t, result.message)}
          </p>
        </div>
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onRestart}
            className="px-5 py-2.5 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold"
          >
            {t('site.reg.confirm.restart')}
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className={card} aria-labelledby="confirm-h">
      <div className="mx-auto h-12 w-12 rounded-2xl bg-success/10 border border-success/30 text-success flex items-center justify-center">
        <CheckCircle2 className="h-6 w-6" />
      </div>
      <div className="text-center space-y-2">
        <h1 id="confirm-h" className="text-2xl font-extrabold text-ink">
          {result.status === 'PENDING' ? t('site.reg.confirm.titlePending') : t('site.reg.confirm.titleDecided')}
        </h1>
        <p className="text-xs text-ink-muted">
          {result.status === 'PENDING'
            ? withSlot(
                t('site.reg.confirm.pending', { name: SLOT }),
                <span className="font-semibold text-ink">{result.organizationName}</span>
              )
            : result.status === 'APPROVED'
              ? t('site.reg.confirm.approved', { name: result.organizationName, email: result.contactEmail })
              : t('site.reg.confirm.rejected', { email: result.contactEmail })}
        </p>
        <p className="text-xs text-ink-muted">
          {withSlot(
            t('site.reg.sent.requested', { address: SLOT }),
            <span className="font-mono font-semibold text-ink">{displayAddress(result.url)}</span>
          )}
        </p>
      </div>
      {result.status === 'PENDING' && <Steps email={result.contactEmail} url={result.url} />}
      {result.status === 'PENDING' && <p className="text-[11px] text-ink-subtle text-center">{t('site.reg.confirm.declined')}</p>}
      <div className="flex justify-center">
        <Link href="/" className="px-5 py-2.5 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold">
          {t('common.backToHome')}
        </Link>
      </div>
    </section>
  );
};

export default function RegisterOrganisationPage() {
  const t = useT();
  // The confirmation link: read once, then taken out of the address bar so it does not stay in the history.
  const [confirmToken, setConfirmToken] = useState<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('confirm');
    if (!token) return;
    setConfirmToken(token);
    url.searchParams.delete('confirm');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, []);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [type, setType] = useState<(typeof TYPES)[number]['value']>('UNIVERSITY');
  const [country, setCountry] = useState('');
  const [website, setWebsite] = useState('');
  const [learners, setLearners] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [terms, setTerms] = useState(false);
  const [availability, setAvailability] = useState<Availability>({ state: 'idle' });
  const [error, setError] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [confirmBy, setConfirmBy] = useState<string | null>(null);
  const [requestedUrl, setRequestedUrl] = useState<string | null>(null);
  // undefined while asking the API whether a CAPTCHA is on; null when it is off.
  const [captchaKey, setCaptchaKey] = useState<string | null | undefined>(undefined);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captcha = useRef<CaptchaHandle>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<{ data: { siteKey: string | null } }>('/api/v1/organizations/captcha')
      // Unreachable: go on without; the API refuses the request if it does want a CAPTCHA.
      .then((r) => alive && setCaptchaKey(r.data.siteKey || null))
      .catch(() => alive && setCaptchaKey(null));
    return () => {
      alive = false;
    };
  }, []);

  // The address follows the name until the person edits it themselves.
  useEffect(() => {
    if (!slugEdited) setSlug(suggestSlug(name));
  }, [name, slugEdited]);

  // Checked a moment after typing stops; a stale answer for an older value is ignored.
  useEffect(() => {
    if (!slug) {
      setAvailability({ state: 'idle' });
      return;
    }
    if (!isOrgSlug(slug)) {
      setAvailability({ state: 'unavailable', reason: 'invalid' });
      return;
    }
    let alive = true;
    setAvailability({ state: 'checking' });
    const timer = setTimeout(() => {
      api
        .get<{ data: { slug: string; available: boolean; reason?: 'invalid' | 'reserved' | 'taken' | 'pending'; url?: string } }>(
          '/api/v1/organizations/availability',
          { params: { slug } }
        )
        .then(
          (r) =>
            alive &&
            setAvailability(
              r.data.available ? { state: 'available', url: r.data.url } : { state: 'unavailable', reason: r.data.reason ?? 'taken' }
            )
        )
        .catch(() => alive && setAvailability({ state: 'error' }));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [slug]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isOrgSlug(slug)) {
      setError({ key: REASON_TEXT.invalid });
      return;
    }
    if (availability.state === 'unavailable') {
      setError({ key: REASON_TEXT[availability.reason] });
      return;
    }
    const nameIssue = orgNameProblem(name) ?? personNameProblem(firstName) ?? personNameProblem(lastName);
    if (nameIssue) {
      setError(problemMsg(nameIssue));
      return;
    }
    if (website.trim() && !/^https:\/\/\S+\.\S+/.test(website.trim())) {
      setError({ key: 'site.reg.err.website' });
      return;
    }
    const expected = learners.trim() ? Number(learners) : undefined;
    if (expected !== undefined && (!Number.isInteger(expected) || expected < 1)) {
      setError({ key: 'site.reg.err.learners' });
      return;
    }
    if (captchaKey && !captchaToken) {
      setError({ key: 'site.reg.err.captcha' });
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<{ data: { status: string; slug: string; contactEmail: string; url?: string; confirmBy?: string } }>(
        '/api/v1/organizations/requests',
        {
          organizationName: name.trim(),
          slug,
          institutionType: type,
          ...(country.trim() ? { country: country.trim() } : {}),
          ...(website.trim() ? { website: website.trim() } : {}),
          ...(expected !== undefined ? { expectedLearners: expected } : {}),
          contactFirstName: firstName.trim(),
          contactLastName: lastName.trim(),
          contactEmail: email.trim(),
          ...(phone.trim() ? { contactPhone: phone.trim() } : {}),
          ...(message.trim() ? { message: message.trim() } : {}),
          acceptTerms: true,
          ...(captchaToken ? { captchaToken } : {}),
        }
      );
      setRequestedUrl(r.data.url ?? futureUrl);
      setSentTo(r.data.contactEmail || email.trim());
      setConfirmBy(r.data.confirmBy ?? null);
      window.scrollTo({ top: 0 });
    } catch (err) {
      // The token has been spent either way; a new attempt needs a fresh one.
      captcha.current?.reset();
      if (err instanceof ApiError && err.status === 409) {
        setError({ key: 'site.reg.err.conflict' });
        setAvailability({ state: 'unavailable', reason: 'taken' });
      } else if (err instanceof ApiError && err.status === 403) {
        setError({ key: 'site.reg.err.closed' });
      } else if (err instanceof ApiError && err.status === 429) {
        // Either this network's limit or this e-mail address's open requests; the API says which.
        setError(err.message ? { text: err.message } : { key: 'site.reg.err.tooMany' });
      } else {
        setError(err instanceof ApiError ? { text: err.message } : { key: 'site.reg.err.wrong' });
      }
    } finally {
      setBusy(false);
    }
  };

  // The organisation's own address once approved: as the API reports it, else the slug in front of this host.
  const futureUrl = isOrgSlug(slug)
    ? (availability.state === 'available' && availability.url) ||
      (typeof window !== 'undefined' ? guessOrgUrl(slug, window.location.origin) : null)
    : null;

  const slugStatus = (() => {
    switch (availability.state) {
      case 'checking':
        return (
          <span className="inline-flex items-center gap-1 text-ink-subtle">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> {t('site.reg.slug.checking')}
          </span>
        );
      case 'available':
        return (
          <span className="inline-flex flex-wrap items-center gap-1 text-success">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {t('site.reg.slug.available')}
            {futureUrl && (
              <span className="text-ink-muted">
                {withSlot(
                  t('site.reg.slug.willBe', { address: SLOT }),
                  <span className="font-mono font-semibold text-ink">{displayAddress(futureUrl)}</span>
                )}
              </span>
            )}
          </span>
        );
      case 'unavailable':
        return (
          <span className="inline-flex items-center gap-1 text-danger">
            <XCircle className="h-3 w-3" aria-hidden="true" /> {t(REASON_TEXT[availability.reason])}
          </span>
        );
      case 'error':
        return <span className="text-ink-subtle">{t('site.reg.slug.error')}</span>;
      default:
        return <span>{t('site.reg.slug.help')}</span>;
    }
  })();

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
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-brand-fg">
            <ArrowLeft className="h-3.5 w-3.5" /> {t('common.backToHome')}
          </Link>

          {confirmToken ? (
            <ConfirmRequest token={confirmToken} onRestart={() => setConfirmToken(null)} />
          ) : sentTo ? (
            <section className={card} aria-labelledby="done-h">
              <div className="mx-auto h-12 w-12 rounded-2xl bg-brand/10 border border-brand/30 text-brand-fg flex items-center justify-center">
                <MailCheck className="h-6 w-6" />
              </div>
              <div className="text-center space-y-2">
                <h1 id="done-h" className="text-2xl font-extrabold text-ink">
                  {t('site.reg.sent.title')}
                </h1>
                <p className="text-xs text-ink-muted">
                  {withSlot(
                    confirmBy
                      ? t('site.reg.sent.bodyBy', {
                          email: SLOT,
                          when: t.date(confirmBy, { dateStyle: 'medium', timeStyle: 'short' }),
                        })
                      : t('site.reg.sent.bodyWithin', { email: SLOT }),
                    <span className="font-semibold text-ink">{sentTo}</span>
                  )}
                </p>
                {requestedUrl && (
                  <p className="text-xs text-ink-muted">
                    {withSlot(
                      t('site.reg.sent.requested', { address: SLOT }),
                      <span className="font-mono font-semibold text-ink">{displayAddress(requestedUrl)}</span>
                    )}
                  </p>
                )}
              </div>
              <p className="text-[11px] text-ink-subtle text-center">{t('site.reg.sent.noEmail')}</p>
              <div className="flex justify-center">
                <Link href="/" className="px-5 py-2.5 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold">
                  {t('common.backToHome')}
                </Link>
              </div>
            </section>
          ) : (
            <section
              className="bg-surface border border-line rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl shadow-black/20"
              aria-labelledby="register-h"
            >
              <div className="space-y-2">
                <div className="h-11 w-11 rounded-2xl bg-brand/10 border border-brand/20 text-brand-fg flex items-center justify-center">
                  <Building2 className="h-5 w-5" />
                </div>
                <h1 id="register-h" className="text-2xl font-extrabold text-ink">
                  {t('site.reg.title')}
                </h1>
                <p className="text-xs text-ink-muted leading-relaxed">{t('site.reg.intro')}</p>
              </div>

              {error && (
                <div
                  role="alert"
                  className="p-3.5 bg-danger/10 border border-danger/30 rounded-2xl flex items-start gap-2.5 text-xs text-danger"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{msgText(t, error)}</span>
                </div>
              )}

              <form onSubmit={submit} className="space-y-6">
                <fieldset className="space-y-4">
                  <legend className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{t('site.reg.org.legend')}</legend>
                  <Field id="org-name" text={t('site.reg.org.name')}>
                    <input
                      id="org-name"
                      className={input}
                      required
                      maxLength={120}
                      autoComplete="organization"
                      placeholder={t('site.reg.org.namePlaceholder')}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                  <Field id="org-slug" text={t('site.reg.org.slug')} hint={<span aria-live="polite">{slugStatus}</span>}>
                    <div className="flex items-stretch overflow-hidden rounded-xl border border-line bg-canvas focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
                      <input
                        id="org-slug"
                        required
                        maxLength={40}
                        autoCapitalize="none"
                        spellCheck={false}
                        aria-describedby="org-slug-hint"
                        aria-invalid={availability.state === 'unavailable'}
                        placeholder="st-marys"
                        value={slug}
                        onChange={(e) => {
                          setSlugEdited(true);
                          setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'));
                        }}
                        className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none"
                      />
                    </div>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="org-type" text={t('site.reg.org.type')}>
                      <select id="org-type" className={input} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                        {TYPES.map((o) => (
                          <option key={o.value} value={o.value}>
                            {t(o.label)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field id="org-country" text={t('site.reg.org.country')} optional>
                      <input
                        id="org-country"
                        className={input}
                        maxLength={80}
                        autoComplete="country-name"
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                      />
                    </Field>
                    <Field id="org-website" text={t('site.reg.org.website')} optional>
                      <input
                        id="org-website"
                        type="url"
                        inputMode="url"
                        className={input}
                        maxLength={300}
                        placeholder="https://www.example.edu"
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                      />
                    </Field>
                    <Field id="org-learners" text={t('site.reg.org.learners')} optional>
                      <input
                        id="org-learners"
                        type="number"
                        min={1}
                        max={10000000}
                        step={1}
                        inputMode="numeric"
                        className={input}
                        value={learners}
                        onChange={(e) => setLearners(e.target.value)}
                      />
                    </Field>
                  </div>
                </fieldset>

                <fieldset className="space-y-4">
                  <legend className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                    {t('site.reg.contact.legend')}
                  </legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="c-first" text={t('site.reg.contact.first')}>
                      <input
                        id="c-first"
                        className={input}
                        required
                        maxLength={100}
                        autoComplete="given-name"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                      />
                    </Field>
                    <Field id="c-last" text={t('site.reg.contact.last')}>
                      <input
                        id="c-last"
                        className={input}
                        required
                        maxLength={100}
                        autoComplete="family-name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                      />
                    </Field>
                    <Field id="c-email" text={t('site.reg.contact.email')} hint={t('site.reg.contact.emailHint')}>
                      <input
                        id="c-email"
                        type="email"
                        className={input}
                        required
                        maxLength={254}
                        autoComplete="email"
                        aria-describedby="c-email-hint"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </Field>
                    <Field id="c-phone" text={t('site.reg.contact.phone')} optional>
                      <input
                        id="c-phone"
                        type="tel"
                        className={input}
                        maxLength={40}
                        autoComplete="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field id="c-message" text={t('site.reg.contact.message')} optional>
                    <textarea
                      id="c-message"
                      className={input}
                      rows={3}
                      maxLength={2000}
                      placeholder={t('site.reg.contact.messagePlaceholder')}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                  </Field>
                </fieldset>

                <label className="flex items-start gap-2.5 text-xs text-ink-muted cursor-pointer">
                  <input
                    type="checkbox"
                    required
                    checked={terms}
                    onChange={(e) => setTerms(e.target.checked)}
                    className="mt-0.5 rounded border-line accent-brand"
                  />
                  <span>{t('site.reg.terms')}</span>
                </label>

                <Captcha ref={captcha} siteKey={captchaKey} action={CAPTCHA_ACTION} onToken={setCaptchaToken} />

                <button
                  type="submit"
                  disabled={
                    busy || !terms || availability.state === 'checking' || captchaKey === undefined || (!!captchaKey && !captchaToken)
                  }
                  className="w-full py-3 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold shadow-lg shadow-brand/25 transition-all"
                >
                  {busy ? t('site.reg.sending') : t('site.reg.submit')}
                </button>
                <p className="text-center text-[11px] text-ink-muted">
                  {t('site.reg.already')}{' '}
                  <Link href="/login" className="font-semibold text-brand-fg hover:underline underline-offset-2">
                    {t('common.signIn')}
                  </Link>
                </p>
              </form>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
