'use client';

import React, { useState } from 'react';
import { CreditCard } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import {
  formatInr,
  MONTHLY_PAISE,
  parseLimit,
  parseRupees,
  PLAN_CODE,
  PLAN_LIMIT_MAX,
  rupeesText,
  YEARLY_PAISE,
  type Plan,
  type PlanInput,
} from '@/lib/billing';
import { TIERS, type Org } from '@/lib/platform';
import { useT, type Translator } from '@/lib/i18n';
import type { MessageKey } from '@/locales/en';

// The platform operator's price list (what organisations can subscribe to) and the assignment of a plan to one
// organisation, for deals made outside Razorpay. Prices are typed in rupees per seat and stored in paise.

const input =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const primary =
  'inline-flex items-center gap-1 px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-lg text-[11px] font-bold transition-all';
const ghost =
  'inline-flex items-center gap-1 px-2.5 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';

const limit = (t: Translator, n: number | null, unit = '') => (n === null ? t('plans.unlimited') : `${t.number(n)}${unit}`);

const TIER_KEY: Record<string, MessageKey> = {
  STARTER: 'plans.tier.STARTER',
  PROFESSIONAL: 'plans.tier.PROFESSIONAL',
  ENTERPRISE: 'plans.tier.ENTERPRISE',
};
const tierText = (t: Translator, tier: string) => (TIER_KEY[tier] ? t(TIER_KEY[tier]) : tier);

interface Draft {
  code: string;
  name: string;
  tier: string;
  seatLimit: string;
  courseLimit: string;
  storageGb: string;
  monthly: string;
  yearly: string;
}
const emptyDraft: Draft = {
  code: '',
  name: '',
  tier: 'PROFESSIONAL',
  seatLimit: '',
  courseLimit: '',
  storageGb: '',
  monthly: '',
  yearly: '',
};
const draftOf = (p: Plan): Draft => ({
  code: p.code,
  name: p.name,
  tier: p.tier,
  seatLimit: p.seatLimit === null ? '' : String(p.seatLimit),
  courseLimit: p.courseLimit === null ? '' : String(p.courseLimit),
  storageGb: p.storageGb === null ? '' : String(p.storageGb),
  monthly: rupeesText(p.monthlyPaise),
  yearly: rupeesText(p.yearlyPaise),
});

/** The API input for a draft, or null while any field is not valid. */
function inputOf(d: Draft): PlanInput | null {
  const seatLimit = parseLimit(d.seatLimit);
  const courseLimit = parseLimit(d.courseLimit);
  const storageGb = parseLimit(d.storageGb);
  const monthlyPaise = parseRupees(d.monthly, MONTHLY_PAISE);
  const yearlyPaise = parseRupees(d.yearly, YEARLY_PAISE);
  if (!PLAN_CODE.test(d.code) || d.name.trim().length < 2 || d.name.trim().length > 80) return null;
  if (
    seatLimit === undefined ||
    seatLimit === null ||
    courseLimit === undefined ||
    storageGb === undefined ||
    monthlyPaise === undefined ||
    yearlyPaise === undefined
  )
    return null;
  return { code: d.code, name: d.name.trim(), tier: d.tier, seatLimit, courseLimit, storageGb, monthlyPaise, yearlyPaise };
}

