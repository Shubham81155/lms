"use client";

import React, { useState } from "react";
import { api } from "@/lib/api";
import { useAction, useApiData } from "@/hooks/useApiData";
import { Banner } from "./IdentityPanels";
import { FEATURE_LABELS } from "./PlatformPanels";

interface OperatorTenant {
  id: string;
  slug: string;
  name: string;
  customDomain: string | null;
  tier: "STARTER" | "PROFESSIONAL" | "ENTERPRISE";
  status: string;
  seatQuota: number | null;
  seatsUsed: number;
  features: Record<string, boolean>;
  overrides: Record<string, boolean>;
}

const TIERS = ["STARTER", "PROFESSIONAL", "ENTERPRISE"] as const;
const field = "bg-canvas border border-line rounded-lg px-2 py-1 text-xs text-ink focus:outline-none focus:border-brand";

/**
 * Platform operators (super administrators of the operator organisation) set each organisation's plan:
 * tier, seat quota and feature overrides. Renders nothing for anyone else.
 */
export const OperatorPanel: React.FC = () => {
  const { data, error, reload } = useApiData<{ data: OperatorTenant[] }>("/api/v1/operator/tenants");
  const { busy, error: actionError, run } = useAction();
  const [quota, setQuota] = useState<Record<string, string>>({});

  // Nothing to show while loading, or when this super administrator is not a platform operator (403).
  if (!data || error) return null;

  const patch = (id: string, body: Record<string, unknown>) =>
    run(async () => {
      try {
        await api.patch(`/api/v1/operator/tenants/${id}`, body);
      } finally {
        await reload();
      }
    });

  return (
    <div className="bg-surface border border-brand/40 rounded-3xl p-6 shadow-xl">
      <section className="space-y-4" aria-labelledby="operator-heading">
        <div>
          <h3 id="operator-heading" className="font-bold text-base text-ink">Organisations (platform operator)</h3>
          <p className="text-xs text-ink-muted">Plans, seat quotas and feature overrides for every organisation. Changes are audited in both trails.</p>
        </div>
        {actionError && <Banner kind="error">{actionError}</Banner>}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-subtle border-b border-line">
                <th className="py-2 pr-3 font-semibold">Organisation</th>
                <th className="py-2 pr-3 font-semibold">Plan</th>
                <th className="py-2 pr-3 font-semibold">Seats</th>
                <th className="py-2 font-semibold">Features</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((t) => (
                <tr key={t.id} className="border-b border-line/60 align-top">
                  <td className="py-3 pr-3">
                    <div className="font-semibold text-ink">{t.name}</div>
                    <div className="text-[11px] text-ink-subtle">{t.customDomain ?? t.slug}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <select aria-label={`Plan for ${t.name}`} value={t.tier} disabled={busy} onChange={(e) => patch(t.id, { tier: e.target.value })} className={field}>
                      {TIERS.map((tier) => (
                        <option key={tier} value={tier}>
                          {tier.charAt(0) + tier.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 pr-3">
                    <form
                      className="flex items-center gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const v = (quota[t.id] ?? "").trim();
                        patch(t.id, { seatQuota: v === "" ? null : Number(v) });
                      }}
                    >
                      <span className="text-ink whitespace-nowrap">{t.seatsUsed} /</span>
                      <input
                        type="number"
                        min={1}
                        aria-label={`Seat quota for ${t.name}`}
                        placeholder={t.seatQuota ? String(t.seatQuota) : "∞"}
                        value={quota[t.id] ?? ""}
                        onChange={(e) => setQuota((q) => ({ ...q, [t.id]: e.target.value }))}
                        className={`${field} w-20`}
                      />
                      <button disabled={busy} className="text-[11px] font-semibold text-brand-fg disabled:opacity-50">
                        Set
                      </button>
                    </form>
                  </td>
                  <td className="py-3">
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink-subtle">Outlined features are set for that organisation (↺ returns them to the plan default); the rest follow its plan.</p>
      </section>
    </div>
  );
};

