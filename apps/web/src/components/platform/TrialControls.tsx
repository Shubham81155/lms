"use client";

import React, { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { api } from "@/lib/api";
import { useAction, useApiData } from "@/hooks/useApiData";
import { trialPhase, type Org, type TrialSettings } from "@/lib/platform";

// The platform operator's trial tools for one organisation: what its trial looks like, and buttons to start,
// extend or end it, or convert the organisation to a paid (active) one. Every change is audited by the API.

const field = "bg-canvas border border-line rounded-lg px-2 py-1 text-xs text-ink focus:outline-none focus:border-brand";
const primary = "inline-flex items-center gap-1 px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-lg text-[11px] font-bold transition-all";
const ghost = "inline-flex items-center gap-1 px-2.5 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** The platform's trial defaults (ORG_TRIAL_DAYS and the grace period), or null while loading or unavailable. */
export function useTrialSettings(): TrialSettings | null {
  return useApiData<{ data: TrialSettings }>("/api/v1/operator/trial-settings").data?.data ?? null;
}

/** Whole days in 0-365, or null when the text is not one. */
export const parseTrialDays = (v: string): number | null => {
  const n = Number(v.trim() === "" ? "0" : v);
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : null;
};

/**
 * "Start as trial (days)" for the approve and create forms. Starts with the platform default once it has
 * loaded (unless the operator already typed something); 0 or blank creates an active (paid) organisation.
 */
export const TrialDaysField: React.FC<{ value: string; onChange: (v: string) => void; className: string }> = ({ value, onChange, className }) => {
  const settings = useTrialSettings();
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (settings && !touched) onChange(String(settings.defaultDays));
    // Only when the default arrives; the operator's own entry wins afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);
  const days = parseTrialDays(value);
  return (
    <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
      Start as trial (days)
      <input
        className={className}
        type="number"
        min={0}
        max={365}
        value={value}
        onChange={(e) => {
          setTouched(true);
          onChange(e.target.value);
        }}
      />
      <span className={`block font-normal ${days === null ? "text-danger" : "text-ink-subtle"}`}>
        {days === null ? "A whole number of days, 0 to 365." : days === 0 ? "0: starts as a paid (active) organisation." : `Trial ends ${day(new Date(Date.now() + days * 86_400_000).toISOString())}.`}
      </span>
    </label>
  );
};

/** Trial state and actions for one organisation, shown in its row of the Organisations list. */
export const TrialControls: React.FC<{ org: Org; onChanged: (org: Org, message: string) => void }> = ({ org, onChanged }) => {
  const { busy, error, run, clearError } = useAction();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("14");
  const [confirm, setConfirm] = useState<"end" | "convert" | null>(null);
  const phase = trialPhase(org);
  // Convert also works for an organisation suspended after its trial lapsed.
  const lapsed = org.status === "SUSPENDED" && !!org.trialExpiredAt;
  const canStart = org.status === "ACTIVE";
  if (org.status === "ARCHIVED" || (org.status === "SUSPENDED" && !lapsed)) return null;

  const n = parseTrialDays(days);
  const daysOk = n !== null && n >= 1;
  const act = (method: "post" | "patch", path: string, body: Record<string, unknown> | undefined, message: (o: Org) => string) =>
    run(async () => {
      const res = method === "post" ? await api.post<{ data: Org }>(path, body ?? {}) : await api.patch<{ data: Org }>(path, body ?? {});
      setConfirm(null);
      setOpen(false);
      onChanged(res.data, message(res.data));
    });
  const base = `/api/v1/operator/tenants/${org.id}/trial`;

  return (
    <div className="mt-1.5 space-y-1 text-[11px]">
      {phase === "running" && org.trialEndsAt && <div className="text-accent">Trial ends {day(org.trialEndsAt)}</div>}
      {phase === "read-only" && <div className="text-danger">Trial ended · read-only{org.readOnlyUntil ? ` until ${day(org.readOnlyUntil)}` : ""}</div>}
      {lapsed && <div className="text-ink-subtle">Suspended after its trial</div>}
      <button
        type="button"
        className="inline-flex items-center gap-1 font-semibold text-brand-fg disabled:opacity-50"
        aria-expanded={open}
        aria-label={`Trial of ${org.name}`}
        onClick={() => {
          clearError();
          setConfirm(null);
          setOpen((v) => !v);
        }}
      >
        <Clock className="h-3 w-3" aria-hidden="true" /> {phase === "none" && !lapsed ? "Trial…" : "Manage trial…"}
      </button>

      {open && (
        <div role="group" aria-label={`Trial of ${org.name}`} className="w-64 space-y-2 rounded-xl border border-line bg-canvas p-3">
          {(canStart || phase !== "none") && (
            <div className="flex items-center gap-1.5">
              <input type="number" min={1} max={365} aria-label="Days" value={days} onChange={(e) => setDays(e.target.value)} className={`${field} w-16`} />
              <span className="text-ink-muted">days</span>
              {canStart ? (
                <button type="button" className={primary} disabled={busy || !daysOk} onClick={() => act("post", base, { days: n }, (o) => `"${o.name}" is on a trial until ${o.trialEndsAt ? day(o.trialEndsAt) : "…"}.`)}>
                  Start trial
                </button>
              ) : (
                <button type="button" className={primary} disabled={busy || !daysOk} onClick={() => act("patch", base, { days: n }, (o) => `The trial of "${o.name}" now ends ${o.trialEndsAt ? day(o.trialEndsAt) : "later"}.`)}>
                  Extend
                </button>
              )}
            </div>
          )}
          {phase !== "none" && !lapsed && (
            <p className="text-ink-subtle">Extending an ended trial lifts the read-only mode.</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {phase === "running" && (
              <button type="button" className={ghost} disabled={busy} onClick={() => setConfirm("end")}>End now</button>
            )}
            {(phase !== "none" || lapsed) && (
              <button type="button" className={ghost} disabled={busy} onClick={() => setConfirm("convert")}>Convert to paid</button>
            )}
          </div>
          {confirm && (
            <div role="alertdialog" aria-label={confirm === "end" ? `End the trial of ${org.name}?` : `Convert ${org.name} to paid?`} className={`rounded-lg border p-2 ${confirm === "end" ? "border-danger/40 bg-danger/5" : "border-success/40 bg-success/5"}`}>
              <p className="text-ink">
                {confirm === "end"
                  ? "The organisation becomes read-only at once, and is suspended when the grace period is over."
                  : "The trial ends and the organisation becomes active (paid), with no end date."}
              </p>
              <div className="mt-2 flex justify-end gap-1.5">
                <button type="button" className={ghost} disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
                {confirm === "end" ? (
                  <button type="button" className="px-3 py-1.5 bg-danger hover:opacity-90 text-white rounded-lg text-[11px] font-bold disabled:opacity-50" disabled={busy} onClick={() => act("post", `${base}/end`, undefined, (o) => `The trial of "${o.name}" has ended: it is read-only${o.readOnlyUntil ? ` until ${day(o.readOnlyUntil)}` : ""}.`)}>
                    End trial
                  </button>
                ) : (
                  <button type="button" className={primary} disabled={busy} onClick={() => act("post", `${base}/convert`, undefined, (o) => `"${o.name}" is now a paid, active organisation.`)}>
                    Convert
                  </button>
                )}
              </div>
            </div>
          )}
          {error && <p role="alert" className="text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
};