const PlanForm: React.FC<{ plan: Plan | null; onSaved: (message: string) => void; onCancel: () => void }> = ({
  plan,
  onSaved,
  onCancel,
}) => {
  const t = useT();
  const { busy, error, run } = useAction();
  const [d, setD] = useState<Draft>(plan ? draftOf(plan) : emptyDraft);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setD((x) => ({ ...x, [k]: e.target.value }));
  const body = inputOf(d);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body) return;
    run(async () => {
      if (plan) {
        const { code: _fixed, ...changes } = body;
        await api.patch(`/api/v1/operator/plans/${plan.id}`, changes);
      } else await api.post('/api/v1/operator/plans', body);
      onSaved(t(plan ? 'plans.saved' : 'plans.added', { name: body.name }));
    });
  };

  return (
    <form
      onSubmit={save}
      className="grid grid-cols-1 gap-3 rounded-2xl border border-line bg-canvas p-4 sm:grid-cols-2 lg:grid-cols-4"
      aria-label={plan ? t('plans.editNamed', { name: plan.name }) : t('plans.newPlan')}
    >
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        {t('plans.form.name')}
        <input className={input} value={d.name} onChange={set('name')} maxLength={80} required />
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        {t('plans.form.code')}
        <input className={input} value={d.code} onChange={set('code')} maxLength={32} placeholder="growth" required disabled={!!plan} />
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        {t('plans.form.tier')}
        <select className={input} value={d.tier} onChange={set('tier')}>
          {TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {tierText(t, tier)}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        {t('plans.form.seatLimit')}
        <input
          className={input}
          inputMode="numeric"
          value={d.seatLimit}
          onChange={set('seatLimit')}
          placeholder={t('plans.form.required')}
          required
        />
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        {t('plans.form.courseLimit')}
        <input
          className={input}
          inputMode="numeric"
          value={d.courseLimit}
          onChange={set('courseLimit')}
          placeholder={t('plans.form.blankUnlimited')}
        />
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        {t('plans.form.storage')}
        <input
          className={input}
          inputMode="numeric"
          value={d.storageGb}
          onChange={set('storageGb')}
          placeholder={t('plans.form.blankUnlimited')}
        />
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        {t('plans.form.monthly')}
        <input className={input} inputMode="decimal" value={d.monthly} onChange={set('monthly')} placeholder="199" required />
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        {t('plans.form.yearly')}
        <input className={input} inputMode="decimal" value={d.yearly} onChange={set('yearly')} placeholder="1999" required />
      </label>
      <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
        <button type="submit" className={primary} disabled={busy || !body} aria-describedby={body ? undefined : 'plan-form-hint'}>
          {plan ? t('plans.form.save') : t('plans.form.add')}
        </button>
        <button type="button" className={ghost} onClick={onCancel}>
          {t('plans.form.cancel')}
        </button>
        {!body && (
          <span id="plan-form-hint" className="text-[11px] text-ink-subtle">
            {t('plans.form.hint')}
          </span>
        )}
      </div>
      {error && (
        <div className="sm:col-span-2 lg:col-span-4">
          <Banner kind="error">{error}</Banner>
        </div>
      )}
    </form>
  );
};

/** Gives one organisation a plan (or none) and seat count without going through payment. */
const AssignPlan: React.FC<{ plans: Plan[]; onDone: (message: string) => void }> = ({ plans, onDone }) => {
  const t = useT();
  const orgs = useApiData<{ data: Org[] }>('/api/v1/operator/tenants');
  const { busy, error, run } = useAction();
  const [orgId, setOrgId] = useState('');
  const [planId, setPlanId] = useState('');
  const [seats, setSeats] = useState('');
  const org = orgs.data?.data.find((o) => o.id === orgId);
  const seatsN = seats.trim() === '' ? undefined : Number(seats);
  const seatsOk = seatsN === undefined || (Number.isInteger(seatsN) && seatsN >= 1 && seatsN <= PLAN_LIMIT_MAX);

  const assign = (e: React.FormEvent) => {
    e.preventDefault();
    if (!org) return;
    run(async () => {
      await api.post(`/api/v1/operator/organizations/${org.id}/plan`, {
        planId: planId || null,
        ...(seatsN !== undefined && planId ? { seats: seatsN } : {}),
      });
      onDone(
        planId
          ? t('plans.assign.done', { org: org.name, plan: plans.find((p) => p.id === planId)?.name ?? '' })
          : t('plans.assign.none', { org: org.name })
      );
      orgs.reload();
    });
  };

  return (
    <form
      onSubmit={assign}
      className="grid grid-cols-1 gap-3 rounded-2xl border border-line bg-canvas p-4 sm:grid-cols-4"
      aria-label={t('plans.assign.title')}
    >
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        {t('plans.assign.org')}
        <select className={input} value={orgId} onChange={(e) => setOrgId(e.target.value)} required>
          <option value="">{t('plans.assign.choose')}</option>
          {(orgs.data?.data ?? [])
            .filter((o) => o.status !== 'ARCHIVED')
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.slug})
              </option>
            ))}
        </select>
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        {t('plans.assign.plan')}
        <select className={input} value={planId} onChange={(e) => setPlanId(e.target.value)}>
          <option value="">{t('plans.assign.noPlan')}</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        {t('plans.assign.seats')}
        <input
          className={input}
          inputMode="numeric"
          value={seats}
          onChange={(e) => setSeats(e.target.value)}
          disabled={!planId}
          placeholder={org ? t('plans.assign.inUse', { count: t.number(org.seatsUsed) }) : ''}
        />
      </label>
      <div className="flex items-end">
        <button type="submit" className={primary} disabled={busy || !org || !seatsOk}>
          {t('plans.assign.submit')}
        </button>
      </div>
      {error && (
        <div className="sm:col-span-4">
          <Banner kind="error">{error}</Banner>
        </div>
      )}
    </form>
  );
};

