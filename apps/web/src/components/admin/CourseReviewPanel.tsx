"use client";

import React, { useState } from "react";
import { CheckCircle2, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAction, useApiData } from "@/hooks/useApiData";
import { Banner } from "@/components/admin/IdentityPanels";

interface Pending {
  id: string;
  code: string;
  title: string;
  term: string | null;
  message: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  counts: { modules: number; quizzes: number; assignments: number };
}

const input = "w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand";
const primary = "px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-lg text-[11px] font-bold transition-all";
const ghost = "px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50";

/** Publishing review for administrators: the on/off setting and the courses waiting for a decision. */
export const CourseReviewPanel: React.FC<{ onDecided?: () => void }> = ({ onDecided }) => {
  const setting = useApiData<{ data: { required: boolean } }>("/api/v1/admin/course-approval");
  const queue = useApiData<{ data: Pending[] }>("/api/v1/course-reviews");
  const { busy, error, run } = useAction();
  const [sendingBack, setSendingBack] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const required = setting.data?.data.required ?? false;
  const pending = queue.data?.data ?? [];

  const decide = (fn: () => Promise<unknown>, text: string) =>
    run(async () => {
      await fn();
      setDone(text);
      setSendingBack(null);
      setNote("");
      await queue.reload();
      onDecided?.();
    });

  return (
    <section className="bg-surface border border-line rounded-3xl p-6 shadow-xl space-y-4" aria-labelledby="review-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="review-h" className="font-bold text-base text-ink">Publishing review</h3>
          <p className="text-xs text-ink-muted">When on, instructors submit draft courses for review and only administrators publish them.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
          <input
            type="checkbox"
            className="rounded border-line"
            checked={required}
            disabled={busy || setting.isLoading}
            onChange={(e) => run(async () => {
              await api.put("/api/v1/admin/course-approval", { required: e.target.checked });
              await setting.reload();
            })}
          />
          Courses need approval before they are published
        </label>
      </div>
      {(error || setting.error || queue.error) && <Banner kind="error">{error || setting.error || queue.error}</Banner>}
      {done && <Banner kind="ok">{done}</Banner>}

      {pending.length === 0 ? (
        <p className="text-xs text-ink-subtle">{required ? "No course is waiting for review." : "Review is off; instructors publish their own courses."}</p>
      ) : (
        <ul className="space-y-2">
          {pending.map((c) => (
            <li key={c.id} className="bg-canvas border border-line rounded-xl p-3 space-y-2 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <strong className="text-ink">{c.code}</strong> <span className="text-ink">{c.title}</span>
                  {c.term && <span className="text-ink-subtle"> · {c.term}</span>}
                  <div className="text-[11px] text-ink-subtle">
                    Submitted{c.submittedBy ? ` by ${c.submittedBy}` : ""}{c.submittedAt ? ` on ${new Date(c.submittedAt).toLocaleDateString()}` : ""} · {c.counts.modules} module(s), {c.counts.quizzes} quiz(zes), {c.counts.assignments} assignment(s)
                  </div>
                  {c.message && <p className="mt-1 text-ink-muted">“{c.message}”</p>}
                </div>
                <div className="flex gap-2">
                  <button className={primary} disabled={busy} onClick={() => decide(() => api.post(`/api/v1/courses/${c.id}/review/approve`, {}), `${c.code} is published.`)}>
                    <CheckCircle2 className="h-3 w-3 inline mr-1" />
                    Approve and publish
                  </button>
                  <button className={ghost} disabled={busy} onClick={() => { setSendingBack(sendingBack === c.id ? null : c.id); setNote(""); }}>
                    <Undo2 className="h-3 w-3 inline mr-1" />
                    Request changes
                  </button>
                </div>
              </div>
              {sendingBack === c.id && (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    decide(() => api.post(`/api/v1/courses/${c.id}/review/request-changes`, { note: note.trim() }), `${c.code} was sent back to its instructors.`);
                  }}
                >
                  <input className={input} autoFocus maxLength={2000} aria-label={`What should change in ${c.code}`} placeholder="What needs to change (shown to the instructors)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <button className={primary} disabled={busy || note.trim().length < 3}>Send back</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
