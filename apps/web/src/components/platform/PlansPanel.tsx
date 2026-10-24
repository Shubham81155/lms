'use client';

import React, { useState } from 'react';
import { CreditCard } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { formatInr, type Plan, type PlanInput } from '@/lib/billing';
import { TIERS, tierLabel, type Org } from '@/lib/platform';

// The platform operator's price list (what organisations can subscribe to) and the assignment of a plan to one
// organisation, for deals made outside Razorpay. Prices are typed in rupees per seat and stored in paise.

const input =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const primary =
  'inline-flex items-center gap-1 px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-lg text-[11px] font-bold transition-all';
const ghost =
  'inline-flex items-center gap-1 px-2.5 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';

const limit = (n: number | null, unit = '') => (n === null ? 'unlimited' : `${n.toLocaleString('en-IN')}${unit}`);

/** Blank means unlimited; otherwise a whole number of at least 1. `undefined` when the text is not one. */
const parseLimit = (v: string): number | null | undefined => {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
};
/** Rupees (up to two decimals) to paise. */
const parseRupees = (v: string): number | undefined => {
  if (!/^\d+(\.\d{1,2})?$/.test(v.trim())) return undefined;
  return Math.round(Number(v) * 100);
};
const rupeesText = (paise: number) => String(paise / 100);

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
  const monthlyPaise = parseRupees(d.monthly);
  const yearlyPaise = parseRupees(d.yearly);
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(d.code) || d.name.trim().length < 2) return null;
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
      onSaved(plan ? `Saved ${body.name}.` : `Added ${body.name}.`);
    });
  };

  return (
    <form
      onSubmit={save}
      className="grid grid-cols-1 gap-3 rounded-2xl border border-line bg-canvas p-4 sm:grid-cols-2 lg:grid-cols-4"
      aria-label={plan ? `Edit ${plan.name}` : 'New plan'}
    >
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        Name
        <input className={input} value={d.name} onChange={set('name')} maxLength={60} required />
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        Code (lower case, fixed once created)
        <input className={input} value={d.code} onChange={set('code')} maxLength={40} placeholder="growth" required disabled={!!plan} />
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        Feature set
        <select className={input} value={d.tier} onChange={set('tier')}>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {tierLabel(t)}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        Seat limit
        <input className={input} inputMode="numeric" value={d.seatLimit} onChange={set('seatLimit')} placeholder="required" required />
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        Course limit
        <input className={input} inputMode="numeric" value={d.courseLimit} onChange={set('courseLimit')} placeholder="blank: unlimited" />
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        Storage (GB)
        <input className={input} inputMode="numeric" value={d.storageGb} onChange={set('storageGb')} placeholder="blank: unlimited" />
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        Monthly price per seat (₹)
        <input className={input} inputMode="decimal" value={d.monthly} onChange={set('monthly')} placeholder="199" required />
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        Yearly price per seat (₹)
        <input className={input} inputMode="decimal" value={d.yearly} onChange={set('yearly')} placeholder="1999" required />
      </label>
      <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
        <button type="submit" className={primary} disabled={busy || !body}>
          {plan ? 'Save plan' : 'Add plan'}
        </button>
        <button type="button" className={ghost} onClick={onCancel}>
          Cancel
        </button>
        {!body && (
          <span className="text-[11px] text-ink-subtle">
            Limits are whole numbers (or blank); prices are rupees with up to two decimals.
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
  const orgs = useApiData<{ data: Org[] }>('/api/v1/operator/tenants');
  const { busy, error, run } = useAction();
  const [orgId, setOrgId] = useState('');
  const [planId, setPlanId] = useState('');
  const [seats, setSeats] = useState('');
  const org = orgs.data?.data.find((o) => o.id === orgId);
  const seatsN = seats.trim() === '' ? undefined : Number(seats);
  const seatsOk = seatsN === undefined || (Number.isInteger(seatsN) && seatsN >= 1);

  const assign = (e: React.FormEvent) => {
    e.preventDefault();
    if (!org) return;
    run(async () => {
      await api.post(`/api/v1/operator/organizations/${org.id}/plan`, {
        planId: planId || null,
        ...(seatsN !== undefined && planId ? { seats: seatsN } : {}),
      });
      onDone(planId ? `${org.name} is now on ${plans.find((p) => p.id === planId)?.name}.` : `${org.name} has no plan now.`);
      orgs.reload();
    });
  };

  return (
    <form
      onSubmit={assign}
      className="grid grid-cols-1 gap-3 rounded-2xl border border-line bg-canvas p-4 sm:grid-cols-4"
      aria-label="Assign a plan to an organisation"
    >
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        Organisation
        <select className={input} value={orgId} onChange={(e) => setOrgId(e.target.value)} required>
          <option value="">Choose…</option>
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
        Plan
        <select className={input} value={planId} onChange={(e) => setPlanId(e.target.value)}>
          <option value="">No plan</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
        Seats (optional)
        <input
          className={input}
          inputMode="numeric"
          value={seats}
          onChange={(e) => setSeats(e.target.value)}
          disabled={!planId}
          placeholder={org ? `${org.seatsUsed} in use` : ''}
        />
      </label>
      <div className="flex items-end">
        <button type="submit" className={primary} disabled={busy || !org || !seatsOk}>
          Assign
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
            Plans &amp; pricing
          </h2>
          <p className="text-xs text-ink-muted">
            What organisations can subscribe to. Changing a price affects new subscriptions; existing ones keep the price they bought at.
          </p>
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
            Add a plan
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

      {list.isLoading && plans.length === 0 && <p className="text-xs text-ink-subtle">Loading plans…</p>}
      {list.data && plans.length === 0 && <p className="text-xs text-ink-muted">No plans yet. Add one so organisations can subscribe.</p>}
      {plans.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-canvas text-[11px] uppercase tracking-wider text-ink-subtle">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  Plan
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  Features
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  Seats
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  Courses
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  Storage
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  Per seat / month
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  Per seat / year
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  <span className="sr-only">Edit</span>
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
                  <td className="px-3 py-2.5 text-ink-muted">{tierLabel(p.tier as never)}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{limit(p.seatLimit)}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{limit(p.courseLimit)}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{limit(p.storageGb, ' GB')}</td>
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
                      aria-label={`Edit ${p.name}`}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-ink-muted">Assign a plan to an organisation</h3>
        <p className="text-[11px] text-ink-subtle">
          For an agreement made outside online payment. It sets the plan, its limits and the seat count straight away.
        </p>
        <AssignPlan plans={plans} onDone={finished} />
      </div>
    </section>
  );
};