export const PlansPanel: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const t = useT();
  const list = useApiData<{ data: Plan[] }>('/api/v1/operator/plans');
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const plans = list.data?.data ?? [];

  const finished = (message: string) => {
    setEditing(null);
    setDone(message);
    list.reload();
    onChanged?.();
  };

  return (
    <section className="space-y-5 rounded-3xl border border-line bg-surface p-6 shadow-xl" aria-labelledby="plans-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="plans-h" className="flex items-center gap-2 font-bold text-base text-ink">
            <CreditCard className="h-4 w-4 text-accent" aria-hidden="true" />
            {t('plans.title')}
          </h2>
          <p className="text-xs text-ink-muted">{t('plans.intro')}</p>
        </div>
        {editing === null && (
          <button
            type="button"
            className={primary}
            onClick={() => {
              setDone(null);
              setEditing('new');
            }}
          >
            {t('plans.add')}
          </button>
        )}
      </div>

      {done && <Banner kind="ok">{done}</Banner>}
      {list.error && <Banner kind="error">{list.error}</Banner>}
      {editing && (
        <PlanForm
          key={editing === 'new' ? 'new' : editing.id}
          plan={editing === 'new' ? null : editing}
          onSaved={finished}
          onCancel={() => setEditing(null)}
        />
      )}

      {list.isLoading && plans.length === 0 && <p className="text-xs text-ink-subtle">{t('plans.loading')}</p>}
      {list.data && plans.length === 0 && <p className="text-xs text-ink-muted">{t('plans.empty')}</p>}
      {plans.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-canvas text-[11px] uppercase tracking-wider text-ink-subtle">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  {t('plans.col.plan')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  {t('plans.col.features')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  {t('plans.col.seats')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  {t('plans.col.courses')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  {t('plans.col.storage')}
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  {t('plans.col.perMonth')}
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  {t('plans.col.perYear')}
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  <span className="sr-only">{t('plans.edit')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {plans.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-ink">{p.name}</div>
                    <div className="font-mono text-[11px] text-ink-subtle">{p.code}</div>
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">{tierText(t, p.tier)}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{limit(t, p.seatLimit)}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{limit(t, p.courseLimit)}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{limit(t, p.storageGb, t('plans.gbUnit'))}</td>
                  <td className="px-3 py-2.5 text-right text-ink">{formatInr(p.monthlyPaise)}</td>
                  <td className="px-3 py-2.5 text-right text-ink">{formatInr(p.yearlyPaise)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      className={ghost}
                      onClick={() => {
                        setDone(null);
                        setEditing(p);
                      }}
                      aria-label={t('plans.editNamed', { name: p.name })}
                    >
                      {t('plans.edit')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-ink-muted">{t('plans.assign.title')}</h3>
        <p className="text-[11px] text-ink-subtle">{t('plans.assign.intro')}</p>
        <AssignPlan plans={plans} onDone={finished} />
      </div>
    </section>
  );
};
