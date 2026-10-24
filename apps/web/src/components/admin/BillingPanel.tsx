'use client';

import React, { useEffect, useState } from 'react';
import { CreditCard, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile, useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { useSupportSession } from '@/components/shell/SupportBanner';
import {
  formatBytes,
  formatDay,
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

// GST state codes (the first two digits of a GSTIN).
const STATES: [string, string][] = [
  ['01', 'Jammu & Kashmir'],
  ['02', 'Himachal Pradesh'],
  ['03', 'Punjab'],
  ['04', 'Chandigarh'],
  ['05', 'Uttarakhand'],
  ['06', 'Haryana'],
  ['07', 'Delhi'],
  ['08', 'Rajasthan'],
  ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'],
  ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'],
  ['13', 'Nagaland'],
  ['14', 'Manipur'],
  ['15', 'Mizoram'],
  ['16', 'Tripura'],
  ['17', 'Meghalaya'],
  ['18', 'Assam'],
  ['19', 'West Bengal'],
  ['20', 'Jharkhand'],
  ['21', 'Odisha'],
  ['22', 'Chhattisgarh'],
  ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'],
  ['26', 'Dadra & Nagar Haveli and Daman & Diu'],
  ['27', 'Maharashtra'],
  ['29', 'Karnataka'],
  ['30', 'Goa'],
  ['31', 'Lakshadweep'],
  ['32', 'Kerala'],
  ['33', 'Tamil Nadu'],
  ['34', 'Puducherry'],
  ['35', 'Andaman & Nicobar Islands'],
  ['36', 'Telangana'],
  ['37', 'Andhra Pradesh'],
  ['38', 'Ladakh'],
];

const day = (iso: string) => formatDay(iso);
const limitText = (n: number | null) => (n === null ? 'unlimited' : n.toLocaleString('en-IN'));

const Meter: React.FC<{ label: string; used: string; limit: string; percent: number | null }> = ({ label, used, limit, percent }) => (
  <div className="space-y-1">
    <div className="flex items-baseline justify-between text-[11px]">
      <span className="font-semibold text-ink-muted">{label}</span>
      <span className="text-ink">
        {used} <span className="text-ink-subtle">of {limit}</span>
      </span>
    </div>
    <div
      role="progressbar"
      aria-label={`${label} used`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? 0}
      aria-valuetext={percent === null ? `${used}, no limit` : `${percent}% used`}
      className="h-1.5 overflow-hidden rounded-full bg-canvas"
    >
      <div
        className={`h-full rounded-full ${percent !== null && percent >= 90 ? 'bg-danger' : percent !== null && percent >= 75 ? 'bg-accent' : 'bg-brand'}`}
        style={{ width: `${percent ?? 0}%` }}
      />
    </div>
  </div>
);

/** Shown above every administration page: a failed payment, or a subscription that ends. Links to the Billing tab. */
export const BillingBanner: React.FC<{ onOpenBilling: () => void }> = ({ onOpenBilling }) => {
  const { data } = useApiData<{ data: BillingOverview }>('/api/v1/billing');
  const b = data?.data;
  if (!b) return null;
  const message =
    b.status === 'PAST_DUE'
      ? 'The last payment failed. Update your payment to keep your plan.'
      : b.status === 'ACTIVE' && b.cancelAtPeriodEnd && b.currentPeriodEnd
        ? `Your subscription ends on ${day(b.currentPeriodEnd)} and will not renew.`
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
        Go to Billing
      </button>
    </div>
  );
};

const ProfileForm: React.FC<{ overview: BillingOverview; onSaved: () => void; locked: boolean }> = ({ overview, onSaved, locked }) => {
  const p = overview.profile;
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
      aria-label="Billing details"
    >
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        Legal name (on invoices)
        <input className={field} value={legalName} onChange={(e) => setLegalName(e.target.value)} maxLength={200} required />
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        GSTIN (optional)
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
            Not a valid GSTIN (15 characters).
          </span>
        )}
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted sm:col-span-2">
        Billing address
        <textarea className={field} rows={2} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} required />
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        State (decides CGST/SGST or IGST)
        <select
          className={field}
          value={stateCode}
          onChange={(e) => setStateCode(e.target.value)}
          required
          aria-describedby={mismatch ? 'state-err' : undefined}
          aria-invalid={mismatch}
        >
          <option value="">Choose a state…</option>
          {STATES.map(([code, name]) => (
            <option key={code} value={code}>
              {name} ({code})
            </option>
          ))}
        </select>
        {mismatch && (
          <span id="state-err" className="block font-normal text-danger">
            The GSTIN begins with {gstin.trim().slice(0, 2)}, which is not this state.
          </span>
        )}
      </label>
      <div className="flex items-end gap-3">
        <button type="submit" className={primary} disabled={busy || !valid}>
          Save billing details
        </button>
        {saved && (
          <span role="status" className="text-[11px] text-success">
            Saved.
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
      if (!isRazorpayUrl(res.data.shortUrl)) throw new Error('The payment page could not be opened. Please try again or contact us.');
      setRedirecting(true);
      window.location.assign(res.data.shortUrl);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xs font-semibold text-ink-muted">{current ? 'Plans' : 'Choose a plan'}</h3>
        <div
          role="radiogroup"
          aria-label="Billing interval"
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
              {i === 'MONTH' ? 'Monthly' : 'Yearly'}
            </button>
          ))}
        </div>
      </div>
      {plans.length === 0 && <p className="text-xs text-ink-muted">No plans are available yet. Contact us.</p>}
      <div role="radiogroup" aria-label="Plan" className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
                    Current
                  </span>
                )}
              </div>
              <div className="text-ink">
                <span className="text-lg font-extrabold">{formatInr(price)}</span>{' '}
                <span className="text-ink-subtle">per seat / {interval === 'YEAR' ? 'year' : 'month'}</span>
              </div>
              <ul className="space-y-0.5 text-[11px] text-ink-muted">
                <li>{p.seatLimit === null ? 'Unlimited seats' : `Up to ${limitText(p.seatLimit)} seats`}</li>
                <li>{p.courseLimit === null ? 'Unlimited courses' : `Up to ${limitText(p.courseLimit)} courses`}</li>
                <li>{p.storageGb === null ? 'Unlimited storage' : `${limitText(p.storageGb)} GB storage`}</li>
              </ul>
            </button>
          );
        })}
      </div>
      {current && (
        <p className="rounded-2xl border border-line bg-canvas p-4 text-xs text-ink-muted">
          You are on a plan already. To move to another, cancel the subscription (it runs to the end of the period you paid for), then
          choose a new plan once it has ended. To change sooner, contact us.
        </p>
      )}
      {plan && !current && (
        <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-line bg-canvas p-4">
          <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
            Seats
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
              {seatsOk ? `${formatInr(planTotalPaise(plan, interval, n))} per ${interval === 'YEAR' ? 'year' : 'month'}` : '—'}
            </div>
            <div id="seats-hint" className="text-[11px] text-ink-subtle">
              plus GST.{' '}
              {n < minSeats
                ? `${minSeats} seats are in use.`
                : plan.seatLimit !== null && n > plan.seatLimit
                  ? `${plan.name} has up to ${limitText(plan.seatLimit)} seats.`
                  : ''}
            </div>
          </div>
          <button type="button" className={primary} disabled={busy || redirecting || !seatsOk || !canBuy} onClick={subscribe}>
            {redirecting ? 'Opening the payment page…' : 'Subscribe'}
          </button>
          {!overview.profile && overview.configured && !current && (
            <button type="button" className="text-[11px] font-semibold text-brand-fg underline" onClick={onNeedProfile}>
              Add your billing details first
            </button>
          )}
        </div>
      )}
      {error && <Banner kind="error">{error}</Banner>}
    </div>
  );
};

