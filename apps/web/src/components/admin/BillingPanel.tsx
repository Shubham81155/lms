'use client';

import React, { useEffect, useState } from 'react';
import { CreditCard, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile, useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { useT, type Translator } from '@/lib/i18n';
import { useSupportSession } from '@/components/shell/SupportBanner';
import {
  formatBytes,
  formatInr,
  isRazorpayUrl,
  isValidGstin,
  planTotalPaise,
  usagePercent,
  type BillingInterval,
  type BillingOverview,
  type Invoice,
  type Plan,
} from '@/lib/billing';

// The organisation's subscription: current plan and usage against its limits, choosing or changing a plan (paid
// through Razorpay's hosted page), the GST billing details invoices are issued with, and the invoices. Without
// Razorpay credentials on the platform nothing can be bought and the panel says so.

const field =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const primary =
  'inline-flex items-center gap-1 px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all';
const ghost =
  'inline-flex items-center gap-1 px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';

// GST state codes (the first two digits of a GSTIN); the names are in the message catalogue (billing.state.<code>).
const STATE_CODES = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '23',
  '24',
  '26',
  '27',
  '29',
  '30',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '37',
  '38',
];

const day = (t: Translator, iso: string) => t.date(iso);
const stateName = (t: Translator, code: string) => t.dyn(`billing.state.${code}`, code);
const limitText = (t: Translator, n: number | null) => (n === null ? t('billing.unlimited') : t.number(n));
const statusText = (t: Translator, status: string) => t.dyn(`billing.status.${status}`, status.toLowerCase().replace(/_/g, ' '));

