'use client';

import React, { useEffect, useState } from 'react';
import { typedPut } from '@/lib/typed-api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';

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

const DIGEST_SECTION_LABELS: Record<string, string> = {
  deadlines: 'Deadlines coming up',
  announcements: 'Announcements',
  grades: 'Grades',
  forum: 'Discussion replies',
  live: 'Live classes',
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const CATEGORY_LABELS: Record<string, string> = {
  GRADE: 'Grades',
  EXAM: 'Exams',
  COURSE: 'Courses',
  SYSTEM: 'System',
  LIVE: 'Live classes',
  FORUM: 'Discussions',
};

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
  const [sections, setSections] = useState<string[]>(Object.keys(DIGEST_SECTION_LABELS));
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
  const emailed = (p?.emailedCategories ?? [])
    .map((c) => CATEGORY_LABELS[c] ?? c)
    .join(', ')
    .toLowerCase();

  if (isLoading) return <div className="p-6 text-xs text-ink-subtle">Loading…</div>;

  return (
    <div className="p-4 space-y-4 text-xs max-h-96 overflow-y-auto" onChange={touch}>
      {(error || saveError) && <Banner kind="error">{error || saveError}</Banner>}
      {saved && <Banner kind="ok">Settings saved.</Banner>}

      <label className="flex items-center justify-between gap-3 text-ink">
        <span>Show notifications in the app</span>
        <input type="checkbox" checked={inApp} onChange={(e) => setInApp(e.target.checked)} />
      </label>
      <label className="flex items-center justify-between gap-3 text-ink">
        <span>
          Send me e-mail
          {emailed && <span className="block text-[10px] text-ink-subtle">For {emailed}. Discussion replies stay in the app.</span>}
        </span>
        <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-ink-muted font-semibold">Mute categories</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <label key={key} className="flex min-h-6 items-center gap-1.5 text-ink">
              <input
                type="checkbox"
                checked={muted.includes(key)}
                onChange={(e) => setMuted((m) => (e.target.checked ? [...m, key] : m.filter((x) => x !== key)))}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <label className="flex min-h-6 items-center gap-2 text-ink">
          <input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />
          Quiet hours (e-mail waits until they end)
        </label>
        {quiet && (
          <div className="flex flex-wrap items-center gap-2 text-ink-muted">
            <select className={select} aria-label="Quiet hours start" value={start} onChange={(e) => setStart(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
            <span>to</span>
            <select className={select} aria-label="Quiet hours end" value={end} onChange={(e) => setEnd(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
            {digest === 'OFF' && (
              <input className={`${select} w-40`} aria-label="Time zone" value={zone} onChange={(e) => setZone(e.target.value)} />
            )}
          </div>
        )}
        {quiet && start === end && <p className="text-[10px] text-accent">Start and end are the same, so no quiet period applies.</p>}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-ink-muted font-semibold">Summary e-mail</legend>
        <div className="flex flex-wrap items-center gap-2 text-ink">
          <label className="flex items-center gap-2">
            Send me a summary
            <select className={select} value={digest} onChange={(e) => setDigest(e.target.value as Prefs['digestFrequency'])}>
              <option value="DAILY">every day</option>
              <option value="WEEKLY">every week</option>
              <option value="OFF">never</option>
            </select>
          </label>
          {digest === 'WEEKLY' && (
            <label className="flex items-center gap-2">
              on
              <select className={select} value={digestWeekday} onChange={(e) => setDigestWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((d, n) => (
                  <option key={d} value={n}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}
          {digest !== 'OFF' && (
            <label className="flex items-center gap-2">
              at
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
              Time zone
              <input className={`${select} w-40`} value={zone} onChange={(e) => setZone(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="What the summary includes">
              {Object.entries(DIGEST_SECTION_LABELS).map(([key, label]) => (
                <label key={key} className="flex min-h-6 items-center gap-1.5 text-ink">
                  <input
                    type="checkbox"
                    checked={sections.includes(key)}
                    onChange={(e) => setSections((s) => (e.target.checked ? [...s, key] : s.filter((x) => x !== key)))}
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="text-[10px] text-ink-subtle">
              Things you already got by e-mail are not repeated. Every summary has a link to turn it off.
            </p>
          </>
        )}
      </fieldset>

      <fieldset className="space-y-1.5" disabled>
        <legend className="text-ink-muted font-semibold">Text message and push</legend>
        <label className="flex items-center justify-between gap-3 text-ink-subtle">
          <span>Text message (SMS)</span>
          <input type="checkbox" checked={false} disabled readOnly />
        </label>
        <label className="flex items-center justify-between gap-3 text-ink-subtle">
          <span>Push notification</span>
          <input type="checkbox" checked={false} disabled readOnly />
        </label>
        <p className="text-[10px] text-ink-subtle">Not available yet: nothing is sent by text message or push notification.</p>
      </fieldset>

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-lg font-bold"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onDone} className="px-3 py-1.5 bg-surface border border-line text-ink rounded-lg font-semibold">
          Back
        </button>
      </div>
    </div>
  );
};
