"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Globe, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAction, useApiData } from "@/hooks/useApiData";
import { Banner } from "@/components/admin/IdentityPanels";
import { FEATURE_LABELS } from "@/components/admin/PlatformPanels";
import { CustomDomainEditor } from "@/components/admin/CustomDomainPanel";
import { TrialControls, TrialDaysField, parseTrialDays } from "@/components/platform/TrialControls";
import { OffboardingPanel } from "@/components/admin/OffboardingPanel";
import { DeletedOrganisations, DeletionBadge, useOffboardingOverview } from "@/components/platform/OffboardingControls";
import { TIERS, invitationMessage, isValidSlug, suggestSlug, tierLabel, type InvitationResult, type Org, type Tier } from "@/lib/platform";

const field = "bg-canvas border border-line rounded-lg px-2 py-1 text-xs text-ink focus:outline-none focus:border-brand";
const input = "w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand";
const primary = "inline-flex items-center gap-1 px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-lg text-[11px] font-bold transition-all";
const ghost = "inline-flex items-center gap-1 px-2.5 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50";

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-success/10 text-success border-success/30",
  TRIAL: "bg-accent/10 text-accent border-accent/30",
  SUSPENDED: "bg-danger/10 text-danger border-danger/30",
  ARCHIVED: "bg-canvas text-ink-subtle border-line",
};

/**
 * Every organisation on the platform: its plan (tier, seats, feature overrides), its custom domain, whether it is
 * active, and a form to create one directly. `focusId` scrolls to and highlights one row (e.g. after approving a request).
 * `onChanged` runs after every change here, so the page's own figures (organisations, trials ending) follow.
 */