export const BillingPanel: React.FC = () => {
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
      setDownloadError(`Could not download invoice ${inv.number}. Try again.`);
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
          Billing
        </h2>
        <p className="text-xs text-ink-muted">Your plan, what you use of it, your invoices and the GST details they are issued with.</p>
      </div>

      {(overview.error || error) && <Banner kind="error">{overview.error || error}</Banner>}
      {overview.isLoading && !b && <p className="text-xs text-ink-subtle">Loading…</p>}

      {b && !b.configured && (
        <div role="status" className="rounded-2xl border border-line bg-canvas p-4 text-xs text-ink-muted">
          <span className="font-semibold text-ink">Online payment is not set up on this platform yet.</span> You cannot buy or change a plan
          here; contact the platform operator to arrange your plan.
        </div>
      )}
      {b?.status === 'PAST_DUE' && (
        <div role="alert" className="rounded-2xl border border-danger/40 bg-danger/5 p-4 text-xs text-ink">
          <span className="font-semibold">The last payment failed.</span> Razorpay retries it for a few days; update your payment method
          using the link in Razorpay's e-mail. If it keeps failing, the organisation becomes read-only. Contact us if you need help.
        </div>
      )}

      {b && usage && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-2xl border border-line bg-canvas p-4 text-xs">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Current plan</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-extrabold text-ink">{b.plan?.name ?? 'No paid plan'}</span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${b.status === 'ACTIVE' ? 'border-success/30 bg-success/10 text-success' : b.status === 'PAST_DUE' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-line text-ink-subtle'}`}
              >
                {b.status === 'NONE' ? 'none' : b.status === 'PAST_DUE' ? 'payment failed' : b.status.toLowerCase()}
              </span>
            </div>
            {live && b.plan && (
              <p className="text-ink-muted">
                {b.seats} seats, billed {b.interval === 'YEAR' ? 'yearly' : 'monthly'}.{' '}
                {b.currentPeriodEnd &&
                  (b.cancelAtPeriodEnd
                    ? `Ends on ${day(b.currentPeriodEnd)}; it will not renew.`
                    : `Renews on ${day(b.currentPeriodEnd)}.`)}
              </p>
            )}
            {b.status === 'CANCELLED' && (
              <p className="text-ink-muted">
                Your subscription has ended{b.currentPeriodEnd ? ` (${day(b.currentPeriodEnd)})` : ''}. Choose a plan to start again.
              </p>
            )}
            {b.pending && (
              <p role="status" className="text-ink-muted">
                A payment{b.pendingSince ? ` started on ${day(b.pendingSince)}` : ''} is waiting for confirmation from Razorpay. If you have
                paid, this page updates once it arrives; if you left without paying, you can choose a plan again below.
              </p>
            )}
            {b.status === 'NONE' && b.configured && !b.pending && <p className="text-ink-muted">Choose a plan below to subscribe.</p>}
            {live && (
              <div className="flex flex-wrap gap-2 pt-1">
                {b.cancelAtPeriodEnd ? (
                  <button type="button" className={ghost} disabled={busy || locked} onClick={() => post('/api/v1/billing/resume')}>
                    Keep my subscription
                  </button>
                ) : confirmCancel ? (
                  <>
                    <button
                      type="button"
                      className={`${ghost} text-danger`}
                      disabled={busy || locked}
                      onClick={() => post('/api/v1/billing/cancel')}
                    >
                      Cancel at period end
                    </button>
                    <button type="button" className={ghost} disabled={busy} onClick={() => setConfirmCancel(false)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" className={ghost} disabled={busy || locked} onClick={() => setConfirmCancel(true)}>
                    Cancel subscription
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-2xl border border-line bg-canvas p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Usage</div>
            <Meter
              label="Seats"
              used={usage.seats.toLocaleString('en-IN')}
              limit={limitText(usage.seatLimit)}
              percent={usagePercent(usage.seats, usage.seatLimit)}
            />
            <Meter
              label="Courses"
              used={usage.courses.toLocaleString('en-IN')}
              limit={limitText(usage.courseLimit)}
              percent={usagePercent(usage.courses, usage.courseLimit)}
            />
            <Meter
              label="Storage"
              used={formatBytes(usage.storageBytes)}
              limit={usage.storageLimitBytes === null ? 'unlimited' : formatBytes(usage.storageLimitBytes)}
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
            <h3 className="text-xs font-semibold text-ink-muted">Billing details</h3>
            {b.profile && (
              <button
                type="button"
                className="text-[11px] font-semibold text-brand-fg underline"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((o) => !o)}
              >
                {profileOpen ? 'Hide' : 'Edit'}
              </button>
            )}
          </div>
          {b.profile && !profileOpen ? (
            <p className="text-xs text-ink-muted">
              {b.profile.legalName}
              {b.profile.gstin ? ` · GSTIN ${b.profile.gstin}` : ' · no GSTIN'}
            </p>
          ) : (
            <ProfileForm overview={b} onSaved={overview.reload} locked={locked} />
          )}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-ink-muted">Invoices</h3>
        {invoices.error && <Banner kind="error">{invoices.error}</Banner>}
        {downloadError && <Banner kind="error">{downloadError}</Banner>}
        {invoices.data && invoices.data.data.length === 0 && <p className="text-xs text-ink-muted">No invoices yet.</p>}
        {invoices.data && invoices.data.data.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="bg-canvas text-[11px] uppercase tracking-wider text-ink-subtle">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Invoice
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Date
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    GST
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Total
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    <span className="sr-only">Download</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invoices.data.data.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-3 py-2.5 font-mono text-ink">{inv.number}</td>
                    <td className="px-3 py-2.5 text-ink-muted">{formatDay(inv.issuedAt, 'medium')}</td>
                    <td className="px-3 py-2.5 text-right text-ink-muted">{formatInr(inv.taxPaise)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-ink">{formatInr(inv.amountPaise)}</td>
                    <td className="px-3 py-2.5 text-ink-muted">{inv.status.toLowerCase()}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        className={ghost}
                        onClick={() => pdf(inv)}
                        disabled={downloading !== null}
                        aria-label={`Download invoice ${inv.number} as PDF`}
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
