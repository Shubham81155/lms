'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Globe, Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useT, type Translator } from '@/lib/i18n';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { FEATURE_LABELS } from '@/components/admin/PlatformPanels';
import { CustomDomainEditor } from '@/components/admin/CustomDomainPanel';
import { TrialControls, TrialDaysField, parseTrialDays } from '@/components/platform/TrialControls';
import { OffboardingPanel } from '@/components/admin/OffboardingPanel';
import { DeletedOrganisations, DeletionBadge, useOffboardingOverview } from '@/components/platform/OffboardingControls';
import { TIERS, isValidSlug, suggestSlug, type InvitationResult, type Org, type Tier } from '@/lib/platform';

const field = 'bg-canvas border border-line rounded-lg px-2 py-1 text-xs text-ink focus:outline-none focus:border-brand';
const input =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const primary =
  'inline-flex items-center gap-1 px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-lg text-[11px] font-bold transition-all';
const ghost =
  'inline-flex items-center gap-1 px-2.5 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-success/10 text-success border-success/30',
  TRIAL: 'bg-accent/10 text-accent border-accent/30',
  SUSPENDED: 'bg-danger/10 text-danger border-danger/30',
  ARCHIVED: 'bg-canvas text-ink-subtle border-line',
};

const tierName = (t: Translator, tier: string) => t.dyn(`plans.tier.${tier}`, tier.charAt(0) + tier.slice(1).toLowerCase());

const invitationText = (t: Translator, result: InvitationResult | undefined, email: string) =>
  t.dyn(`operator.invite.${result ?? 'not_configured'}`, t('operator.invite.not_configured', { email }), { email });

/**
 * Every organisation on the platform: its plan (tier, seats, feature overrides), its custom domain, whether it is
 * active, and a form to create one directly. `focusId` scrolls to and highlights one row (e.g. after approving a request).
 * `onChanged` runs after every change here, so the page's own figures (organisations, trials ending) follow.
 */