const Meter: React.FC<{ label: string; used: string; limit: string; percent: number | null }> = ({ label, used, limit, percent }) => {
  const t = useT();
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-semibold text-ink-muted">{label}</span>
        <span className="text-ink">{t('billing.meter.usedOf', { used, limit })}</span>
      </div>
      <div
        role="progressbar"
        aria-label={t('billing.meter.used', { label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? 0}
        aria-valuetext={percent === null ? t('billing.meter.noLimit', { used }) : t('billing.meter.percent', { percent })}
        className="h-1.5 overflow-hidden rounded-full bg-canvas"
      >
        <div
          className={`h-full rounded-full ${percent !== null && percent >= 90 ? 'bg-danger' : percent !== null && percent >= 75 ? 'bg-accent' : 'bg-brand'}`}
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
    </div>
  );
};

/** Shown above every administration page: a failed payment, or a subscription that ends. Links to the Billing tab. */
export const BillingBanner: React.FC<{ onOpenBilling: () => void }> = ({ onOpenBilling }) => {
  const { data } = useApiData<{ data: BillingOverview }>('/api/v1/billing');
  const t = useT();
  const b = data?.data;
  if (!b) return null;
  const message =
    b.status === 'PAST_DUE'
      ? t('billing.bannerPastDue')
      : b.status === 'ACTIVE' && b.cancelAtPeriodEnd && b.currentPeriodEnd
        ? t('billing.bannerEnds', { date: day(t, b.currentPeriodEnd) })
        : null;
  if (!message) return null;
  return (
    <div
      role={b.status === 'PAST_DUE' ? 'alert' : 'status'}
      className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 text-sm text-ink ${b.status === 'PAST_DUE' ? 'border-danger/40 bg-danger/5' : 'border-accent/50 bg-accent/10'}`}
    >
      <CreditCard className={`h-4 w-4 shrink-0 ${b.status === 'PAST_DUE' ? 'text-danger' : 'text-accent'}`} aria-hidden="true" />
      <p className="flex-1">{message}</p>
      <button type="button" className="text-xs font-semibold text-brand-fg underline" onClick={onOpenBilling}>
        {t('billing.goTo')}
      </button>
    </div>
  );
};

const ProfileForm: React.FC<{ overview: BillingOverview; onSaved: () => void; locked: boolean }> = ({ overview, onSaved, locked }) => {
  const p = overview.profile;
  const t = useT();
  const { busy, error, run } = useAction();
  const [legalName, setLegalName] = useState(p?.legalName ?? '');
  const [gstin, setGstin] = useState(p?.gstin ?? '');
  const [address, setAddress] = useState(p?.address ?? '');
  const [stateCode, setStateCode] = useState(p?.stateCode ?? '');
  const [saved, setSaved] = useState(false);
  const gstinBad = gstin.trim() !== '' && !isValidGstin(gstin);
  // A GSTIN starts with the state code; keep them in step so the invoice taxes the right way (CGST/SGST or IGST).
  const mismatch = gstin.trim().length >= 2 && stateCode !== '' && gstin.trim().slice(0, 2) !== stateCode;
  const valid = !locked && legalName.trim().length > 1 && address.trim().length > 4 && stateCode !== '' && !gstinBad && !mismatch;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    run(async () => {
      await api.put('/api/v1/billing/profile', {
        legalName: legalName.trim(),
        gstin: gstin.trim() ? gstin.trim().toUpperCase() : undefined,
        address: address.trim(),
        stateCode,
      });
      setSaved(true);
      onSaved();
    });
  };

  return (
    <form
      onSubmit={save}
      className="grid grid-cols-1 gap-3 rounded-2xl border border-line bg-canvas p-4 sm:grid-cols-2"
      aria-label={t('billing.form.label')}
    >
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        {t('billing.form.legalName')}
        <input className={field} value={legalName} onChange={(e) => setLegalName(e.target.value)} maxLength={200} required />
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        {t('billing.form.gstin')}
        <input
          className={field}
          value={gstin}
          onChange={(e) => setGstin(e.target.value.toUpperCase())}
          maxLength={15}
          placeholder="29ABCDE1234F1Z5"
          aria-invalid={gstinBad}
          aria-describedby={gstinBad ? 'gstin-err' : undefined}
        />
        {gstinBad && (
          <span id="gstin-err" className="block font-normal text-danger">
            {t('billing.form.gstinInvalid')}
          </span>
        )}
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted sm:col-span-2">
        {t('billing.form.address')}
        <textarea className={field} rows={2} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} required />
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        {t('billing.form.state')}
        <select
          className={field}
          value={stateCode}
          onChange={(e) => setStateCode(e.target.value)}
          required
          aria-describedby={mismatch ? 'state-err' : undefined}
          aria-invalid={mismatch}
        >
          <option value="">{t('billing.form.chooseState')}</option>
          {STATE_CODES.map((code) => (
            <option key={code} value={code}>
              {stateName(t, code)} ({code})
            </option>
          ))}
        </select>
        {mismatch && (
          <span id="state-err" className="block font-normal text-danger">
            {t('billing.form.stateMismatch', { code: gstin.trim().slice(0, 2) })}
          </span>
        )}
      </label>
      <div className="flex items-end gap-3">
        <button type="submit" className={primary} disabled={busy || !valid}>
          {t('billing.form.save')}
        </button>
        {saved && (
          <span role="status" className="text-[11px] text-success">
            {t('billing.form.saved')}
          </span>
        )}
      </div>
      {error && (
        <div className="sm:col-span-2">
          <Banner kind="error">{error}</Banner>
        </div>
      )}
    </form>
  );
};

const PlanPicker: React.FC<{ overview: BillingOverview; plans: Plan[]; onNeedProfile: () => void; locked: boolean }> = ({
  overview,
  plans,
  onNeedProfile,
  locked,
}) => {
  const t = useT();
  const { busy, error, run } = useAction();
  // Held from the click until the browser has left for Razorpay's page, so a second click cannot start a second subscription.
  const [redirecting, setRedirecting] = useState(false);
  const [interval, setInterval] = useState<BillingInterval>(overview.interval ?? 'MONTH');
  const [planId, setPlanId] = useState<string>(overview.plan?.id ?? plans[0]?.id ?? '');
  const [seats, setSeats] = useState(String(Math.max(1, overview.seats ?? overview.usage.seats)));
  const plan = plans.find((p) => p.id === planId) ?? null;
  const n = Number(seats);
  const minSeats = Math.max(1, overview.usage.seats);
  const seatsOk = Number.isInteger(n) && n >= minSeats && (!plan || plan.seatLimit === null || n <= plan.seatLimit);
  const current = overview.status === 'ACTIVE' || overview.status === 'PAST_DUE';
  // The API refuses a second subscription while one is in force, so a plan can only be bought without one.
  const canBuy = overview.configured && !!overview.profile && !current && !locked;

  useEffect(() => {
    // Back from Razorpay's page through the browser cache: the page is as it was, not mid-redirect.
    const back = (e: PageTransitionEvent) => e.persisted && setRedirecting(false);
    window.addEventListener('pageshow', back);
    return () => window.removeEventListener('pageshow', back);
  }, []);

  const subscribe = () => {
    if (redirecting) return;
    return run(async () => {
      const res = await api.post<{ data: { shortUrl: string } }>('/api/v1/billing/subscribe', { planId, interval, seats: n });
      // Razorpay's hosted payment page. The plan changes only when Razorpay's webhook reaches the server, never on the
      // customer's word that they paid.
      if (!isRazorpayUrl(res.data.shortUrl)) throw new Error(t('billing.subscribe.pageError'));
      setRedirecting(true);
      window.location.assign(res.data.shortUrl);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xs font-semibold text-ink-muted">{current ? t('billing.plans.title') : t('billing.plans.choose')}</h3>
        <div
          role="radiogroup"
          aria-label={t('billing.interval.label')}
          className="inline-flex overflow-hidden rounded-lg border border-line text-[11px] font-semibold"
        >
          {(['MONTH', 'YEAR'] as const).map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={interval === i}
              onClick={() => setInterval(i)}
              className={`px-3 py-1.5 ${interval === i ? 'bg-brand text-on-brand' : 'bg-surface text-ink hover:bg-raised'}`}
            >
              {i === 'MONTH' ? t('billing.interval.month') : t('billing.interval.year')}
            </button>
          ))}
        </div>
      </div>
      {plans.length === 0 && <p className="text-xs text-ink-muted">{t('billing.plans.none')}</p>}
      <div role="radiogroup" aria-label={t('billing.plans.group')} className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {plans.map((p) => {
          const selected = p.id === planId;
          const price = interval === 'YEAR' ? p.yearlyPaise : p.monthlyPaise;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={current}
              onClick={() => setPlanId(p.id)}
              className={`space-y-2 rounded-2xl border p-4 text-left text-xs transition-colors ${selected ? 'border-brand bg-brand/10' : 'border-line bg-canvas hover:border-brand/40'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-ink">{p.name}</span>
                {overview.plan?.id === p.id && (
                  <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                    {t('billing.plans.current')}
                  </span>
                )}
              </div>
              <div className="text-ink">
                <span className="text-lg font-extrabold">{formatInr(price)}</span>{' '}
                <span className="text-ink-subtle">
                  {interval === 'YEAR' ? t('billing.price.perSeatYear') : t('billing.price.perSeatMonth')}
                </span>
              </div>
              <ul className="space-y-0.5 text-[11px] text-ink-muted">
                <li>{p.seatLimit === null ? t('billing.limit.seatsUnlimited') : t.plural('billing.limit.seatsUpTo', p.seatLimit)}</li>
                <li>
                  {p.courseLimit === null ? t('billing.limit.coursesUnlimited') : t.plural('billing.limit.coursesUpTo', p.courseLimit)}
                </li>
                <li>
                  {p.storageGb === null
                    ? t('billing.limit.storageUnlimited')
                    : t('billing.limit.storageGb', { amount: limitText(t, p.storageGb) })}
                </li>
              </ul>
            </button>
          );
        })}
      </div>
      {current && <p className="rounded-2xl border border-line bg-canvas p-4 text-xs text-ink-muted">{t('billing.plans.alreadyOn')}</p>}
      {plan && !current && (
        <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-line bg-canvas p-4">
          <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
            {t('billing.seats.label')}
            <input
              className={`${field} w-28`}
              type="number"
              min={minSeats}
              max={plan.seatLimit ?? undefined}
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
              aria-invalid={!seatsOk}
              aria-describedby="seats-hint"
            />
          </label>
          <div className="text-xs text-ink">
            <div className="font-semibold">
              {seatsOk
                ? t(interval === 'YEAR' ? 'billing.price.totalYear' : 'billing.price.totalMonth', {
                    amount: formatInr(planTotalPaise(plan, interval, n)),
                  })
                : '—'}
            </div>
            <div id="seats-hint" className="text-[11px] text-ink-subtle">
              {t('billing.price.plusGst')}{' '}
              {n < minSeats
                ? t.plural('billing.seats.inUse', minSeats)
                : plan.seatLimit !== null && n > plan.seatLimit
                  ? t.plural('billing.seats.planMax', plan.seatLimit, { plan: plan.name })
                  : ''}
            </div>
          </div>
          <button type="button" className={primary} disabled={busy || redirecting || !seatsOk || !canBuy} onClick={subscribe}>
            {redirecting ? t('billing.subscribe.opening') : t('billing.subscribe')}
          </button>
          {!overview.profile && overview.configured && !current && (
            <button type="button" className="text-[11px] font-semibold text-brand-fg underline" onClick={onNeedProfile}>
              {t('billing.subscribe.profileFirst')}
            </button>
          )}
        </div>
      )}
      {error && <Banner kind="error">{error}</Banner>}
    </div>
  );
};

