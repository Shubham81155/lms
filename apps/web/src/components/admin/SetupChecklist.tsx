'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Circle, X } from 'lucide-react';
import { useApiData } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';
import { setupComplete, setupSteps, type SetupStepKey } from '@/lib/setup-checklist';

const DISMISS_KEY = 'lms_setup_checklist_dismissed';

/**
 * "Get your organisation ready": what a new organisation's administrator still has to do, ticked off from
 * what the organisation already has. Only for organisations created through onboarding; hides when everything is
 * done, or when dismissed in this browser.
 */
export const SetupChecklist: React.FC<{
  seatsUsed: number | null;
  courses: number | null;
  ssoAvailable: boolean;
  /** Opens the place where a step is done. */
  onGo: (step: SetupStepKey) => void;
}> = ({ seatsUsed, courses, ssoAvailable, onGo }) => {
  const t = useT();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  const tenant = useApiData<{ data: { name: string; slug: string; logoUrl: string | null; setupChecklist?: boolean } }>(
    dismissed ? null : '/api/v1/admin/tenant'
  );
  const terms = useApiData<{ data: unknown[] }>(dismissed ? null : '/api/v1/terms');
  const sso = useApiData<{ data: { enabled: boolean } | null }>(dismissed || !ssoAvailable ? null : '/api/v1/admin/sso');
  const saml = useApiData<{ data: { enabled: boolean } | null }>(dismissed || !ssoAvailable ? null : '/api/v1/admin/saml');

  // Organisations that were running before onboarding existed are not walked through it.
  if (dismissed || !tenant.data || !tenant.data.data.setupChecklist) return null;

  const steps = setupSteps({
    tenant: tenant.data.data,
    seatsUsed,
    courses,
    ssoAvailable,
    ssoConnected: !!sso.data?.data?.enabled || !!saml.data?.data?.enabled,
    terms: terms.data ? terms.data.data.length : null,
  });
  if (setupComplete(steps)) return null;
  const done = steps.filter((s) => s.done).length;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* not remembered; it shows again next time */
    }
  };

  return (
    <section className="rounded-3xl border border-brand/40 bg-surface p-6 shadow-xl space-y-4" aria-labelledby="setup-h">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="setup-h" className="font-bold text-base text-ink">
            {t('people.setup.title')}
          </h2>
          <p className="text-xs text-ink-muted">{t('people.setup.progress', { done: t.number(done), total: t.number(steps.length) })}</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('people.setup.hideAria')}
          title={t('people.setup.hide')}
          className="rounded-xl p-1 text-ink-muted hover:bg-raised hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
      </div>
      <ol className="space-y-2">
        {steps.map((s) => (
          <li key={s.key} className="flex items-start gap-3 rounded-2xl border border-line bg-canvas/40 p-3">
            {s.done ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <div className={`text-xs font-semibold ${s.done ? 'text-ink-muted line-through' : 'text-ink'}`}>
                {t.dyn(`people.setup.${s.key}.title`, s.title)}
                <span className="sr-only">{s.done ? t('people.setup.done') : t('people.setup.todo')}</span>
              </div>
              <div className="text-[11px] text-ink-subtle">{t.dyn(`people.setup.${s.key}.hint`, s.hint)}</div>
            </div>
            {!s.done && (
              <button
                type="button"
                onClick={() => onGo(s.key)}
                className="shrink-0 rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-raised"
              >
                {t('people.setup.open')}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
};
