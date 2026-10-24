'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ShieldCheck,
  ArrowRight,
  BookOpen,
  Award,
  ClipboardCheck,
  Building2,
  Lock,
  FileSearch,
  Video,
  ScrollText,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BrandLogo } from '@/components/BrandLogo';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n-core';

const STANDARDS = ['xAPI LRS', 'LTI 1.3 Advantage', 'SCIM 2.0', 'OIDC & SAML SSO', 'FERPA', 'GDPR'];

const ROLES = [
  {
    icon: BookOpen,
    title: 'site.home.role.students.title',
    body: 'site.home.role.students.body',
    accent: 'text-brand-fg bg-brand/10 border-brand/20',
    tint: 'from-brand/15',
  },
  {
    icon: ClipboardCheck,
    title: 'site.home.role.faculty.title',
    body: 'site.home.role.faculty.body',
    accent: 'text-success bg-success/10 border-success/20',
    tint: 'from-success/15',
  },
  {
    icon: Building2,
    title: 'site.home.role.admins.title',
    body: 'site.home.role.admins.body',
    accent: 'text-accent bg-accent/10 border-accent/20',
    tint: 'from-accent/15',
  },
] satisfies { icon: typeof BookOpen; title: MessageKey; body: MessageKey; accent: string; tint: string }[];

const FEATURES = [
  { icon: BookOpen, title: 'site.home.feature.standards.title', body: 'site.home.feature.standards.body' },
  { icon: Lock, title: 'site.home.feature.isolated.title', body: 'site.home.feature.isolated.body' },
  { icon: ScrollText, title: 'site.home.feature.audit.title', body: 'site.home.feature.audit.body' },
  { icon: Award, title: 'site.home.feature.certificates.title', body: 'site.home.feature.certificates.body' },
  { icon: FileSearch, title: 'site.home.feature.integrity.title', body: 'site.home.feature.integrity.body' },
  { icon: Video, title: 'site.home.feature.live.title', body: 'site.home.feature.live.body' },
] satisfies { icon: typeof BookOpen; title: MessageKey; body: MessageKey }[];

const PRIVACY = [
  'site.home.privacy.export',
  'site.home.privacy.optOut',
  'site.home.privacy.erasure',
  'site.home.privacy.encryption',
] satisfies MessageKey[];

const GREETINGS = {
  morning: 'site.home.greeting.morning',
  afternoon: 'site.home.greeting.afternoon',
  evening: 'site.home.greeting.evening',
  welcome: 'site.home.greeting.welcome',
} satisfies Record<string, MessageKey>;

function greetingFor(hour: number): keyof typeof GREETINGS {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'welcome';
}

