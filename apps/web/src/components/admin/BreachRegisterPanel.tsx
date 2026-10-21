"use client";

import React, { useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useAction, useApiData } from "@/hooks/useApiData";
import { Banner } from "@/components/admin/IdentityPanels";

const input =
  "w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand";
const ghostBtn =
  "px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 inline-flex items-center gap-1.5";
const primaryBtn = "px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-lg text-[11px] font-bold transition-colors";

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const STATUSES = ["DETECTED", "CONTAINED", "NOTIFIED", "CLOSED"] as const;
type Severity = (typeof SEVERITIES)[number];
type Status = (typeof STATUSES)[number];

interface Breach {
  id: string;
  title: string;
  description: string;
  categories: string[];
  affectedEstimate: number | null;
  severity: Severity;
  status: Status;
  detectedAt: string;
  occurredAt: string | null;
  containment: string | null;
  boardNotifiedAt: string | null;
  peopleNotifiedAt: string | null;
  noNotificationReason: string | null;
  closedAt: string | null;
  dueAt: string;
  hoursLeft: number | null;
  overdue: boolean;
}
interface Register {
  data: Breach[];
  summary: { open: number; overdue: number };
}

const SEVERITY_STYLE: Record<Severity, string> = {
  LOW: "border-line bg-raised text-ink-muted",
  MEDIUM: "border-accent/40 bg-accent/10 text-ink",
  HIGH: "border-danger/30 bg-danger/10 text-danger",
  CRITICAL: "border-danger/40 bg-danger/20 text-danger",
};
const STATUS_LABEL: Record<Status, string> = { DETECTED: "Detected", CONTAINED: "Contained", NOTIFIED: "Board notified", CLOSED: "Closed" };
const NEXT: Partial<Record<Status, Status>> = { DETECTED: "CONTAINED", CONTAINED: "NOTIFIED", NOTIFIED: "CLOSED" };

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
/** An ISO instant as the value of a datetime-local input (local time). */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const nowLocal = () => toLocalInput(new Date().toISOString());

const ClockBadge: React.FC<{ b: Breach }> = ({ b }) => {
  if (b.status === "CLOSED") return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-raised text-ink-muted border-line">Closed</span>;
  if (b.hoursLeft === null) return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-success/10 text-success border-success/30">Board notified</span>;
  if (b.overdue) return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-danger/10 text-danger border-danger/30">Overdue by {Math.max(1, Math.abs(b.hoursLeft))} h</span>;
  const cls = b.hoursLeft <= 24 ? "bg-accent/10 text-ink border-accent/40" : "bg-success/10 text-success border-success/30";
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>{b.hoursLeft} h left</span>;
};