export const BillingPanel: React.FC = () => {
  const t = useT();
  const overview = useApiData<{ data: BillingOverview }>('/api/v1/billing');
  const plans = useApiData<{ data: Plan[] }>('/api/v1/billing/plans');
  const invoices = useApiData<{ data: Invoice[] }>('/api/v1/billing/invoices');
  const { busy, error, run } = useAction();
  const support = useSupportSession();
  // A read-only support session cannot change anything; buttons outside forms are not covered by the page-wide lock.
  const locked = support?.scope === 'READ_ONLY';
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const b = overview.data?.data;

  useEffect(() => {
    if (b && !b.profile) setProfileOpen(true);
  }, [b]);

  const post = (path: string) =>
    run(async () => {
      await api.post(path);
      setConfirmCancel(false);
      await overview.reload();
    });
  const pdf = async (inv: Invoice) => {
    if (downloading) return;
    setDownloadError(null);
    setDownloading(inv.id);
    try {
      await downloadFile(`/api/v1/billing/invoices/${encodeURIComponent(inv.id)}/pdf`, `${inv.number.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`);
    } catch {
      setDownloadError(t('billing.invoices.downloadFailed', { number: inv.number }));
    } finally {
      setDownloading(null);
    }
  };

  const live = b && (b.status === 'ACTIVE' || b.status === 'PAST_DUE');
  const usage = b?.usage;

  return (
    <section className="space-y-5" aria-labelledby="billing-h">
      <div className="space-y-1">
        <h2 id="billing-h" className="flex items-center gap-2 font-bold text-base text-ink">
          <CreditCard className="h-4 w-4 text-accent" aria-hidden="true" />
          {t('billing.title')}
        </h2>
        <p className="text-xs text-ink-muted">{t('billing.intro')}</p>
      </div>

      {(overview.error || error) && <Banner kind="error">{overview.error || error}</Banner>}
      {overview.isLoading && !b && <p className="text-xs text-ink-subtle">{t('common.loading')}</p>}

      {b && !b.configured && (
        <div role="status" className="rounded-2xl border border-line bg-canvas p-4 text-xs text-ink-muted">
          <span className="font-semibold text-ink">{t('billing.notConfigured.lead')}</span> {t('billing.notConfigured.rest')}
        </div>
      )}
      {b?.status === 'PAST_DUE' && (
        <div role="alert" className="rounded-2xl border border-danger/40 bg-danger/5 p-4 text-xs text-ink">
          <span className="font-semibold">{t('billing.pastDue.lead')}</span> {t('billing.pastDue.rest')}
        </div>
      )}

      {b && usage && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-2xl border border-line bg-canvas p-4 text-xs">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{t('billing.current.title')}</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-extrabold text-ink">{b.plan?.name ?? t('billing.current.noPlan')}</span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${b.status === 'ACTIVE' ? 'border-success/30 bg-success/10 text-success' : b.status === 'PAST_DUE' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-line text-ink-subtle'}`}
              >
                {statusText(t, b.status)}
              </span>
            </div>
            {live && b.plan && (
              <p className="text-ink-muted">
                {t.plural(b.interval === 'YEAR' ? 'billing.summary.year' : 'billing.summary.month', b.seats ?? 0)}{' '}
                {b.currentPeriodEnd &&
                  (b.cancelAtPeriodEnd
                    ? t('billing.summary.endsOn', { date: day(t, b.currentPeriodEnd) })
                    : t('billing.summary.renewsOn', { date: day(t, b.currentPeriodEnd) }))}
              </p>
            )}
            {b.status === 'CANCELLED' && (
              <p className="text-ink-muted">
                {b.currentPeriodEnd ? t('billing.endedOn', { date: day(t, b.currentPeriodEnd) }) : t('billing.ended')}
              </p>
            )}
            {b.pending && (
              <p role="status" className="text-ink-muted">
                {b.pendingSince ? t('billing.pendingSince', { date: day(t, b.pendingSince) }) : t('billing.pending')}
              </p>
            )}
            {b.status === 'NONE' && b.configured && !b.pending && <p className="text-ink-muted">{t('billing.choosePlanBelow')}</p>}
            {live && (
              <div className="flex flex-wrap gap-2 pt-1">
                {b.cancelAtPeriodEnd ? (
                  <button type="button" className={ghost} disabled={busy || locked} onClick={() => post('/api/v1/billing/resume')}>
                    {t('billing.resume')}
                  </button>
                ) : confirmCancel ? (
                  <>
                    <button
                      type="button"
                      className={`${ghost} text-danger`}
                      disabled={busy || locked}
                      onClick={() => post('/api/v1/billing/cancel')}
                    >
                      {t('billing.cancel.confirm')}
                    </button>
                    <button type="button" className={ghost} disabled={busy} onClick={() => setConfirmCancel(false)}>
                      {t('billing.cancel.keep')}
                    </button>
                  </>
                ) : (
                  <button type="button" className={ghost} disabled={busy || locked} onClick={() => setConfirmCancel(true)}>
                    {t('billing.cancel.start')}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-2xl border border-line bg-canvas p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{t('billing.usage.title')}</div>
            <Meter
              label={t('billing.seats.label')}
              used={t.number(usage.seats)}
              limit={limitText(t, usage.seatLimit)}
              percent={usagePercent(usage.seats, usage.seatLimit)}
            />
            <Meter
              label={t('billing.usage.courses')}
              used={t.number(usage.courses)}
              limit={limitText(t, usage.courseLimit)}
              percent={usagePercent(usage.courses, usage.courseLimit)}
            />
            <Meter
              label={t('billing.usage.storage')}
              used={formatBytes(usage.storageBytes)}
              limit={usage.storageLimitBytes === null ? t('billing.unlimited') : formatBytes(usage.storageLimitBytes)}
              percent={usagePercent(usage.storageBytes, usage.storageLimitBytes)}
            />
          </div>
        </div>
      )}

      {b && b.configured && plans.data && (
        <PlanPicker
          key={`${b.plan?.id}-${b.interval}-${b.seats}`}
          overview={b}
          plans={plans.data.data}
          onNeedProfile={() => setProfileOpen(true)}
          locked={locked}
        />
      )}
      {plans.error && <Banner kind="error">{plans.error}</Banner>}

      {b && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold text-ink-muted">{t('billing.details.title')}</h3>
            {b.profile && (
              <button
                type="button"
                className="text-[11px] font-semibold text-brand-fg underline"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((o) => !o)}
              >
                {profileOpen ? t('billing.details.hide') : t('billing.details.edit')}
              </button>
            )}
          </div>
          {b.profile && !profileOpen ? (
            <p className="text-xs text-ink-muted">
              {b.profile.gstin
                ? t('billing.details.summary', { name: b.profile.legalName, gstin: b.profile.gstin })
                : t('billing.details.summaryNoGstin', { name: b.profile.legalName })}
            </p>
          ) : (
            <ProfileForm overview={b} onSaved={overview.reload} locked={locked} />
          )}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-ink-muted">{t('billing.invoices.title')}</h3>
        {invoices.error && <Banner kind="error">{invoices.error}</Banner>}
        {downloadError && <Banner kind="error">{downloadError}</Banner>}
        {invoices.data && invoices.data.data.length === 0 && <p className="text-xs text-ink-muted">{t('billing.invoices.none')}</p>}
        {invoices.data && invoices.data.data.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="bg-canvas text-[11px] uppercase tracking-wider text-ink-subtle">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    {t('billing.invoices.col.invoice')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    {t('billing.invoices.col.date')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    {t('billing.invoices.col.gst')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    {t('billing.invoices.col.total')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    {t('billing.invoices.col.status')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    <span className="sr-only">{t('billing.invoices.col.download')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invoices.data.data.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-3 py-2.5 font-mono text-ink">{inv.number}</td>
                    <td className="px-3 py-2.5 text-ink-muted">
                      {t.date(inv.issuedAt, { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-3 py-2.5 text-right text-ink-muted">{formatInr(inv.taxPaise)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-ink">{formatInr(inv.amountPaise)}</td>
                    <td className="px-3 py-2.5 text-ink-muted">{statusText(t, inv.status)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        className={ghost}
                        onClick={() => pdf(inv)}
                        disabled={downloading !== null}
                        aria-label={t('billing.invoices.downloadAria', { number: inv.number })}
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};
