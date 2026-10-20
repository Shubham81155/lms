"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAction, useApiData } from "@/hooks/useApiData";
import { Banner } from "@/components/admin/IdentityPanels";
import { parseDays, type RetentionPolicy, type RetentionRun } from "@/lib/dataRequests";

const input =
  "w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand";
const ghostBtn =
  "px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50";
const primaryBtn = "px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const RunSummary: React.FC<{ run: RetentionRun; labels: Record<string, string> }> = ({ run, labels }) => (
  <div className="rounded-xl border border-line bg-surface p-3 space-y-1.5" role="status">
    <p className="text-xs font-semibold text-ink">
      {run.dryRun ? "Preview" : "Run"} on {when(run.at)}: {run.dryRun ? "this is what would be removed; nothing was changed" : "removed"}
    </p>
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 text-[11px] text-ink-muted">
      {Object.entries(run.counts).map(([k, n]) => (
        <li key={k} className="flex justify-between gap-3">
          <span>{labels[k] ?? k}</span>
          <span className="font-mono text-ink">
            {n}
            {(run.remaining[k] ?? 0) > 0 ? ` (+${run.remaining[k]} waiting for the next run)` : ""}
          </span>
        </li>
      ))}
    </ul>
  </div>
);

/**
 * The organisation's data-retention policy: how long each class of data is kept before it is removed. Off by
 * default; a policy in preview mode only counts. Grades, certificates, submissions and the audit trail are never
 * touched. Backed by /api/v1/privacy/retention.
 */
export const RetentionPanel: React.FC = () => {
  const { data, isLoading, error, reload } = useApiData<{ data: RetentionPolicy }>("/api/v1/privacy/retention");
  const save = useAction();
  const runAction = useAction();
  const [enabled, setEnabled] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [days, setDays] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [last, setLast] = useState<RetentionRun | null>(null);
  const [confirmRun, setConfirmRun] = useState(false);
  const policy = data?.data;

  useEffect(() => {
    if (!policy) return;
    setEnabled(policy.enabled);
    setDryRun(policy.dryRun);
    setDays(Object.fromEntries(policy.classes.map((c) => [c.field, policy[c.field] === null ? "" : String(policy[c.field])])));
  }, [policy]);

  if (!policy) {
    return (
      <section aria-labelledby="ret-h" className="space-y-3">
        <h3 id="ret-h" className="font-bold text-base text-ink">Data retention</h3>
        {error && <Banner kind="error">{error}</Banner>}
        {isLoading && <p className="text-xs text-ink-subtle">Loading…</p>}
      </section>
    );
  }

  const labels = Object.fromEntries(policy.classes.map((c) => [c.key, c.label]));
  const parsed = policy.classes.map((c) => [c, parseDays(days[c.field] ?? "", c.min)] as const);
  const valid = parsed.every(([, v]) => v !== undefined);
  const body = () => ({
    enabled,
    dryRun,
    ...Object.fromEntries(parsed.map(([c, v]) => [c.field, v ?? null])),
  });
  const shown = last ?? policy.lastRun;

  const saveIt = () =>
    save.run(async () => {
      setSaved(false);
      await api.put("/api/v1/privacy/retention", body());
      setSaved(true);
      await reload();
    });

  const runNow = (asPreview: boolean) =>
    runAction.run(async () => {
      setConfirmRun(false);
      const res = await api.post<{ data: RetentionRun }>("/api/v1/privacy/retention/run", { dryRun: asPreview });
      setLast(res.data);
      await reload();
    });

  const dirty =
    enabled !== policy.enabled || dryRun !== policy.dryRun || parsed.some(([c, v]) => (v ?? null) !== policy[c.field]);
  const canRunForReal = policy.enabled && !policy.dryRun && !dirty;

  return (
    <section className="space-y-5" aria-labelledby="ret-h">
      <div>
        <h3 id="ret-h" className="font-bold text-base text-ink">Data retention</h3>
        <p className="text-xs text-ink-muted">
          Remove data you no longer need after a set time. Leave a field empty to keep that data. Grades, certificates, submissions, forum posts and the audit trail are never removed.
        </p>
      </div>

      {(error || save.error || runAction.error) && <Banner kind="error">{error || save.error || runAction.error}</Banner>}
      {saved && !save.error && !dirty && <Banner kind="ok">Retention policy saved.</Banner>}

      <div className="bg-canvas border border-line rounded-2xl p-4 space-y-3">
        <label className="flex items-center justify-between text-xs text-ink">
          <span>Apply this policy every day</span>
          <input type="checkbox" role="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        </label>
        <label className="flex items-center justify-between text-xs text-ink">
          <span>
            Preview only <span className="text-ink-subtle">(count what would be removed, change nothing)</span>
          </span>
          <input type="checkbox" role="switch" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
        </label>
        {enabled && !dryRun && (
          <p className="text-[11px] text-danger">Removal is permanent. Run a preview first and check the counts.</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {parsed.map(([c, v]) => (
            <label key={c.key} className="space-y-1">
              <span className="text-[11px] font-semibold text-ink">{c.label}: keep for how many days?</span>
              <input
                className={input}
                inputMode="numeric"
                value={days[c.field] ?? ""}
                onChange={(e) => setDays((d) => ({ ...d, [c.field]: e.target.value }))}
                placeholder={`empty: keep (at least ${c.min})`}
                aria-invalid={v === undefined}
              />
              <span className={`block text-[11px] ${v === undefined ? "text-danger" : "text-ink-subtle"}`}>
                {v === undefined ? `Enter a whole number from ${c.min} to 3650, or leave empty.` : c.what}
              </span>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className={primaryBtn} disabled={!valid || !dirty || save.busy} onClick={saveIt}>
            {save.busy ? "Saving…" : "Save policy"}
          </button>
          <button className={ghostBtn} disabled={dirty || runAction.busy || !policy.classes.length} onClick={() => runNow(true)} title={dirty ? "Save the policy first" : undefined}>
            {runAction.busy ? "Counting…" : "Preview a run now"}
          </button>
          {canRunForReal && !confirmRun && (
            <button className={`${ghostBtn} hover:text-danger hover:border-danger/30`} disabled={runAction.busy} onClick={() => setConfirmRun(true)}>
              Run now…
            </button>
          )}
          {confirmRun && (
            <span className="flex items-center gap-2 text-[11px] text-danger">
              This removes data permanently.
              <button className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-on-brand rounded-lg font-bold" onClick={() => runNow(false)}>Remove it now</button>
              <button className={ghostBtn} onClick={() => setConfirmRun(false)}>Cancel</button>
            </span>
          )}
        </div>
        <p className="text-[11px] text-ink-subtle">A run removes at most {policy.rowCap.toLocaleString("en-IN")} rows of each kind; the next run carries on. Every run is recorded in the audit trail.</p>
      </div>

      {shown && <RunSummary run={shown} labels={labels} />}
    </section>
  );
};
