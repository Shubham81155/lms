'use client';

import React, { useEffect, useState } from 'react';
import { typedPut } from '@/lib/typed-api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { useT } from '@/lib/i18n';

interface Prefs {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  mutedCategories: string[];
  quietStartHour: number | null;
  quietEndHour: number | null;
  timezone: string;
  emailedCategories: string[];
  smsEnabled: boolean;
  pushEnabled: boolean;
  digestFrequency: 'OFF' | 'DAILY' | 'WEEKLY';
  digestHour: number;
  digestWeekday: number;
  digestSections: string[];
}

const DIGEST_SECTIONS = ['deadlines', 'announcements', 'grades', 'forum', 'live'];

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

const CATEGORIES = ['GRADE', 'EXAM', 'COURSE', 'SYSTEM', 'LIVE', 'FORUM'];

const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

const select = 'bg-canvas border border-line rounded-lg px-2 py-1.5 text-[11px] text-ink focus:outline-none focus:border-brand';

/** The browser's own time zone, falling back to UTC where it cannot be determined. */
const localZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

export const NotificationSettings: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const t = useT();
  const { data, isLoading, error } = useApiData<{ data: Prefs }>('/api/v1/notifications/preferences');
  const { busy, error: saveError, run, clearError } = useAction();
  const [inApp, setInApp] = useState(true);
  const [email, setEmail] = useState(true);
  const [muted, setMuted] = useState<string[]>([]);
  const [quiet, setQuiet] = useState(false);
  const [start, setStart] = useState(22);
  const [end, setEnd] = useState(7);
  const [zone, setZone] = useState('UTC');
  const [digest, setDigest] = useState<Prefs['digestFrequency']>('WEEKLY');
  const [digestHour, setDigestHour] = useState(8);
  const [digestWeekday, setDigestWeekday] = useState(1);
  const [sections, setSections] = useState<string[]>(DIGEST_SECTIONS);
  const [saved, setSaved] = useState(false);

  const p = data?.data;
  useEffect(() => {
    if (!p) return;
    setInApp(p.inAppEnabled);
    setEmail(p.emailEnabled);
    setMuted(p.mutedCategories);
    setDigest(p.digestFrequency);
    setDigestHour(p.digestHour);
    setDigestWeekday(p.digestWeekday);
    setSections(p.digestSections);
    const hasQuiet = p.quietStartHour !== null && p.quietEndHour !== null;
    setQuiet(hasQuiet);
    if (hasQuiet) {
      setStart(p.quietStartHour as number);
      setEnd(p.quietEndHour as number);
    }
    // A user who never set a zone gets the server default (UTC); offer their own instead.
    setZone(p.timezone === 'UTC' && !hasQuiet ? localZone() : p.timezone);
  }, [p]);

  const save = () =>
    run(async () => {
      const body = {
        inAppEnabled: inApp,
        emailEnabled: email,
        mutedCategories: muted,
        quietStartHour: quiet ? start : null,
        quietEndHour: quiet ? end : null,
        timezone: zone,
        digestFrequency: digest,
        digestHour,
        digestWeekday,
        digestSections: sections as ('deadlines' | 'announcements' | 'grades' | 'forum' | 'live')[],
      };
      await typedPut('/api/v1/notifications/preferences', body);
      setSaved(true);
    });

  const touch = () => {
    setSaved(false);
    clearError();
  };
  const categoryLabel = (c: string) => t.dyn(`privacy.notif.cat.${c}`, c);
  const emailed = (p?.emailedCategories ?? []).map(categoryLabel).join(', ').toLowerCase();

  if (isLoading) return <div className="p-6 text-xs text-ink-subtle">{t('privacy.notif.loading')}</div>;

  return (
    <div className="p-4 space-y-4 text-xs max-h-96 overflow-y-auto" onChange={touch}>
      {(error || saveError) && <Banner kind="error">{error || saveError}</Banner>}
      {saved && <Banner kind="ok">{t('privacy.notif.saved')}</Banner>}

      <label className="flex items-center justify-between gap-3 text-ink">
        <span>{t('privacy.notif.inApp')}</span>
        <input type="checkbox" checked={inApp} onChange={(e) => setInApp(e.target.checked)} />
      </label>
      <label className="flex items-center justify-between gap-3 text-ink">
        <span>
          {t('privacy.notif.email')}
          {emailed && <span className="block text-[10px] text-ink-subtle">{t('privacy.notif.emailFor', { categories: emailed })}</span>}
        </span>
        <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-ink-muted font-semibold">{t('privacy.notif.mute')}</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {CATEGORIES.map((key) => (
            <label key={key} className="flex min-h-6 items-center gap-1.5 text-ink">
              <input
                type="checkbox"
                checked={muted.includes(key)}
                onChange={(e) => setMuted((m) => (e.target.checked ? [...m, key] : m.filter((x) => x !== key)))}
              />
              {categoryLabel(key)}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <label className="flex min-h-6 items-center gap-2 text-ink">
          <input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />
          {t('privacy.notif.quiet')}
        </label>
        {quiet && (
          <div className="flex flex-wrap items-center gap-2 text-ink-muted">
            <select
              className={select}
              aria-label={t('privacy.notif.quietStart')}
              value={start}
              onChange={(e) => setStart(Number(e.target.value))}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
            <span>{t('privacy.notif.to')}</span>
            <select
              className={select}
              aria-label={t('privacy.notif.quietEnd')}
              value={end}
              onChange={(e) => setEnd(Number(e.target.value))}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
            {digest === 'OFF' && (
              <input
                className={`${select} w-40`}
                aria-label={t('privacy.notif.timeZone')}
                value={zone}
                onChange={(e) => setZone(e.target.value)}
              />
            )}
          </div>
        )}
        {quiet && start === end && <p className="text-[10px] text-accent">{t('privacy.notif.quietSame')}</p>}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-ink-muted font-semibold">{t('privacy.notif.digest')}</legend>
        <div className="flex flex-wrap items-center gap-2 text-ink">
          <label className="flex items-center gap-2">
            {t('privacy.notif.digestSend')}
            <select className={select} value={digest} onChange={(e) => setDigest(e.target.value as Prefs['digestFrequency'])}>
              <option value="DAILY">{t('privacy.notif.digest.DAILY')}</option>
              <option value="WEEKLY">{t('privacy.notif.digest.WEEKLY')}</option>
              <option value="OFF">{t('privacy.notif.digest.OFF')}</option>
            </select>
          </label>
          {digest === 'WEEKLY' && (
            <label className="flex items-center gap-2">
              {t('privacy.notif.on')}
              <select className={select} value={digestWeekday} onChange={(e) => setDigestWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((n) => (
                  <option key={n} value={n}>
                    {t.dyn(`privacy.notif.weekday.${n}`, String(n))}
                  </option>
                ))}
              </select>
            </label>
          )}
          {digest !== 'OFF' && (
            <label className="flex items-center gap-2">
              {t('privacy.notif.at')}
              <select className={select} value={digestHour} onChange={(e) => setDigestHour(Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {digest !== 'OFF' && (
          <>
            <label className="flex flex-wrap items-center gap-2 text-ink-muted">
              {t('privacy.notif.timeZone')}
              <input className={`${select} w-40`} value={zone} onChange={(e) => setZone(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={t('privacy.notif.includes')}>
              {DIGEST_SECTIONS.map((key) => (
                <label key={key} className="flex min-h-6 items-center gap-1.5 text-ink">
                  <input
                    type="checkbox"
                    checked={sections.includes(key)}
                    onChange={(e) => setSections((s) => (e.target.checked ? [...s, key] : s.filter((x) => x !== key)))}
                  />
                  {t.dyn(`privacy.notif.section.${key}`, key)}
                </label>
              ))}
            </div>
            <p className="text-[10px] text-ink-subtle">{t('privacy.notif.digestNote')}</p>
          </>
        )}
      </fieldset>

      <fieldset className="space-y-1.5" disabled>
        <legend className="text-ink-muted font-semibold">{t('privacy.notif.smsPush')}</legend>
        <label className="flex items-center justify-between gap-3 text-ink-subtle">
          <span>{t('privacy.notif.sms')}</span>
          <input type="checkbox" checked={false} disabled readOnly />
        </label>
        <label className="flex items-center justify-between gap-3 text-ink-subtle">
          <span>{t('privacy.notif.push')}</span>
          <input type="checkbox" checked={false} disabled readOnly />
        </label>
        <p className="text-[10px] text-ink-subtle">{t('privacy.notif.unavailable')}</p>
      </fieldset>

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-lg font-bold"
        >
          {busy ? t('privacy.notif.saving') : t('privacy.notif.save')}
        </button>
        <button onClick={onDone} className="px-3 py-1.5 bg-surface border border-line text-ink rounded-lg font-semibold">
          {t('privacy.notif.back')}
        </button>
      </div>
    </div>
  );
};