export const OrganisationsPanel: React.FC<{ ownTenantId?: string; focusId?: string | null; refreshKey?: number; onChanged?: () => void }> = ({ ownTenantId, focusId, refreshKey, onChanged }) => {
  const list = useApiData<{ data: Org[] }>("/api/v1/operator/tenants");
  const { busy, error, run, clearError } = useAction();
  const [quota, setQuota] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<{ id: string; to: "ACTIVE" | "SUSPENDED" } | null>(null);
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
    if (focusId && focusRef.current) focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
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
  const setStatus = (o: Org, status: "ACTIVE" | "SUSPENDED") =>
    run(async () => {
      setDone(null);
      try {
        await api.patch(`/api/v1/operator/tenants/${o.id}/status`, { status });
        setDone(status === "SUSPENDED" ? `"${o.name}" is suspended: nobody there can sign in until you reactivate it.` : `"${o.name}" is active again.`);
      } finally {
        setConfirming(null);
        await reload();
      }
    });

  return (
    <section className="bg-surface border border-line rounded-3xl p-6 shadow-xl space-y-4" aria-labelledby="orgs-h">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="orgs-h" className="font-bold text-base text-ink">Organisations</h2>
          <p className="text-xs text-ink-muted">Plans, seat quotas, feature overrides, custom domains and status. Every change is audited in the platform's trail and the organisation's own.</p>
        </div>
        {!creating && (
          <button type="button" className={primary} onClick={() => { clearError(); setDone(null); setCreating(true); }}>
            <Plus className="h-3.5 w-3.5" /> New organisation
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
      {list.isLoading && orgs.length === 0 && <p className="text-xs text-ink-subtle">Loading organisations…</p>}

      {orgs.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead className="bg-canvas text-[11px] uppercase tracking-wider text-ink-subtle">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-semibold">Organisation</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Plan</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Seats used / quota</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Features</th>
                <th scope="col" className="px-3 py-2.5 font-semibold text-right">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orgs.map((t) => {
                const own = t.id === ownTenantId;
                const focused = t.id === focusId;
                return (
                  <React.Fragment key={t.id}>
                    <tr ref={focused ? focusRef : undefined} className={`align-top ${focused ? "bg-brand/10" : ""}`}>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-ink">{t.name}{own && <span className="ml-1 text-[10px] font-normal text-ink-subtle">(platform operator)</span>}</div>
                        <div className="font-mono text-[11px] text-ink-subtle">{t.slug}</div>
                        {t.customDomain && <div className="text-[11px] text-ink-subtle" title="Verified custom domain">{t.customDomain}</div>}
                        {t.pendingCustomDomain && (
                          <div className="text-[11px] text-accent" title="Waiting for its DNS TXT record">{t.pendingCustomDomain} (verifying)</div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLE[t.status] ?? STATUS_STYLE.ARCHIVED}`}>{t.status.toLowerCase()}</span>
                        {!own && <TrialControls org={t} onChanged={async (_o, text) => { setDone(text); await reload(); }} />}
                        {deletions.get(t.id) && <DeletionBadge scheduledAt={deletions.get(t.id)!.scheduledAt} byOperator={deletions.get(t.id)!.byOperator} />}
                      </td>
                      <td className="px-3 py-3">
                        <select aria-label={`Plan for ${t.name}`} value={t.tier} disabled={busy} onChange={(e) => patch(t.id, { tier: e.target.value })} className={field}>
                          {TIERS.map((tier) => (
                            <option key={tier} value={tier}>{tierLabel(tier)}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        <form
                          className="flex items-center gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const v = (quota[t.id] ?? "").trim();
                            patch(t.id, { seatQuota: v === "" ? null : Number(v) });
                          }}
                        >
                          <span className="whitespace-nowrap text-ink">{t.seatsUsed} /</span>
                          <input
                            type="number"
                            min={1}
                            aria-label={`Seat quota for ${t.name}`}
                            placeholder={t.seatQuota ? String(t.seatQuota) : "∞"}
                            value={quota[t.id] ?? ""}
                            onChange={(e) => setQuota((q) => ({ ...q, [t.id]: e.target.value }))}
                            className={`${field} w-20`}
                          />
                          <button disabled={busy} className="text-[11px] font-semibold text-brand-fg disabled:opacity-50">Set</button>
                        </form>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(FEATURE_LABELS).map(([key, meta]) => {
                            const on = !!t.features[key];
                            const overridden = key in t.overrides;
                            return (
                              <span key={key} className="inline-flex items-center">
                                <button
                                  type="button"
                                  disabled={busy}
                                  title={overridden ? "Set for this organisation" : "Plan default. Click to override."}
                                  onClick={() => patch(t.id, { features: { [key]: !on } })}
                                  aria-pressed={on}
                                  aria-label={`${meta.label} for ${t.name}`}
                                  className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${on ? "bg-brand/15 text-brand-fg border-brand/40" : "bg-canvas text-ink-subtle border-line"} ${overridden ? "ring-1 ring-accent/60" : ""}`}
                                >
                                  {meta.label}
                                </button>
                                {overridden && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => patch(t.id, { features: { [key]: null } })}
                                    aria-label={`${meta.label}: use the plan default for ${t.name}`}
                                    title="Use the plan default"
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
                          aria-expanded={domainFor === t.id}
                          aria-label={`Custom domain of ${t.name}`}
                          onClick={() => setDomainFor((id) => (id === t.id ? null : t.id))}
                        >
                          <Globe className="h-3 w-3" /> Domain
                        </button>
                        <button
                          type="button"
                          className={`${ghost} mr-2`}
                          aria-expanded={dataFor === t.id}
                          aria-label={`Export and deletion of ${t.name}`}
                          onClick={() => setDataFor((id) => (id === t.id ? null : t.id))}
                        >
                          <Archive className="h-3 w-3" /> Data
                        </button>
                        {!own && (t.status === "SUSPENDED" ? (
                          <button type="button" className={ghost} disabled={busy} onClick={() => { clearError(); setConfirming({ id: t.id, to: "ACTIVE" }); }}>Reactivate</button>
                        ) : t.status !== "ARCHIVED" ? (
                          <button type="button" className={ghost} disabled={busy} onClick={() => { clearError(); setConfirming({ id: t.id, to: "SUSPENDED" }); }}>Suspend</button>
                        ) : null)}
                        {confirming?.id === t.id && (
                          <div role="alertdialog" aria-label={`${confirming.to === "SUSPENDED" ? "Suspend" : "Reactivate"} ${t.name}?`} className={`mt-2 rounded-xl border p-3 text-left ${confirming.to === "SUSPENDED" ? "border-danger/40 bg-danger/5" : "border-success/40 bg-success/5"}`}>
                            <p className="text-[11px] text-ink">
                              {confirming.to === "SUSPENDED"
                                ? "Nobody in this organisation can sign in while it is suspended. Its data is kept."
                                : "People in this organisation can sign in again."}
                            </p>
                            <div className="mt-2 flex justify-end gap-2">
                              <button type="button" className={ghost} disabled={busy} onClick={() => setConfirming(null)}>Cancel</button>
                              <button type="button" className={confirming.to === "SUSPENDED" ? "px-3 py-1.5 bg-danger hover:opacity-90 text-white rounded-lg text-[11px] font-bold disabled:opacity-50" : primary} disabled={busy} onClick={() => setStatus(t, confirming.to)}>
                                {confirming.to === "SUSPENDED" ? "Suspend" : "Reactivate"}
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                    {dataFor === t.id && (
                      <tr className="bg-canvas/50">
                        <td colSpan={6} className="px-3 py-4">
                          <div className="flex justify-end">
                            <button type="button" aria-label="Close" onClick={() => setDataFor(null)} className="rounded-lg p-1 text-ink-muted hover:bg-raised hover:text-ink">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <OffboardingPanel operator tenantId={t.id} onChanged={offboarding.reload} />
                        </td>
                      </tr>
                    )}
                    {domainFor === t.id && (
                      <tr className="bg-canvas/50">
                        <td colSpan={6} className="px-3 py-4">
                          <div className="flex items-start justify-between gap-2 mb-3">
                            <div>
                              <h3 className="text-xs font-bold text-ink">Custom domain of {t.name}</h3>
                              <p className="text-[11px] text-ink-muted">A domain works only once its TXT record is found. Send the record to the organisation, or check it for them.</p>
                            </div>
                            <button type="button" aria-label="Close" onClick={() => setDomainFor(null)} className="rounded-lg p-1 text-ink-muted hover:bg-raised hover:text-ink">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <CustomDomainEditor basePath={`/api/v1/operator/tenants/${t.id}/custom-domain`} onChanged={reload} />
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
      <p className="text-[11px] text-ink-subtle">Outlined features are set for that organisation (↺ returns them to the plan default); the rest follow its plan.</p>
      <DeletedOrganisations overview={offboarding} />
    </section>
  );
};

/** Creates an organisation directly (no request), with its first administrator, who gets an activation e-mail. */
const NewOrganisationForm: React.FC<{ onCancel: () => void; onCreated: (text: string) => void }> = ({ onCancel, onCreated }) => {
  const { busy, error, run } = useAction();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [tier, setTier] = useState<Tier>("STARTER");
  const [seats, setSeats] = useState("100");
  const [domain, setDomain] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [trialDays, setTrialDays] = useState("0");
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
    const t = setTimeout(() => {
      api
        .get<{ data: { slug: string; available: boolean; reason?: string } }>("/api/v1/organizations/availability", { params: { slug: effectiveSlug } })
        .then((r) => !cancelled && setAvailability(r.data))
        .catch(() => !cancelled && setAvailability(null));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [effectiveSlug, slugOk]);

  const seatsValue = seats.trim() === "" ? null : Number(seats);
  const seatsOk = seatsValue === null || (Number.isInteger(seatsValue) && seatsValue >= 1);
  const taken = availability?.slug === effectiveSlug && !availability.available;
  const trialDaysValue = parseTrialDays(trialDays);
  const ready = name.trim().length >= 2 && slugOk && !taken && seatsOk && trialDaysValue !== null && first.trim() && last.trim() && /\S+@\S+\.\S+/.test(email.trim());

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = await api.post<{ data: { organization: Org; invitation: InvitationResult } }>("/api/v1/operator/tenants", {
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
        `"${res.data.organization.name}" is created. ${invitationMessage(res.data.invitation, email.trim())}${pending ? ` ${pending} works once verified: open Domain for its TXT record.` : ""}`
      );
    });
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-brand/40 bg-brand/5 p-4 space-y-3" aria-labelledby="new-org-h">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 id="new-org-h" className="font-bold text-sm text-ink">New organisation</h3>
          <p className="text-[11px] text-ink-muted">For an organisation you have agreed terms with. Its first administrator gets an e-mail to set a password.</p>
        </div>
        <button type="button" aria-label="Close" onClick={onCancel} className="rounded-lg p-1 text-ink-muted hover:bg-raised hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
          Organisation name
          <input className={input} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="St. Mary's College" />
        </label>
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
          Address (used in its web address and to sign in)
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
          <span id="new-org-slug-hint" className={`block font-normal ${effectiveSlug && (!slugOk || taken) ? "text-danger" : "text-ink-subtle"}`}>
            {!effectiveSlug
              ? "3-40 characters: letters, digits and hyphens."
              : !slugOk
                ? "Use 3-40 lowercase letters, digits and hyphens, starting and ending with a letter or digit."
                : taken
                  ? availability?.reason || "That address is taken."
                  : availability?.slug === effectiveSlug
                    ? "Available."
                    : "Checking…"}
          </span>
        </label>
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
          Plan
          <select className={input} value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
            {TIERS.map((t) => (
              <option key={t} value={t}>{tierLabel(t)}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
          Seats (blank for no limit)
          <input className={input} type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} />
        </label>
        <TrialDaysField value={trialDays} onChange={setTrialDays} className={input} />
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted md:col-span-2">
          Custom domain (optional: it works once its DNS TXT record is verified)
          <input className={input} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="learn.college.edu" />
        </label>
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
          First administrator: first name
          <input className={input} required maxLength={100} value={first} onChange={(e) => setFirst(e.target.value)} />
        </label>
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
          Last name
          <input className={input} required maxLength={100} value={last} onChange={(e) => setLast(e.target.value)} />
        </label>
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted md:col-span-2">
          Administrator's e-mail
          <input className={input} type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="it-office@college.edu" />
        </label>
      </div>
      {!seatsOk && <Banner kind="error">Seats must be a whole number of at least 1, or blank.</Banner>}
      {error && <Banner kind="error">{error}</Banner>}
      <div className="flex gap-2">
        <button className={primary} disabled={busy || !ready}>{busy ? "Creating…" : "Create organisation"}</button>
        <button type="button" className={ghost} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
};
