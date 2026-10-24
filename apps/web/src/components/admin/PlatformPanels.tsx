'use client';

import React, { useState } from 'react';
import { Download, Send, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile, useAction, useApiData } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';
import { Banner, OnceSecret } from './IdentityPanels';

const input =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const primaryBtn = 'px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all';
const ghostBtn =
  'px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

// English defaults (also used by the platform console); the admin screen shows orgadm.feature.<key>.* when present.
export const FEATURE_LABELS: Record<string, { label: string; hint: string }> = {
  lti13: { label: 'LTI 1.3 launches', hint: 'Let external tools sign learners in.' },
  sso: { label: 'Single sign-on (OIDC / SAML)', hint: 'Sign in with your identity provider.' },
  webhooks: { label: 'Webhooks', hint: 'Send signed events to your systems.' },
  scim: { label: 'SCIM provisioning', hint: 'Sync accounts from your directory.' },
  aiAssistant: {
    label: 'AI assistance',
    hint: 'Study tutor for learners and course-outline drafts for instructors. Questions and course content are sent to Google Gemini.',
  },
};

export const FeaturesPanel: React.FC = () => {
  const t = useT();
  const { data, error } = useApiData<{ data: Record<string, boolean> }>('/api/v1/admin/features');

  return (
    <section className="space-y-4" aria-labelledby="features-heading">
      <div>
        <h3 id="features-heading" className="font-bold text-base text-ink">
          {t('orgadm.features.title')}
        </h3>
        <p className="text-xs text-ink-muted">{t('orgadm.features.intro')}</p>
      </div>
      {error && <Banner kind="error">{error}</Banner>}
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Object.entries(FEATURE_LABELS).map(([key, meta]) => {
          const on = !!data?.data?.[key];
          return (
            <li key={key} className="bg-canvas border border-line rounded-2xl p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-ink">{t.dyn(`orgadm.feature.${key}.label`, meta.label)}</div>
                <div className="text-[11px] text-ink-subtle">{t.dyn(`orgadm.feature.${key}.hint`, meta.hint)}</div>
              </div>
              <span
                className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${on ? 'bg-success/10 text-success border-success/30' : 'bg-canvas text-ink-subtle border-line'}`}
              >
                {on ? t('orgadm.features.included') : t('orgadm.features.notIncluded')}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Usage, seat quota and data export
// ---------------------------------------------------------------------------

export interface Usage {
  tier: string;
  seats: { used: number; quota: number | null; remaining: number | null; byRole: Record<string, number>; byStatus: Record<string, number> };
  last30Days: { activeUsers: number; xapiStatements: number; assignmentSubmissions: number };
  totals: { courses: number; enrollments: number; certificates: number };
}

export const UsagePanel: React.FC = () => {
  const t = useT();
  const { data, error, reload } = useApiData<{ data: Usage }>('/api/v1/admin/usage');
  const { busy, error: actionError, run } = useAction();
  const [exporting, setExporting] = useState(false);
  const u = data?.data;

  const exportData = async () => {
    setExporting(true);
    await run(() => downloadFile('/api/v1/admin/export', 'tenant-export.json'));
    setExporting(false);
  };

  const pct = u?.seats.quota ? Math.min(100, Math.round((u.seats.used / u.seats.quota) * 100)) : null;

  return (
    <section className="space-y-4" aria-labelledby="usage-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id="usage-heading" className="font-bold text-base text-ink">
            {t('orgadm.usage.title')}
          </h3>
          <p className="text-xs text-ink-muted">
            {u?.seats.quota
              ? t('orgadm.usage.planQuota', { tier: u.tier, quota: u.seats.quota })
              : t('orgadm.usage.plan', { tier: u?.tier ?? '…' })}
          </p>
        </div>
        <button className={ghostBtn} onClick={exportData} disabled={exporting}>
          <Download className="h-3.5 w-3.5 inline mr-1" />
          {exporting ? t('orgadm.usage.preparing') : t('orgadm.usage.export')}
        </button>
      </div>

      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}

      {u && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              [t('orgadm.usage.seatsInUse'), u.seats.quota ? `${u.seats.used} / ${u.seats.quota}` : String(u.seats.used)],
              [t('orgadm.usage.activeUsers'), String(u.last30Days.activeUsers)],
              [t('orgadm.usage.courses'), String(u.totals.courses)],
              [t('orgadm.usage.certificates'), String(u.totals.certificates)],
            ].map(([label, value]) => (
              <div key={label} className="bg-canvas border border-line rounded-2xl p-4">
                <div className="text-[11px] text-ink-subtle">{label}</div>
                <div className="text-xl font-bold text-ink mt-1">{value}</div>
              </div>
            ))}
          </div>

          {pct !== null && (
            <div>
              <div
                className="h-2 rounded-full bg-raised overflow-hidden"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('orgadm.usage.seatUsage')}
              >
                <div className={`h-2 ${pct >= 90 ? 'bg-rose-500' : 'bg-brand-hover'}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="text-[11px] text-ink-subtle mt-1">{t.plural('orgadm.usage.remaining', u.seats.remaining ?? 0)}</div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 text-[11px]">
            {Object.entries(u.seats.byRole).map(([role, n]) => (
              <span key={role} className="px-2.5 py-1 rounded-full bg-canvas border border-line text-ink">
                {t.dyn(`role.${role}`, role.replace(/_/g, ' ').toLowerCase())}: <strong className="text-ink">{n}</strong>
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

const EVENTS = ['enrollment.completed', 'certificate.issued', 'quiz.submitted', 'user.provisioned'] as const;

interface Endpoint {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
}
interface Delivery {
  id: string;
  event: string;
  statusCode: number | null;
  success: boolean;
  error: string | null;
  createdAt: string;
}

const Deliveries: React.FC<{ id: string }> = ({ id }) => {
  const t = useT();
  const { data, isLoading } = useApiData<{ data: Delivery[] }>(`/api/v1/admin/webhooks/${id}/deliveries`);
  if (isLoading) return <div className="text-[11px] text-ink-subtle">{t('common.loading')}</div>;
  const rows = (data?.data ?? []).slice(0, 10);
  if (rows.length === 0) return <div className="text-[11px] text-ink-subtle">{t('orgadm.hooks.noDeliveries')}</div>;
  return (
    <ul className="space-y-1">
      {rows.map((d) => (
        <li key={d.id} className="flex items-center justify-between text-[11px] font-mono">
          <span className={d.success ? 'text-success' : 'text-danger'}>
            {d.success ? t('orgadm.hooks.ok') : t('orgadm.hooks.fail')} {d.statusCode ?? '-'} {d.event}
          </span>
          <span className="text-ink-subtle">
            {new Date(d.createdAt).toLocaleString()}
            {d.error ? ` · ${d.error}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
};

type TestOutcome = { success: boolean; statusCode: number | null; error: string | null };

export const WebhooksPanel: React.FC<{ available: boolean }> = ({ available }) => {
  const t = useT();
  const { data, error, reload } = useApiData<{ data: Endpoint[] }>('/api/v1/admin/webhooks');
  const { busy, error: actionError, run } = useAction();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([...EVENTS]);
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, TestOutcome>>({});
  const [tick, setTick] = useState(0); // remounts the delivery log after a test event

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post<{ data: { secret: string } }>('/api/v1/admin/webhooks', { url: url.trim(), events });
      setSecret(r.data.secret);
      setUrl('');
      await reload();
    });
  };

  const test = (ep: Endpoint) =>
    run(async () => {
      const r = await api.post<{ data: TestOutcome }>(`/api/v1/admin/webhooks/${ep.id}/test`);
      setTestResult((p) => ({ ...p, [ep.id]: r.data }));
      setTick((n) => n + 1);
    });

  const toggleActive = (ep: Endpoint) =>
    run(async () => {
      await api.patch(`/api/v1/admin/webhooks/${ep.id}`, { isActive: !ep.isActive });
      await reload();
    });

  const remove = (ep: Endpoint) => {
    if (!window.confirm(t('orgadm.hooks.deleteConfirm', { url: ep.url }))) return;
    run(async () => {
      await api.delete(`/api/v1/admin/webhooks/${ep.id}`);
      await reload();
    });
  };

  return (
    <section className="space-y-4" aria-labelledby="webhooks-heading">
      <div>
        <h3 id="webhooks-heading" className="font-bold text-base text-ink">
          {t('orgadm.hooks.title')}
        </h3>
        <p className="text-xs text-ink-muted">
          {t('orgadm.hooks.introBefore')} <code className="text-brand-fg">x-lms-signature</code> {t('orgadm.hooks.introAfter')}
        </p>
      </div>

      {!available && <Banner kind="error">{t('orgadm.hooks.notAvailable')}</Banner>}
      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}
      {secret && <OnceSecret label={t('orgadm.hooks.signingSecret')} value={secret} onDismiss={() => setSecret(null)} />}

      <form onSubmit={create} className="space-y-3 bg-canvas border border-line rounded-2xl p-4">
        <label className="block space-y-1 text-xs text-ink-muted font-semibold">
          {t('orgadm.hooks.endpointUrl')}
          <input
            className={input}
            type="url"
            required
            placeholder="https://example.com/hooks/lms"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={!available}
          />
        </label>
        <fieldset className="flex flex-wrap gap-4 text-xs text-ink">
          <legend className="text-xs text-ink-muted font-semibold mb-1">{t('orgadm.hooks.events')}</legend>
          {EVENTS.map((ev) => (
            <label key={ev} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={events.includes(ev)}
                disabled={!available}
                onChange={(e) => setEvents((p) => (e.target.checked ? [...p, ev] : p.filter((x) => x !== ev)))}
                className="rounded border-line bg-canvas text-brand-fg"
              />
              {ev}
            </label>
          ))}
        </fieldset>
        <button className={primaryBtn} disabled={busy || !available || events.length === 0 || !url.trim()}>
          {t('orgadm.hooks.add')}
        </button>
      </form>

      <ul className="space-y-2">
        {(data?.data ?? []).length === 0 && <li className="text-xs text-ink-subtle">{t('orgadm.hooks.empty')}</li>}
        {(data?.data ?? []).map((ep) => (
          <li key={ep.id} className="bg-canvas border border-line rounded-2xl p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-ink break-all">{ep.url}</div>
                <div className="text-[11px] text-ink-subtle">{ep.events.join(', ')}</div>
              </div>
              <div className="flex items-center gap-2">
                <button className={ghostBtn} onClick={() => test(ep)} disabled={busy}>
                  <Send className="h-3 w-3 inline mr-1" />
                  {t('orgadm.hooks.sendTest')}
                </button>
                <button className={ghostBtn} onClick={() => toggleActive(ep)} disabled={busy}>
                  {ep.isActive ? t('orgadm.hooks.pause') : t('orgadm.hooks.resume')}
                </button>
                <button className={ghostBtn} onClick={() => setOpen(open === ep.id ? null : ep.id)}>
                  {open === ep.id ? t('orgadm.hooks.hideLog') : t('orgadm.hooks.deliveries')}
                </button>
                <button
                  className={ghostBtn}
                  onClick={() => remove(ep)}
                  disabled={busy}
                  aria-label={t('orgadm.hooks.deleteAria', { url: ep.url })}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
            {!ep.isActive && <div className="text-[11px] text-accent">{t('orgadm.hooks.paused')}</div>}
            {testResult[ep.id] && (
              <div className="text-[11px] text-ink">
                {testResult[ep.id].success
                  ? t('orgadm.hooks.delivered', { code: testResult[ep.id].statusCode ?? '' })
                  : t('orgadm.hooks.failed', { error: testResult[ep.id].error ?? t('orgadm.hooks.unknownError') })}
              </div>
            )}
            {open === ep.id && <Deliveries key={tick} id={ep.id} />}
          </li>
        ))}
      </ul>
    </section>
  );
};
