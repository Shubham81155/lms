"use client";

import React, { useState } from "react";
import { EyeOff, Eye, Flag, Lock, Pin, Unlock, X } from "lucide-react";
import { api } from "@/lib/api";
import { errorMessage } from "@/hooks/useApiData";
import type { ForumFlagView, ForumThreadView } from "@/hooks/useEngagement";

const chip = "px-2.5 py-1 bg-surface border border-line text-ink-muted hover:text-ink rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors disabled:opacity-60";

/** Any participant can report a thread or a reply; the course staff see it in their reports queue. */
export const ReportControl: React.FC<{ targetType: "THREAD" | "POST"; targetId: string; subject: string }> = ({ targetType, targetId, subject }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async () => {
    setBusy(true);
    try {
      await api.post("/api/v1/flags", { targetType, targetId, reason: reason.trim() });
      setResult({ ok: true, text: "Reported. The course staff have been notified." });
      setOpen(false);
      setReason("");
    } catch (e) {
      setResult({ ok: false, text: errorMessage(e, "Could not send your report.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {!open && (
        <button onClick={() => { setResult(null); setOpen(true); }} className={chip} aria-label={`Report ${subject}`}>
          <Flag className="h-3 w-3" />
          <span>Report</span>
        </button>
      )}
      {open && (
        <span className="inline-flex items-center gap-1.5">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Why are you reporting this?"
            aria-label={`Reason for reporting ${subject}`}
            className="w-56 rounded-lg border border-line bg-canvas px-2 py-1 text-[11px] text-ink focus:border-brand focus:outline-none"
          />
          <button onClick={send} disabled={busy || reason.trim().length < 3} className="rounded-lg bg-danger px-2 py-1 text-[11px] font-bold text-on-brand disabled:opacity-50">
            {busy ? "Sending…" : "Send report"}
          </button>
          <button onClick={() => setOpen(false)} className={chip}>
            Cancel
          </button>
        </span>
      )}
      {result && (
        <span role={result.ok ? "status" : "alert"} className={`text-[11px] font-semibold ${result.ok ? "text-success" : "text-danger"}`}>
          {result.text}
        </span>
      )}
    </span>
  );
};

/** Course staff: pin, lock or hide the open thread. */
export const ThreadModerationBar: React.FC<{ thread: ForumThreadView; busy: boolean; onModerate: (patch: { pinned?: boolean; locked?: boolean; hidden?: boolean }) => void }> = ({ thread, busy, onModerate }) => (
  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/60 px-3 py-2" role="group" aria-label="Moderation">
    <span className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">Moderate</span>
    <button className={chip} disabled={busy} onClick={() => onModerate({ pinned: !thread.pinned })}>
      <Pin className="h-3 w-3" />
      <span>{thread.pinned ? "Unpin" : "Pin"}</span>
    </button>
    <button className={chip} disabled={busy} onClick={() => onModerate({ locked: !thread.locked })}>
      {thread.locked ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
      <span>{thread.locked ? "Unlock replies" : "Lock replies"}</span>
    </button>
    <button className={chip} disabled={busy} onClick={() => onModerate({ hidden: !thread.hidden })}>
      {thread.hidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
      <span>{thread.hidden ? "Restore thread" : "Hide thread"}</span>
    </button>
    {thread.hidden && <span className="text-[11px] font-semibold text-accent">Hidden from learners</span>}
  </div>
);

interface PanelProps {
  flags: ForumFlagView[];
  error: string | null;
  onClose: () => void;
  onOpenThread: (threadId: string) => void;
  /** Called after a report is resolved or content is hidden, so the forum can refresh. */
  onChanged: () => void;
}

/** The open reports of a course. Staff can hide the reported text, dismiss the report, or go to the thread. */
export const ReportsPanel: React.FC<PanelProps> = ({ flags, error, onClose, onOpenThread, onChanged }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (flag: ForumFlagView, hide: boolean) => {
    setBusy(flag.id);
    setProblem(null);
    try {
      if (hide) {
        if (flag.targetType === "THREAD") await api.patch(`/api/v1/threads/${flag.targetId}/moderate`, { hidden: true });
        else await api.patch(`/api/v1/posts/${flag.targetId}/moderate`, { hidden: true });
      }
      await api.post(`/api/v1/flags/${flag.id}/resolve`, {});
      onChanged();
    } catch (e) {
      setProblem(errorMessage(e, "Could not update the report."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-surface" role="region" aria-label="Reports">
      <div className="flex items-center justify-between border-b border-line bg-canvas px-6 py-4">
        <div>
          <h4 className="text-sm font-bold text-ink">Reports ({flags.length})</h4>
          <p className="text-xs text-ink-muted">Posts that participants have flagged. Hiding removes the text from learners until you restore it.</p>
        </div>
        <button onClick={onClose} aria-label="Close reports" className="rounded-xl p-1 text-ink-muted hover:bg-raised hover:text-ink">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-6">
        {(error || problem) && (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-xs font-semibold text-danger">
            {error || problem}
          </p>
        )}
        {flags.length === 0 && !error && <p className="rounded-2xl border border-dashed border-line px-6 py-12 text-center text-xs text-ink-muted">No open reports. Nothing needs your attention.</p>}
        {flags.map((f) => (
          <div key={f.id} className="space-y-2 rounded-2xl border border-line bg-canvas p-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
              <span className="rounded-full border border-line bg-surface px-2 py-0.5 font-bold text-ink">{f.targetType === "THREAD" ? "Thread" : "Reply"}</span>
              <span>in “{f.target?.threadTitle ?? "a deleted thread"}”</span>
              <span>· reported by {f.reporterName}</span>
              {f.target?.hidden && <span className="font-semibold text-accent">· already hidden</span>}
            </div>
            <p className="whitespace-pre-wrap rounded-xl border border-line bg-surface p-3 text-xs text-ink">{f.target?.excerpt ?? "This content is no longer available."}</p>
            <p className="text-xs text-ink">
              <span className="font-semibold text-danger">Reason:</span> {f.reason}
            </p>
            <div className="flex flex-wrap gap-2">
              {f.target && (
                <button className={chip} onClick={() => onOpenThread(f.target!.threadId)}>
                  Open thread
                </button>
              )}
              {f.target && !f.target.hidden && (
                <button className={chip} disabled={busy === f.id} onClick={() => run(f, true)} aria-label={`Hide reported content and resolve report ${f.id}`}>
                  <EyeOff className="h-3 w-3" />
                  <span>Hide it and resolve</span>
                </button>
              )}
              <button className={chip} disabled={busy === f.id} onClick={() => run(f, false)} aria-label={`Dismiss report ${f.id}`}>
                Dismiss report
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