export const OrganisationsPanel: React.FC<{
  ownTenantId?: string;
  focusId?: string | null;
  refreshKey?: number;
  onChanged?: () => void;
}> = ({ ownTenantId, focusId, refreshKey, onChanged }) => {
  const t = useT();
  const list = useApiData<{ data: Org[] }>('/api/v1/operator/tenants');
  const { busy, error, run, clearError } = useAction();
  const [quota, setQuota] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<{ id: string; to: 'ACTIVE' | 'SUSPENDED' } | null>(null);
  const [creating, setCreating] = useState(false);
  const [domainFor, setDomainFor] = useState<string | null>(null);
  const [dataFor, setDataFor] = useState<string | null>(null);
  const offboarding = useOffboardingOverview(refreshKey);
  const [done, setDone] = useState<string | null>(null);
  const focusRef = useRef<HTMLTableRowElement | null>(null);

  const { reload: reloadList } = list;
  const reload = useCallback(async () => {
    await reloadList();
    onChanged?.();
  }, [reloadList, onChanged]);
  useEffect(() => {
    if (refreshKey) reloadList();
  }, [refreshKey, reloadList]);
  useEffect(() => {
    if (focusId && focusRef.current) focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId, list.data]);

  const orgs = list.data?.data ?? [];
  const deletions = new Map((offboarding.data?.data.scheduled ?? []).map((d) => [d.tenantId, d]));

  const patch = (id: string, body: Record<string, unknown>) =>
    run(async () => {
      setDone(null);
      try {
        await api.patch(`/api/v1/operator/tenants/${id}`, body);
      } finally {
        await reload();
      }
    });
  const setStatus = (o: Org, status: 'ACTIVE' | 'SUSPENDED') =>
    run(async () => {
      setDone(null);
      try {
        await api.patch(`/api/v1/operator/tenants/${o.id}/status`, { status });
        setDone(
          status === 'SUSPENDED' ? t('operator.orgs.msg.suspended', { name: o.name }) : t('operator.orgs.msg.active', { name: o.name })
        );
      } finally {
        setConfirming(null);
        await reload();
      }
    });

  return (
    <section className="bg-surface border border-line rounded-3xl p-6 shadow-xl space-y-4" aria-labelledby="orgs-h">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="orgs-h" className="font-bold text-base text-ink">
            {t('operator.orgs.title')}
          </h2>
          <p className="text-xs text-ink-muted">{t('operator.orgs.intro')}</p>
        </div>
        {!creating && (
          <button
            type="button"
            className={primary}
            onClick={() => {
              clearError();
              setDone(null);
              setCreating(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> {t('operator.orgs.new')}
          </button>
        )}
      </div>

      {creating && (
        <NewOrganisationForm
          onCancel={() => setCreating(false)}
          onCreated={async (text) => {
            setCreating(false);
            setDone(text);
            await reload();
          }}
        />
      )}

      {done && <Banner kind="ok">{done}</Banner>}
      {(error || list.error) && <Banner kind="error">{error || list.error}</Banner>}
      {list.isLoading && orgs.length === 0 && <p className="text-xs text-ink-subtle">{t('operator.orgs.loading')}</p>}

      {orgs.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead className="bg-canvas text-[11px] uppercase tracking-wider text-ink-subtle">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  {t('operator.orgs.col.org')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  {t('operator.orgs.col.status')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  {t('operator.orgs.col.plan')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  {t('operator.orgs.col.seats')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  {t('operator.orgs.col.features')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold text-right">
                  {t('operator.orgs.col.access')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orgs.map((o) => {
                const own = o.id === ownTenantId;
                const focused = o.id === focusId;
                return (
                  <React.Fragment key={o.id}>
                    <tr ref={focused ? focusRef : undefined} className={`align-top ${focused ? 'bg-brand/10' : ''}`}>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-ink">
                          {o.name}
                          {own && <span className="ml-1 text-[10px] font-normal text-ink-subtle">{t('operator.orgs.own')}</span>}
                        </div>
                        <div className="font-mono text-[11px] text-ink-subtle">{o.slug}</div>
                        {o.customDomain && (
                          <div className="text-[11px] text-ink-subtle" title={t('operator.orgs.domainVerified')}>
                            {o.customDomain}
                          </div>
                        )}
                        {o.pendingCustomDomain && (
                          <div className="text-[11px] text-accent" title={t('operator.orgs.domainWaiting')}>
                            {t('operator.orgs.domainVerifying', { domain: o.pendingCustomDomain })}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLE[o.status] ?? STATUS_STYLE.ARCHIVED}`}
                        >
                          {t.dyn(`operator.status.${o.status}`, o.status.toLowerCase())}
                        </span>
                        {!own && (
                          <TrialControls
                            org={o}
                            onChanged={async (_o, text) => {
                              setDone(text);
                              await reload();
                            }}
                          />
                        )}
                        {deletions.get(o.id) && (
                          <DeletionBadge scheduledAt={deletions.get(o.id)!.scheduledAt} byOperator={deletions.get(o.id)!.byOperator} />
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <select
                          aria-label={t('operator.orgs.planAria', { name: o.name })}
                          value={o.tier}
                          disabled={busy}
                          onChange={(e) => patch(o.id, { tier: e.target.value })}
                          className={field}
                        >
                          {TIERS.map((tier) => (
                            <option key={tier} value={tier}>
                              {tierName(t, tier)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        <form
                          className="flex items-center gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const v = (quota[o.id] ?? '').trim();
                            patch(o.id, { seatQuota: v === '' ? null : Number(v) });
                          }}
                        >
                          <span className="whitespace-nowrap text-ink">{o.seatsUsed} /</span>
                          <input
                            type="number"
                            min={1}
                            aria-label={t('operator.orgs.seatAria', { name: o.name })}
                            placeholder={o.seatQuota ? String(o.seatQuota) : '∞'}
                            value={quota[o.id] ?? ''}
                            onChange={(e) => setQuota((q) => ({ ...q, [o.id]: e.target.value }))}
                            className={`${field} w-20`}
                          />
                          <button disabled={busy} className="text-[11px] font-semibold text-brand-fg disabled:opacity-50">
                            {t('operator.orgs.set')}
                          </button>
                        </form>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(FEATURE_LABELS).map(([key, meta]) => {
                            const on = !!o.features[key];
                            const overridden = key in o.overrides;
                            const featureLabel = t.dyn(`orgadm.feature.${key}.label`, meta.label);
                            return (
                              <span key={key} className="inline-flex items-center">
                                <button
                                  type="button"
                                  disabled={busy}
                                  title={overridden ? t('operator.orgs.featureSet') : t('operator.orgs.featureDefault')}
                                  onClick={() => patch(o.id, { features: { [key]: !on } })}
                                  aria-pressed={on}
                                  aria-label={t('operator.orgs.featureAria', { feature: featureLabel, name: o.name })}
                                  className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${on ? 'bg-brand/15 text-brand-fg border-brand/40' : 'bg-canvas text-ink-subtle border-line'} ${overridden ? 'ring-1 ring-accent/60' : ''}`}
                                >
                                  {featureLabel}
                                </button>
                                {overridden && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => patch(o.id, { features: { [key]: null } })}
                                    aria-label={t('operator.orgs.featureResetAria', { feature: featureLabel, name: o.name })}
                                    title={t('operator.orgs.featureReset')}
                                    className="ml-0.5 px-1 text-[11px] text-ink-subtle hover:text-ink"
                                  >
                                    ↺
                                  </button>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          className={`${ghost} mr-2`}
                          aria-expanded={domainFor === o.id}
                          aria-label={t('operator.orgs.domainAria', { name: o.name })}
                          onClick={() => setDomainFor((id) => (id === o.id ? null : o.id))}
                        >
                          <Globe className="h-3 w-3" /> {t('operator.orgs.domain')}
                        </button>
                        <button
                          type="button"
                          className={`${ghost} mr-2`}
                          aria-expanded={dataFor === o.id}
                          aria-label={t('operator.orgs.dataAria', { name: o.name })}
                          onClick={() => setDataFor((id) => (id === o.id ? null : o.id))}
                        >
                          <Archive className="h-3 w-3" /> {t('operator.orgs.data')}
                        </button>
                        {!own &&
                          (o.status === 'SUSPENDED' ? (
                            <button
                              type="button"
                              className={ghost}
                              disabled={busy}
                              onClick={() => {
                                clearError();
                                setConfirming({ id: o.id, to: 'ACTIVE' });
                              }}
                            >
                              {t('operator.orgs.reactivate')}
                            </button>
                          ) : o.status !== 'ARCHIVED' ? (
                            <button
                              type="button"
                              className={ghost}
                              disabled={busy}
                              onClick={() => {
                                clearError();
                                setConfirming({ id: o.id, to: 'SUSPENDED' });
                              }}
                            >
                              {t('operator.orgs.suspend')}
                            </button>
                          ) : null)}
                        {confirming?.id === o.id && (
                          <div
                            role="alertdialog"
                            aria-label={t(confirming.to === 'SUSPENDED' ? 'operator.orgs.suspendAria' : 'operator.orgs.reactivateAria', {
                              name: o.name,
                            })}
                            className={`mt-2 rounded-xl border p-3 text-left ${confirming.to === 'SUSPENDED' ? 'border-danger/40 bg-danger/5' : 'border-success/40 bg-success/5'}`}
                          >
                            <p className="text-[11px] text-ink">
                              {confirming.to === 'SUSPENDED' ? t('operator.orgs.suspendBody') : t('operator.orgs.reactivateBody')}
                            </p>
                            <div className="mt-2 flex justify-end gap-2">
                              <button type="button" className={ghost} disabled={busy} onClick={() => setConfirming(null)}>
                                {t('operator.cancel')}
                              </button>
                              <button
                                type="button"
                                className={
                                  confirming.to === 'SUSPENDED'
                                    ? 'px-3 py-1.5 bg-danger hover:opacity-90 text-on-danger rounded-lg text-[11px] font-bold disabled:opacity-50'
                                    : primary
                                }
                                disabled={busy}
                                onClick={() => setStatus(o, confirming.to)}
                              >
                                {confirming.to === 'SUSPENDED' ? t('operator.orgs.suspend') : t('operator.orgs.reactivate')}
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                    {dataFor === o.id && (
                      <tr className="bg-canvas/50">
                        <td colSpan={6} className="px-3 py-4">
                          <div className="flex justify-end">
                            <button
                              type="button"
                              aria-label={t('common.close')}
                              onClick={() => setDataFor(null)}
                              className="rounded-lg p-1 text-ink-muted hover:bg-raised hover:text-ink"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <OffboardingPanel operator tenantId={o.id} onChanged={offboarding.reload} />
                        </td>
                      </tr>
                    )}
                    {domainFor === o.id && (
                      <tr className="bg-canvas/50">
                        <td colSpan={6} className="px-3 py-4">
                          <div className="flex items-start justify-between gap-2 mb-3">
                            <div>
                              <h3 className="text-xs font-bold text-ink">{t('operator.orgs.domainTitle', { name: o.name })}</h3>
                              <p className="text-[11px] text-ink-muted">{t('operator.orgs.domainHint')}</p>
                            </div>
                            <button
                              type="button"
                              aria-label={t('common.close')}
                              onClick={() => setDomainFor(null)}
                              className="rounded-lg p-1 text-ink-muted hover:bg-raised hover:text-ink"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <CustomDomainEditor basePath={`/api/v1/operator/tenants/${o.id}/custom-domain`} onChanged={reload} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-ink-subtle">{t('operator.orgs.legend')}</p>
      <DeletedOrganisations overview={offboarding} />
    </section>
  );
};

/** Creates an organisation directly (no request), with its first administrator, who gets an activation e-mail. */
const NewOrganisationForm: React.FC<{ onCancel: () => void; onCreated: (text: string) => void }> = ({ onCancel, onCreated }) => {
  const t = useT();
  const { busy, error, run } = useAction();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [tier, setTier] = useState<Tier>('STARTER');
  const [seats, setSeats] = useState('100');
  const [domain, setDomain] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [trialDays, setTrialDays] = useState('0');
  const [availability, setAvailability] = useState<{ slug: string; available: boolean; reason?: string } | null>(null);

  const effectiveSlug = slugTouched ? slug : suggestSlug(name);
  const slugOk = isValidSlug(effectiveSlug);

  // Ask the API whether the address is free, a moment after typing stops.
  useEffect(() => {
    if (!slugOk) {
      setAvailability(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get<{ data: { slug: string; available: boolean; reason?: string } }>('/api/v1/organizations/availability', {
          params: { slug: effectiveSlug },
        })
        .then((r) => !cancelled && setAvailability(r.data))
        .catch(() => !cancelled && setAvailability(null));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [effectiveSlug, slugOk]);

  const seatsValue = seats.trim() === '' ? null : Number(seats);
  const seatsOk = seatsValue === null || (Number.isInteger(seatsValue) && seatsValue >= 1);
  const taken = availability?.slug === effectiveSlug && !availability.available;
  const trialDaysValue = parseTrialDays(trialDays);
  const ready =
    name.trim().length >= 2 &&
    slugOk &&
    !taken &&
    seatsOk &&
    trialDaysValue !== null &&
    first.trim() &&
    last.trim() &&
    /\S+@\S+\.\S+/.test(email.trim());

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = await api.post<{ data: { organization: Org; invitation: InvitationResult } }>('/api/v1/operator/tenants', {
        name: name.trim(),
        slug: effectiveSlug,
        tier,
        seatQuota: seatsValue,
        ...(domain.trim() ? { customDomain: domain.trim().toLowerCase() } : {}),
        adminFirstName: first.trim(),
        adminLastName: last.trim(),
        adminEmail: email.trim(),
        trialDays: trialDaysValue ?? 0,
      });
      const pending = res.data.organization.pendingCustomDomain;
      onCreated(
        t('operator.orgs.msg.created', {
          name: res.data.organization.name,
          invite: invitationText(t, res.data.invitation, email.trim()),
        }) + (pending ? ` ${t('operator.orgs.msg.createdPending', { domain: pending })}` : '')
      );
    });
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-brand/40 bg-brand/5 p-4 space-y-3" aria-labelledby="new-org-h">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 id="new-org-h" className="font-bold text-sm text-ink">
            {t('operator.new.title')}
          </h3>
          <p className="text-[11px] text-ink-muted">{t('operator.new.intro')}</p>
        </div>
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={onCancel}
          className="rounded-lg p-1 text-ink-muted hover:bg-raised hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
          {t('operator.new.name')}
          <input
            className={input}
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="St. Mary's College"
          />
        </label>
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
          {t('operator.new.slug')}
          <input
            className={`${input} font-mono`}
            required
            maxLength={40}
            value={effectiveSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
            aria-describedby="new-org-slug-hint"
          />
          <span
            id="new-org-slug-hint"
            className={`block font-normal ${effectiveSlug && (!slugOk || taken) ? 'text-danger' : 'text-ink-subtle'}`}
          >
            {!effectiveSlug
              ? t('operator.new.slugEmpty')
              : !slugOk
                ? t('operator.new.slugInvalid')
                : taken
                  ? availability?.reason || t('operator.new.slugTaken')
                  : availability?.slug === effectiveSlug
                    ? t('operator.new.slugAvailable')
                    : t('operator.new.slugChecking')}
          </span>
        </label>
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
          {t('operator.planLabel')}
          <select className={input} value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
            {TIERS.map((tr) => (
              <option key={tr} value={tr}>
                {tierName(t, tr)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
          {t('operator.seatsLabel')}
          <input className={input} type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} />
        </label>
        <TrialDaysField value={trialDays} onChange={setTrialDays} className={input} />
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted md:col-span-2">
          {t('operator.new.domain')}
          <input className={input} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="learn.college.edu" />
        </label>
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
          {t('operator.new.first')}
          <input className={input} required maxLength={100} value={first} onChange={(e) => setFirst(e.target.value)} />
        </label>
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
          {t('operator.new.last')}
          <input className={input} required maxLength={100} value={last} onChange={(e) => setLast(e.target.value)} />
        </label>
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted md:col-span-2">
          {t('operator.new.email')}
          <input
            className={input}
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="it-office@college.edu"
          />
        </label>
      </div>
      {!seatsOk && <Banner kind="error">{t('operator.seatsError')}</Banner>}
      {error && <Banner kind="error">{error}</Banner>}
      <div className="flex gap-2">
        <button className={primary} disabled={busy || !ready}>
          {busy ? t('operator.new.creating') : t('operator.new.create')}
        </button>
        <button type="button" className={ghost} onClick={onCancel} disabled={busy}>
          {t('operator.cancel')}
        </button>
      </div>
    </form>
  );
};
