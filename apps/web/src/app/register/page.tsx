'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Building2 } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageSwitcher, useT } from '@/lib/i18n';
import { BrandLogo } from '@/components/BrandLogo';
import { Captcha, type CaptchaHandle } from '@/components/Captcha';
import { api, ApiError } from '@/lib/api';
import { guessOrgUrl, isOrgSlug, suggestSlug } from '@/lib/org-address';
import { orgNameProblem, personNameProblem } from '@/lib/platform';
import { Button, Input, Select, Textarea, cardClasses } from '@/components/ui';
import { AvailabilityIndicator } from '@/components/register/AvailabilityIndicator';
import { ConfirmEmailView } from '@/components/register/ConfirmEmailView';
import { SubmittedView } from '@/components/register/SubmittedView';
import { CAPTCHA_ACTION, Field, msgText, problemMsg, REASON_TEXT, TYPES, type Availability, type Msg } from '@/components/register/shared';

// Public request to bring a new organisation onto the platform. The applicant first confirms their e-mail
// address with the link we send (it comes back here as ?confirm=); only then does the platform team see the
// request. On approval the contact person gets an e-mail to choose a password and becomes the organisation's
// first administrator.

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

  // The organisation's own address once approved: as the API reports it, else the slug in front of this host.
  const futureUrl = isOrgSlug(slug)
    ? (availability.state === 'available' && availability.url) ||
      (typeof window !== 'undefined' ? guessOrgUrl(slug, window.location.origin) : null)
    : null;

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
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {t('common.backToHome')}
          </Link>

          {confirmToken ? (
            <ConfirmEmailView token={confirmToken} onRestart={() => setConfirmToken(null)} />
          ) : sentTo ? (
            <SubmittedView sentTo={sentTo} confirmBy={confirmBy} requestedUrl={requestedUrl} />
          ) : (
            <section className={cardClasses({ variant: 'elevated', padding: 'lg', className: 'space-y-6' })} aria-labelledby="register-h">
              <div className="space-y-2">
                <div className="h-11 w-11 rounded-2xl bg-brand/10 border border-brand/20 text-brand-fg flex items-center justify-center">
                  <Building2 className="h-5 w-5" aria-hidden="true" />
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
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{msgText(t, error)}</span>
                </div>
              )}

              <form onSubmit={submit} className="space-y-6">
                <fieldset className="space-y-4">
                  <legend className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{t('site.reg.org.legend')}</legend>
                  <Field id="org-name" text={t('site.reg.org.name')}>
                    <Input
                      id="org-name"
                      size="lg"
                      required
                      maxLength={120}
                      autoComplete="organization"
                      placeholder={t('site.reg.org.namePlaceholder')}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                  <Field
                    id="org-slug"
                    text={t('site.reg.org.slug')}
                    hint={
                      <span aria-live="polite">
                        <AvailabilityIndicator availability={availability} futureUrl={futureUrl} />
                      </span>
                    }
                  >
                    <Input
                      id="org-slug"
                      size="lg"
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
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="org-type" text={t('site.reg.org.type')}>
                      <Select id="org-type" size="lg" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                        {TYPES.map((o) => (
                          <option key={o.value} value={o.value}>
                            {t(o.label)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field id="org-country" text={t('site.reg.org.country')} optional>
                      <Input
                        id="org-country"
                        size="lg"
                        maxLength={80}
                        autoComplete="country-name"
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                      />
                    </Field>
                    <Field id="org-website" text={t('site.reg.org.website')} optional>
                      <Input
                        id="org-website"
                        type="url"
                        inputMode="url"
                        size="lg"
                        maxLength={300}
                        placeholder="https://www.example.edu"
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                      />
                    </Field>
                    <Field id="org-learners" text={t('site.reg.org.learners')} optional>
                      <Input
                        id="org-learners"
                        type="number"
                        min={1}
                        max={10000000}
                        step={1}
                        inputMode="numeric"
                        size="lg"
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
                      <Input
                        id="c-first"
                        size="lg"
                        required
                        maxLength={100}
                        autoComplete="given-name"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                      />
                    </Field>
                    <Field id="c-last" text={t('site.reg.contact.last')}>
                      <Input
                        id="c-last"
                        size="lg"
                        required
                        maxLength={100}
                        autoComplete="family-name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                      />
                    </Field>
                    <Field id="c-email" text={t('site.reg.contact.email')} hint={t('site.reg.contact.emailHint')}>
                      <Input
                        id="c-email"
                        type="email"
                        size="lg"
                        required
                        maxLength={254}
                        autoComplete="email"
                        aria-describedby="c-email-hint"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </Field>
                    <Field id="c-phone" text={t('site.reg.contact.phone')} optional>
                      <Input
                        id="c-phone"
                        type="tel"
                        size="lg"
                        maxLength={40}
                        autoComplete="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field id="c-message" text={t('site.reg.contact.message')} optional>
                    <Textarea
                      id="c-message"
                      size="lg"
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

                <Button
                  type="submit"
                  size="lg"
                  fullWidth
                  disabled={
                    busy || !terms || availability.state === 'checking' || captchaKey === undefined || (!!captchaKey && !captchaToken)
                  }
                  className="py-3 shadow-lg shadow-brand/25"
                >
                  {busy ? t('site.reg.sending') : t('site.reg.submit')}
                </Button>
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