const BreachRow: React.FC<{ b: Breach; onChanged: () => Promise<unknown> }> = ({ b, onChanged }) => {
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [containment, setContainment] = useState(b.containment ?? "");
  const [board, setBoard] = useState(toLocalInput(b.boardNotifiedAt));
  const [people, setPeople] = useState(toLocalInput(b.peopleNotifiedAt));
  const [reason, setReason] = useState(b.noNotificationReason ?? "");
  const [notice, setNotice] = useState(false);
  const [consequences, setConsequences] = useState("");
  const [advice, setAdvice] = useState("");
  const [contact, setContact] = useState("");
  const [sentNote, setSentNote] = useState("");
  const closed = b.status === "CLOSED";
  const next = NEXT[b.status];

  const patch = (status?: Status) =>
    run(async () => {
      const body: Record<string, unknown> = {};
      if (containment.trim() !== (b.containment ?? "")) body.containment = containment.trim() || null;
      if (board !== toLocalInput(b.boardNotifiedAt)) body.boardNotifiedAt = fromLocalInput(board);
      if (people !== toLocalInput(b.peopleNotifiedAt)) body.peopleNotifiedAt = fromLocalInput(people);
      if (reason.trim() !== (b.noNotificationReason ?? "")) body.noNotificationReason = reason.trim() || null;
      if (status) body.status = status;
      if (Object.keys(body).length === 0) return;
      await api.patch(`/api/v1/privacy/breaches/${b.id}`, body);
      setOpen(false);
      await onChanged();
    });

  const sendNotice = () =>
    run(async () => {
      setSentNote("");
      const body = { audience: "ALL_ACTIVE", consequences: consequences.trim(), safetyAdvice: advice.trim(), contactEmail: contact.trim() };
      const dry = await api.post<{ data: { recipients: number } }>(`/api/v1/privacy/breaches/${b.id}/notify-people`, { ...body, dryRun: true });
      if (!window.confirm(`E-mail this notice to ${dry.data.recipients} address(es), including guardians of minors? It cannot be recalled.`)) return;
      const res = await api.post<{ data: { sent: number; failed: number } }>(`/api/v1/privacy/breaches/${b.id}/notify-people`, { ...body, resend: !!b.peopleNotifiedAt });
      setSentNote(`Sent to ${res.data.sent} address(es)${res.data.failed ? `; ${res.data.failed} could not be sent` : ""}.`);
      await onChanged();
    });

  // What the next step needs, said before the administrator tries it.
  const needs =
    next === "CONTAINED" ? (containment.trim() ? null : "Describe what was done to contain it.")
    : next === "NOTIFIED" ? (board ? null : "Record when the Data Protection Board was told.")
    : next === "CLOSED" ? (board || reason.trim() ? null : "Record when the Board was told, or why no notification was needed.")
    : null;
  const canClose = !closed && (board !== "" || reason.trim() !== "");

  return (
    <li className="p-3 bg-canvas space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink">{b.title}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${SEVERITY_STYLE[b.severity]}`}>{b.severity.toLowerCase()}</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-line bg-surface text-ink">{STATUS_LABEL[b.status]}</span>
          </div>
          <div className="text-[11px] text-ink-subtle">
            Detected {when(b.detectedAt)} · Board to be told by {when(b.dueAt)}
            {b.affectedEstimate != null ? ` · about ${b.affectedEstimate.toLocaleString("en-IN")} people` : ""}
            {b.boardNotifiedAt ? ` · Board told ${when(b.boardNotifiedAt)}` : ""}
            {b.closedAt ? ` · closed ${when(b.closedAt)}` : ""}
          </div>
        </div>
        <ClockBadge b={b} />
      </div>
      <p className="text-xs text-ink-muted whitespace-pre-line">{b.description}</p>
      {b.categories.length > 0 && <p className="text-[11px] text-ink-subtle">Data involved: {b.categories.join(", ")}</p>}
      {b.containment && !open && <p className="text-[11px] text-ink-subtle whitespace-pre-line">Containment: {b.containment}</p>}
      {b.noNotificationReason && !open && <p className="text-[11px] text-ink-subtle whitespace-pre-line">No notification needed because: {b.noNotificationReason}</p>}

      {!closed && (
        <button className={ghostBtn} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Update"}
        </button>
      )}

      {open && !closed && (
        <div className="p-3 rounded-xl border border-line bg-surface space-y-3">
          <label className="block space-y-1 text-[11px] text-ink-muted">
            What was done to contain it
            <textarea className={input} rows={2} maxLength={5000} value={containment} onChange={(e) => setContainment(e.target.value)} />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="space-y-1 text-[11px] text-ink-muted">
              Data Protection Board told on
              <div className="flex gap-2">
                <input className={input} type="datetime-local" max={nowLocal()} value={board} onChange={(e) => setBoard(e.target.value)} />
                <button type="button" className={ghostBtn} onClick={() => setBoard(nowLocal())}>Now</button>
              </div>
            </label>
            <label className="space-y-1 text-[11px] text-ink-muted">
              Affected people told on
              <div className="flex gap-2">
                <input className={input} type="datetime-local" max={nowLocal()} value={people} onChange={(e) => setPeople(e.target.value)} />
                <button type="button" className={ghostBtn} onClick={() => setPeople(nowLocal())}>Now</button>
              </div>
            </label>
          </div>
          <div className="space-y-2">
            <button type="button" className={ghostBtn} aria-expanded={notice} onClick={() => setNotice(!notice)}>
              {notice ? "Hide breach notice" : b.peopleNotifiedAt ? "Send the breach notice again" : "E-mail the breach notice to everyone"}
            </button>
            {notice && (
              <div className="p-3 rounded-xl border border-line bg-canvas space-y-2">
                <p className="text-[11px] text-ink-subtle">
                  Everyone with an active account (and the guardians of minors) gets what happened, the data involved, when it happened and what you did, plus the three things below.
                </p>
                <label className="block space-y-1 text-[11px] text-ink-muted">
                  What this may mean for them
                  <textarea className={input} rows={2} maxLength={3000} value={consequences} onChange={(e) => setConsequences(e.target.value)} />
                </label>
                <label className="block space-y-1 text-[11px] text-ink-muted">
                  What they can do to protect themselves
                  <textarea className={input} rows={2} maxLength={3000} value={advice} onChange={(e) => setAdvice(e.target.value)} />
                </label>
                <label className="block space-y-1 text-[11px] text-ink-muted">
                  Contact e-mail for questions
                  <input className={input} type="email" value={contact} onChange={(e) => setContact(e.target.value)} />
                </label>
                <button type="button" className={primaryBtn} disabled={busy || !consequences.trim() || !advice.trim() || !contact.trim()} onClick={sendNotice}>
                  {busy ? "Working…" : "Review and send"}
                </button>
                {sentNote && <Banner kind="ok">{sentNote}</Banner>}
              </div>
            )}
          </div>
          <label className="block space-y-1 text-[11px] text-ink-muted">
            Why no notification was needed (only if the Board was not told)
            <textarea className={input} rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {needs && <p className="text-[11px] text-accent" role="status">{needs}</p>}
          <div className="flex flex-wrap gap-2">
            <button className={ghostBtn} disabled={busy} onClick={() => patch()}>Save details</button>
            {next && next !== "CLOSED" && (
              <button className={primaryBtn} disabled={busy || !!needs} onClick={() => patch(next)}>
                {busy ? "Working…" : `Move to ${STATUS_LABEL[next].toLowerCase()}`}
              </button>
            )}
            <button className={next === "CLOSED" ? primaryBtn : ghostBtn} disabled={busy || !canClose} onClick={() => patch("CLOSED")}>
              {busy ? "Working…" : "Close breach"}
            </button>
          </div>
          <p className="text-[11px] text-ink-subtle">Closing cannot be undone. The register records the Board&apos;s notice; filing it is your job, outside this platform.</p>
        </div>
      )}
      {error && <Banner kind="error">{error}</Banner>}
    </li>
  );
};

const NewBreach: React.FC<{ onDone: () => Promise<unknown>; onCancel: () => void }> = ({ onDone, onCancel }) => {
  const { busy, error, run } = useAction();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categories, setCategories] = useState("");
  const [affected, setAffected] = useState("");
  const [severity, setSeverity] = useState<Severity>("MEDIUM");
  const [detected, setDetected] = useState(nowLocal());
  const [containment, setContainment] = useState("");
  const ready = title.trim() !== "" && description.trim() !== "" && detected !== "";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api.post("/api/v1/privacy/breaches", {
        title: title.trim(),
        description: description.trim(),
        categories: categories.split(",").map((c) => c.trim()).filter(Boolean),
        affectedEstimate: affected.trim() === "" ? null : Number(affected),
        severity,
        detectedAt: fromLocalInput(detected) ?? undefined,
        containment: containment.trim() || undefined,
      });
      await onDone();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-brand/40 bg-surface p-4">
      <h4 className="text-sm font-bold text-ink">Log a personal-data breach</h4>
      <p className="text-[11px] text-ink-muted">The 72-hour clock for telling the Data Protection Board starts at the time it was detected.</p>
      {error && <Banner kind="error">{error}</Banner>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1 text-[11px] text-ink-muted md:col-span-2">
          Title
          <input className={input} maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="space-y-1 text-[11px] text-ink-muted md:col-span-2">
          What happened
          <textarea className={input} rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="space-y-1 text-[11px] text-ink-muted">
          Detected on
          <input className={input} type="datetime-local" max={nowLocal()} value={detected} onChange={(e) => setDetected(e.target.value)} />
        </label>
        <label className="space-y-1 text-[11px] text-ink-muted">
          Severity
          <select className={input} value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>{s.toLowerCase()}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-ink-muted">
          Kinds of data involved (comma separated)
          <input className={input} value={categories} onChange={(e) => setCategories(e.target.value)} placeholder="contact details, grades" />
        </label>
        <label className="space-y-1 text-[11px] text-ink-muted">
          People affected (estimate, optional)
          <input className={input} inputMode="numeric" value={affected} onChange={(e) => setAffected(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label className="space-y-1 text-[11px] text-ink-muted md:col-span-2">
          What has been done to contain it (optional)
          <textarea className={input} rows={2} maxLength={5000} value={containment} onChange={(e) => setContainment(e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <button className={primaryBtn} disabled={busy || !ready}>{busy ? "Saving…" : "Log breach"}</button>
        <button type="button" className={ghostBtn} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
};

/**
 * The personal-data breach register (DPDP Act s.8(6)) with its 72-hour clock. Backed by /api/v1/privacy/breaches;
 * administrators are e-mailed as the deadline nears. A breach moves detected, contained, Board notified, closed,
 * and closing needs the Board's notice or a reason none was needed.
 */
export const BreachRegisterPanel: React.FC = () => {
  const [filter, setFilter] = useState("open");
  const [adding, setAdding] = useState(false);
  const list = useApiData<Register>("/api/v1/privacy/breaches", { status: filter === "all" ? undefined : filter });
  const p = list.data;

  return (
    <section className="space-y-5" aria-labelledby="breach-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="breach-h" className="font-bold text-base text-ink">Breach register</h3>
          <p className="text-xs text-ink-muted">Log every personal-data breach. The Data Protection Board must be told within 72 hours of detection.</p>
        </div>
        <button className={ghostBtn} onClick={() => setAdding(true)} disabled={adding}>
          <Plus className="h-3.5 w-3.5" /> Log breach
        </button>
      </div>

      {p && (
        <div className="flex flex-wrap gap-2 text-[11px]" aria-label="Summary">
          <span className="px-2.5 py-1 rounded-full border border-line bg-raised font-semibold text-ink">{p.summary.open} open</span>
          <span className={`px-2.5 py-1 rounded-full border font-semibold ${p.summary.overdue > 0 ? "bg-danger/10 border-danger/30 text-danger" : "bg-success/10 border-success/30 text-success"}`}>{p.summary.overdue} overdue</span>
        </div>
      )}

      {adding && (
        <NewBreach
          onCancel={() => setAdding(false)}
          onDone={async () => {
            setAdding(false);
            await list.reload();
          }}
        />
      )}

      <label className="block space-y-1 text-[11px] text-ink-muted w-40">
        Show
        <select className={input} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="open">Open</option>
          <option value="all">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </label>

      {list.error && <Banner kind="error">{list.error}</Banner>}
      {list.isLoading && !p && <p className="text-xs text-ink-subtle">Loading…</p>}
      {p && p.data.length === 0 && <p className="text-xs text-ink-subtle">No breaches here.</p>}
      {p && p.data.length > 0 && (
        <ul className="divide-y divide-line border border-line rounded-2xl overflow-hidden" aria-label="Breaches">
          {p.data.map((b) => (
            <BreachRow key={`${b.id}-${b.status}-${b.boardNotifiedAt}-${b.peopleNotifiedAt}-${b.containment}`} b={b} onChanged={list.reload} />
          ))}
        </ul>
      )}
    </section>
  );
};
