"use client";

import React, { useState } from "react";
import { Download, Send, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { downloadFile, useAction, useApiData } from "@/hooks/useApiData";
import { Banner, OnceSecret } from "./IdentityPanels";

const input =
  "w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand";
const primaryBtn =
  "px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all";
const ghostBtn =
  "px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50";

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

export const FEATURE_LABELS: Record<string, { label: string; hint: string }> = {
  lti13: { label: "LTI 1.3 launches", hint: "Let external tools sign learners in." },
  sso: { label: "Single sign-on (OIDC / SAML)", hint: "Sign in with your identity provider." },
  webhooks: { label: "Webhooks", hint: "Send signed events to your systems." },
  scim: { label: "SCIM provisioning", hint: "Sync accounts from your directory." },
  aiAssistant: { label: "AI assistance", hint: "Study tutor for learners and course-outline drafts for instructors. Questions and course content are sent to Google Gemini." },
};

export const FeaturesPanel: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const { data, isLoading, error, reload } = useApiData<{ data: Record<string, boolean> }>("/api/v1/admin/features");
  const { busy, error: actionError, run } = useAction();

  const toggle = (key: string, value: boolean) =>
    run(async () => {
      await api.put("/api/v1/admin/features", { [key]: value });
      await reload();
      onChanged?.();
    });

  return (
    <section className="space-y-4" aria-labelledby="features-heading">
      <div>
        <h3 id="features-heading" className="font-bold text-base text-ink">Features</h3>
        <p className="text-xs text-ink-muted">Switch capabilities on or off for your organisation.</p>
      </div>
      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Object.entries(FEATURE_LABELS).map(([key, meta]) => {
          const on = !!data?.data?.[key];
          return (
            <li key={key} className="bg-canvas border border-line rounded-2xl p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-ink">{meta.label}</div>
                <div className="text-[11px] text-ink-subtle">{meta.hint}</div>
              </div>
              <button
                role="switch"
                aria-checked={on}
                aria-label={meta.label}
                disabled={busy || isLoading}
                onClick={() => toggle(key, !on)}
                className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-brand" : "bg-raised"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
              </button>
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
  const { data, error, reload } = useApiData<{ data: Usage }>("/api/v1/admin/usage");
  const { busy, error: actionError, run } = useAction();
  const [quota, setQuota] = useState("");
  const [exporting, setExporting] = useState(false);
  const u = data?.data;

  const saveQuota = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api.put("/api/v1/admin/usage/quota", { seatQuota: quota.trim() === "" ? null : Number(quota) });
      setQuota("");
      await reload();
    });
  };

  const exportData = async () => {
    setExporting(true);
    await run(() => downloadFile("/api/v1/admin/export", "tenant-export.json"));
    setExporting(false);
  };

  const pct = u?.seats.quota ? Math.min(100, Math.round((u.seats.used / u.seats.quota) * 100)) : null;

  return (
    <section className="space-y-4" aria-labelledby="usage-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id="usage-heading" className="font-bold text-base text-ink">Usage and seats</h3>
          <p className="text-xs text-ink-muted">Plan: {u?.tier ?? "…"}. Seats count active and invited accounts.</p>
        </div>
        <button className={ghostBtn} onClick={exportData} disabled={exporting}>
          <Download className="h-3.5 w-3.5 inline mr-1" />
          {exporting ? "Preparing…" : "Export all data (JSON)"}
        </button>
      </div>

      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}

      {u && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ["Seats in use", u.seats.quota ? `${u.seats.used} / ${u.seats.quota}` : String(u.seats.used)],
              ["Active users (30 days)", String(u.last30Days.activeUsers)],
              ["Courses", String(u.totals.courses)],
              ["Certificates issued", String(u.totals.certificates)],
            ].map(([label, value]) => (
              <div key={label} className="bg-canvas border border-line rounded-2xl p-4">
                <div className="text-[11px] text-ink-subtle">{label}</div>
                <div className="text-xl font-bold text-ink mt-1">{value}</div>
              </div>
            ))}
          </div>

          {pct !== null && (
            <div>
              <div className="h-2 rounded-full bg-raised overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Seat usage">
                <div className={`h-2 ${pct >= 90 ? "bg-rose-500" : "bg-brand-hover"}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="text-[11px] text-ink-subtle mt-1">{u.seats.remaining} seats remaining</div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 text-[11px]">
            {Object.entries(u.seats.byRole).map(([role, n]) => (
              <span key={role} className="px-2.5 py-1 rounded-full bg-canvas border border-line text-ink">
                {role.replace(/_/g, " ").toLowerCase()}: <strong className="text-ink">{n}</strong>
              </span>
            ))}
          </div>
        </>
      )}

      <form onSubmit={saveQuota} className="flex items-end gap-3 max-w-md">
        <label className="flex-1 space-y-1 text-xs text-ink-muted font-semibold">
          Seat quota (blank for unlimited)
          <input className={input} type="number" min={1} value={quota} onChange={(e) => setQuota(e.target.value)} placeholder={u?.seats.quota ? String(u.seats.quota) : "Unlimited"} />
        </label>
        <button className={primaryBtn} disabled={busy}>Set quota</button>
      </form>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

const EVENTS = ["enrollment.completed", "certificate.issued", "quiz.submitted", "user.provisioned"] as const;

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
  const { data, isLoading } = useApiData<{ data: Delivery[] }>(`/api/v1/admin/webhooks/${id}/deliveries`);
  if (isLoading) return <div className="text-[11px] text-ink-subtle">Loading…</div>;
  const rows = (data?.data ?? []).slice(0, 10);
  if (rows.length === 0) return <div className="text-[11px] text-ink-subtle">No deliveries yet.</div>;
  return (
    <ul className="space-y-1">
      {rows.map((d) => (
        <li key={d.id} className="flex items-center justify-between text-[11px] font-mono">
          <span className={d.success ? "text-success" : "text-danger"}>
            {d.success ? "OK" : "FAIL"} {d.statusCode ?? "-"} {d.event}
          </span>
          <span className="text-ink-subtle">{new Date(d.createdAt).toLocaleString()}{d.error ? ` · ${d.error}` : ""}</span>
        </li>
      ))}
    </ul>
  );
};

export const WebhooksPanel: React.FC<{ available: boolean }> = ({ available }) => {
  const { data, error, reload } = useApiData<{ data: Endpoint[] }>("/api/v1/admin/webhooks");
  const { busy, error: actionError, run } = useAction();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([...EVENTS]);
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0); // remounts the delivery log after a test event

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post<{ data: { secret: string } }>("/api/v1/admin/webhooks", { url: url.trim(), events });
      setSecret(r.data.secret);
      setUrl("");
      await reload();
    });
  };

  const test = (ep: Endpoint) =>
    run(async () => {
      const r = await api.post<{ data: { success: boolean; statusCode: number | null; error: string | null } }>(`/api/v1/admin/webhooks/${ep.id}/test`);
      setTestResult((p) => ({ ...p, [ep.id]: r.data.success ? `Delivered (HTTP ${r.data.statusCode})` : `Failed: ${r.data.error ?? "unknown error"}` }));
      setTick((t) => t + 1);
    });

  const toggleActive = (ep: Endpoint) =>
    run(async () => {
      await api.patch(`/api/v1/admin/webhooks/${ep.id}`, { isActive: !ep.isActive });
      await reload();
    });

  const remove = (ep: Endpoint) => {
    if (!window.confirm(`Delete the webhook for ${ep.url}?`)) return;
    run(async () => {
      await api.delete(`/api/v1/admin/webhooks/${ep.id}`);
      await reload();
    });
  };

  return (
    <section className="space-y-4" aria-labelledby="webhooks-heading">
      <div>
        <h3 id="webhooks-heading" className="font-bold text-base text-ink">Webhooks</h3>
        <p className="text-xs text-ink-muted">
          Receive signed HTTPS events. Verify the <code className="text-brand-fg">x-lms-signature</code> header
          (HMAC-SHA256 of timestamp + "." + body) with your endpoint's secret.
        </p>
      </div>

      {!available && <Banner kind="error">Webhooks are not included in this organisation's plan.</Banner>}
      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}
      {secret && <OnceSecret label="Signing secret" value={secret} onDismiss={() => setSecret(null)} />}

      <form onSubmit={create} className="space-y-3 bg-canvas border border-line rounded-2xl p-4">
        <label className="block space-y-1 text-xs text-ink-muted font-semibold">
          Endpoint URL
          <input className={input} type="url" required placeholder="https://example.com/hooks/lms" value={url} onChange={(e) => setUrl(e.target.value)} disabled={!available} />
        </label>
        <fieldset className="flex flex-wrap gap-4 text-xs text-ink">
          <legend className="text-xs text-ink-muted font-semibold mb-1">Events</legend>
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
        <button className={primaryBtn} disabled={busy || !available || events.length === 0 || !url.trim()}>Add webhook</button>
      </form>

      <ul className="space-y-2">
        {(data?.data ?? []).length === 0 && <li className="text-xs text-ink-subtle">No webhooks yet.</li>}
        {(data?.data ?? []).map((ep) => (
          <li key={ep.id} className="bg-canvas border border-line rounded-2xl p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-ink break-all">{ep.url}</div>
                <div className="text-[11px] text-ink-subtle">{ep.events.join(", ")}</div>
              </div>
              <div className="flex items-center gap-2">
                <button className={ghostBtn} onClick={() => test(ep)} disabled={busy}>
                  <Send className="h-3 w-3 inline mr-1" />Send test
                </button>
                <button className={ghostBtn} onClick={() => toggleActive(ep)} disabled={busy}>{ep.isActive ? "Pause" : "Resume"}</button>
                <button className={ghostBtn} onClick={() => setOpen(open === ep.id ? null : ep.id)}>{open === ep.id ? "Hide log" : "Deliveries"}</button>
                <button className={ghostBtn} onClick={() => remove(ep)} disabled={busy} aria-label={`Delete ${ep.url}`}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
            {!ep.isActive && <div className="text-[11px] text-accent">Paused: no events are being sent.</div>}
            {testResult[ep.id] && <div className="text-[11px] text-ink">{testResult[ep.id]}</div>}
            {open === ep.id && <Deliveries key={tick} id={ep.id} />}
          </li>
        ))}
      </ul>
    </section>
  );
};