// Decorative product preview for the hero; not interactive.
function PortalPreview() {
  const t = useT();
  // Set after mount from the visitor's clock; the server's time zone would be wrong and would not hydrate.
  const [greeting, setGreeting] = useState<keyof typeof GREETINGS>('welcome');
  useEffect(() => setGreeting(greetingFor(new Date().getHours())), []);
  const courses = [
    { name: t('site.home.preview.course1'), progress: 72, bar: 'bg-brand-hover' },
    { name: t('site.home.preview.course2'), progress: 45, bar: 'bg-success' },
    { name: t('site.home.preview.course3'), progress: 90, bar: 'bg-accent' },
  ];
  return (
    <div aria-hidden="true" className="relative">
      <div className="absolute -inset-6 rounded-[2.5rem] bg-brand/10 blur-3xl" />
      <div className="relative bg-surface border border-line rounded-3xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-1.5 px-5 py-3 border-b border-line">
          <span className="h-2.5 w-2.5 rounded-full bg-line" />
          <span className="h-2.5 w-2.5 rounded-full bg-line" />
          <span className="h-2.5 w-2.5 rounded-full bg-line" />
          <span className="ml-3 text-[11px] text-ink-subtle">{t('site.home.preview.portal')}</span>
        </div>
        <div className="p-5 space-y-5">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-ink-subtle font-semibold">{t('site.home.preview.continue')}</p>
            <p className="text-sm font-bold text-ink mt-1">
              {t(GREETINGS[greeting])} — {t.plural('site.home.preview.inProgress', 3)}
            </p>
          </div>
          <div className="space-y-3">
            {courses.map((c) => (
              <div key={c.name} className="bg-canvas border border-line rounded-2xl p-3.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink">{c.name}</span>
                  <span className="text-ink-muted tabular-nums">{c.progress}%</span>
                </div>
                <div className="mt-2.5 h-1.5 rounded-full bg-line overflow-hidden">
                  <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${c.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 bg-canvas border border-line rounded-2xl p-3.5">
            <div className="h-9 w-9 shrink-0 rounded-xl bg-accent/15 text-accent flex items-center justify-center">
              <Award className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink">{t('site.home.preview.certificate')}</p>
              <p className="text-[11px] text-ink-subtle flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-success" /> {t('site.home.preview.verifiable')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const t = useT();
  const { user, isLoading } = useAuth();

  // If user already has an active session, forward them directly to their authorized portal
  useEffect(() => {
    if (!isLoading && user && user.targetRoute) {
      router.replace(user.targetRoute);
    }
  }, [user, isLoading, router]);

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col">
      {/* Top Header */}
      <header className="border-b border-line bg-canvas/80 backdrop-blur-md px-6 py-4 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <BrandLogo />
          <nav className="flex items-center gap-2 sm:gap-6">
            <a href="#roles" className="hidden md:inline text-xs font-semibold text-ink-muted hover:text-brand-fg transition-colors">
              {t('site.home.nav.roles')}
            </a>
            <a href="#platform" className="hidden md:inline text-xs font-semibold text-ink-muted hover:text-brand-fg transition-colors">
              {t('site.home.nav.platform')}
            </a>
            <a href="#privacy" className="hidden md:inline text-xs font-semibold text-ink-muted hover:text-brand-fg transition-colors">
              {t('site.home.nav.privacy')}
            </a>
            <ThemeToggle />
            <Link href="/register" className="hidden sm:inline text-xs font-semibold text-ink-muted hover:text-brand-fg transition-colors">
              {t('common.registerOrganisation')}
            </Link>
            <Link
              href="/login"
              className="px-5 py-2.5 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold shadow-md shadow-brand/20 transition-all flex items-center gap-1.5"
            >
              <span>{t('common.signIn')}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="absolute top-0 left-1/2 -translate-x-1/2 h-[480px] w-[960px] max-w-full rounded-full bg-brand/15 blur-3xl"
          />
          <div aria-hidden="true" className="absolute top-40 right-0 h-[320px] w-[320px] rounded-full bg-accent/10 blur-3xl" />
          <div className="relative max-w-6xl mx-auto px-6 pt-16 pb-20 md:pt-24 md:pb-28 grid gap-14 lg:grid-cols-[1.1fr_1fr] items-center">
            <div className="space-y-7">
              <span className="inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand/10 px-3 py-1 text-[11px] font-semibold text-brand-fg">
                <ShieldCheck className="h-3.5 w-3.5" />
                {t('site.home.badge')}
              </span>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-ink leading-[1.05] text-balance">
                {t('site.home.hero.title1')} <span className="text-brand-fg">{t('site.home.hero.title2')}</span>
              </h1>
              <p className="text-base md:text-lg text-ink-muted leading-relaxed max-w-xl">{t('site.home.hero.body')}</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/login"
                  className="px-7 py-3.5 bg-brand hover:bg-brand-hover text-on-brand rounded-2xl text-sm font-bold flex items-center justify-center gap-2 shadow-xl shadow-brand/25 transition-all"
                >
                  <span>{t('site.home.hero.signIn')}</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/register"
                  className="px-7 py-3.5 border border-line hover:border-brand bg-surface/60 text-ink rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  <Building2 className="h-4 w-4 text-brand-fg" />
                  <span>{t('common.registerOrganisation')}</span>
                </Link>
              </div>
              <p className="text-xs text-ink-subtle">
                {t('site.home.hero.new')}{' '}
                <a href="#platform" className="text-brand-fg underline underline-offset-2">
                  {t('site.home.hero.explore')}
                </a>
              </p>
              <p className="text-xs text-ink-subtle">
                {t('site.home.hero.lost')}{' '}
                <Link href="/find-organisation" className="text-brand-fg underline underline-offset-2">
                  {t('find.title')}
                </Link>
              </p>
            </div>
            <PortalPreview />
          </div>
        </section>

        {/* Standards strip */}
        <section aria-label={t('site.home.standards.label')} className="border-y border-line bg-brand/[0.07]">
          <div className="max-w-6xl mx-auto px-6 py-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-ink-subtle">{t('site.home.standards.heading')}</span>
            {STANDARDS.map((s) => (
              <span key={s} className="text-sm font-semibold text-ink">
                {s}
              </span>
            ))}
          </div>
        </section>

        {/* Roles */}
        <section id="roles" className="max-w-6xl mx-auto px-6 py-20 md:py-24 scroll-mt-20">
          <div className="max-w-2xl space-y-3">
            <p className="text-xs uppercase tracking-wider font-bold text-brand-fg">{t('site.home.roles.eyebrow')}</p>
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-ink text-balance">{t('site.home.roles.title')}</h2>
            <p className="text-ink-muted leading-relaxed">{t('site.home.roles.body')}</p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {ROLES.map(({ icon: Icon, title, body, accent, tint }) => (
              <div
                key={title}
                className={`bg-surface bg-gradient-to-br ${tint} via-surface to-surface border border-line rounded-3xl p-7 space-y-4 shadow-sm hover:shadow-lg hover:border-brand/40 transition-all`}
              >
                <div className={`h-11 w-11 rounded-xl border flex items-center justify-center ${accent}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-bold text-ink text-lg">{t(title)}</h3>
                <p className="text-sm text-ink-muted leading-relaxed">{t(body)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Platform features */}
        <section id="platform" className="border-y border-line bg-gradient-to-b from-brand/[0.08] to-transparent scroll-mt-20">
          <div className="max-w-6xl mx-auto px-6 py-20 md:py-24">
            <div className="max-w-2xl space-y-3">
              <p className="text-xs uppercase tracking-wider font-bold text-brand-fg">{t('site.home.platform.eyebrow')}</p>
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-ink text-balance">{t('site.home.platform.title')}</h2>
            </div>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div
                  key={title}
                  className="bg-surface border border-line rounded-2xl p-6 space-y-3 shadow-sm hover:border-brand/40 hover:shadow-md transition-all"
                >
                  <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand-fg flex items-center justify-center">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-bold text-ink">{t(title)}</h3>
                  <p className="text-sm text-ink-muted leading-relaxed">{t(body)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Privacy */}
        <section id="privacy" className="max-w-6xl mx-auto px-6 py-20 md:py-24 scroll-mt-20">
          <div className="bg-surface bg-gradient-to-br from-success/15 via-surface to-surface border border-line rounded-3xl p-8 md:p-12 grid gap-10 md:grid-cols-2 items-center shadow-sm">
            <div className="space-y-4">
              <div className="h-11 w-11 rounded-xl bg-success/10 text-success border border-success/20 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-ink text-balance">{t('site.home.privacy.title')}</h2>
              <p className="text-ink-muted leading-relaxed">{t('site.home.privacy.body')}</p>
            </div>
            <ul className="space-y-3">
              {PRIVACY.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-3 bg-canvas border border-line rounded-2xl px-4 py-3.5 text-sm font-semibold text-ink"
                >
                  <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-success" />
                  {t(item)}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="max-w-6xl mx-auto px-6 pb-24">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand via-brand to-[#7c3aed] px-8 py-14 md:py-16 text-center shadow-2xl shadow-brand/25">
            <div aria-hidden="true" className="absolute -top-24 -right-16 h-64 w-64 rounded-full bg-on-brand/10 blur-2xl" />
            <div className="relative space-y-5">
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-on-brand text-balance">{t('site.home.cta.title')}</h2>
              <p className="text-on-brand/80 max-w-md mx-auto">{t('site.home.cta.body')}</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link
                  href="/login"
                  className="inline-flex px-7 py-3.5 bg-on-brand text-brand hover:bg-on-brand/90 rounded-2xl text-sm font-bold items-center gap-2 shadow-xl shadow-black/20 transition-all"
                >
                  <span>{t('common.signIn')}</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/register"
                  className="inline-flex px-7 py-3.5 border border-on-brand/60 text-on-brand hover:bg-on-brand/10 rounded-2xl text-sm font-bold items-center gap-2 transition-all"
                >
                  <Building2 className="h-4 w-4" />
                  <span>{t('common.registerOrganisation')}</span>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-line bg-canvas">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-ink-subtle">
          <p>{t('site.home.footer.rights')}</p>
          <div className="flex items-center gap-6">
            <Link href="/login" className="hover:text-brand-fg transition-colors">
              {t('common.signIn')}
            </Link>
            <Link href="/forgot-password" className="hover:text-brand-fg transition-colors">
              {t('site.home.footer.forgot')}
            </Link>
            <Link href="/find-organisation" className="hover:text-brand-fg transition-colors">
              {t('find.title')}
            </Link>
            <Link href="/register" className="hover:text-brand-fg transition-colors">
              {t('common.registerOrganisation')}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
