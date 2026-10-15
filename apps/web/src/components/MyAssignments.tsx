"use client";

import React, { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import { api } from "@/lib/api";
import { useMyEnrollments } from "@/hooks/useEnrollments";
import { useAction, useApiData } from "@/hooks/useApiData";
import { Banner } from "@/components/admin/IdentityPanels";
import { appealDaysLeft, type Criterion } from "@/lib/forms";

interface Assignment { id: string; title: string; instructions: string; maxPoints: number; dueDate: string | null; rubricJson: Criterion[] | null }
interface Submission {
  id: string; fileUrl: string | null; submissionText: string | null; grade: number | null; feedback: string | null;
  rubricScoresJson: Record<string, number> | null; submittedAt: string; gradedAt: string | null;
}
interface Appeal { id: string; status: "OPEN" | "UPHELD" | "DENIED"; response: string | null; submission: { id: string } }

const input = "bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500";
const primary = "px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all";
const ghost = "px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50";

const AppealBox: React.FC<{ assignmentId: string; sub: Submission; appeal: Appeal | undefined; onDone: () => void }> = ({ assignmentId, sub, appeal, onDone }) => {
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (appeal) {
    return (
      <div className="text-[11px] text-slate-300 bg-slate-900 border border-slate-800 rounded-xl p-3">
        <strong className="text-white">Appeal: {appeal.status === "OPEN" ? "waiting for a decision" : appeal.status === "UPHELD" ? "upheld, your grade was changed" : "not upheld"}</strong>
        {appeal.response && <div className="mt-1 text-slate-400">{appeal.response}</div>}
      </div>
    );
  }
  const days = sub.gradedAt ? appealDaysLeft(sub.gradedAt) : 0;
  if (days === 0) return <div className="text-[11px] text-slate-500">The appeal period for this grade has ended.</div>;

  return open ? (
    <div className="space-y-2">
      {error && <Banner kind="error">{error}</Banner>}
      <textarea className={`${input} w-full`} rows={3} maxLength={2000} aria-label="Why should this grade be reviewed?" placeholder="Explain what you think was marked incorrectly (at least 10 characters)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <button className={primary} disabled={busy || reason.trim().length < 10} onClick={() => run(async () => { await api.post(`/api/v1/assignments/${assignmentId}/submissions/${sub.id}/appeal`, { reason: reason.trim() }); setOpen(false); onDone(); })}>Send appeal</button>
        <button className={ghost} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  ) : (
    <button className={ghost} onClick={() => setOpen(true)}>Appeal this grade ({days} day{days === 1 ? "" : "s"} left)</button>
  );
};

const Card: React.FC<{ a: Assignment; appeals: Appeal[]; reloadAppeals: () => void }> = ({ a, appeals, reloadAppeals }) => {
  const { data, reload } = useApiData<{ data: Submission[] }>(`/api/v1/assignments/${a.id}/submissions`);
  const sub = data?.data?.[0];
  const { busy, error, run, clearError } = useAction();
  const [text, setText] = useState("");
  const [file, setFile] = useState("");
  const [editing, setEditing] = useState(false);
  const graded = !!sub?.gradedAt;
  const late = a.dueDate && !sub && new Date(a.dueDate) < new Date();

  useEffect(() => { if (sub) { setText(sub.submissionText ?? ""); setFile(sub.fileUrl ?? ""); } }, [sub?.id]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await api.post(`/api/v1/assignments/${a.id}/submit`, { ...(text.trim() ? { submissionText: text.trim() } : {}), ...(file.trim() ? { fileUrl: file.trim() } : {}) });
      setEditing(false);
      await reload();
    });
  };

  return (
    <li className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-white">{a.title}</h4>
          <div className="text-[11px] text-slate-500">{a.maxPoints} points{a.dueDate ? ` · due ${new Date(a.dueDate).toLocaleString()}` : ""}{late ? " · past due" : ""}</div>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${graded ? "bg-emerald-950 text-emerald-300 border-emerald-800" : sub ? "bg-blue-950 text-blue-300 border-blue-800" : "bg-slate-800 text-slate-300 border-slate-700"}`}>
          {graded ? `${sub!.grade} / ${a.maxPoints}` : sub ? "Submitted" : "Not submitted"}
        </span>
      </div>
      <p className="text-xs text-slate-400 whitespace-pre-wrap">{a.instructions}</p>

      {a.rubricJson && (
        <div className="text-[11px] text-slate-400 space-y-1">
          <div className="font-bold uppercase tracking-wider text-slate-500">Rubric</div>
          {a.rubricJson.map((c) => (
            <div key={c.id} className="flex justify-between gap-3">
              <span>{c.name}{c.description ? <span className="text-slate-600"> · {c.description}</span> : null}</span>
              <span className="text-slate-300 shrink-0">{graded && sub!.rubricScoresJson ? `${sub!.rubricScoresJson[c.id] ?? 0} / ` : ""}{c.maxPoints}</span>
            </div>
          ))}
        </div>
      )}

      {graded && sub!.feedback && <div className="text-xs text-slate-300 bg-slate-900 border border-slate-800 rounded-xl p-3"><strong className="text-white">Feedback:</strong> {sub!.feedback}</div>}
      {graded && <AppealBox assignmentId={a.id} sub={sub!} appeal={appeals.find((p) => p.submission.id === sub!.id)} onDone={reloadAppeals} />}

      {!graded && (!sub || editing) && (
        <form onSubmit={submit} className="space-y-2" onChange={clearError}>
          {error && <Banner kind="error">{error}</Banner>}
          <textarea className={`${input} w-full`} rows={4} aria-label={`Your answer for ${a.title}`} placeholder="Type your answer…" value={text} onChange={(e) => setText(e.target.value)} />
          <input className={`${input} w-full`} type="url" aria-label="Link to your file (optional)" placeholder="…or a link to your file (https://…)" value={file} onChange={(e) => setFile(e.target.value)} />
          <button className={primary} disabled={busy || (!text.trim() && !file.trim())}>{busy ? "Submitting…" : sub ? "Resubmit" : "Submit"}</button>
        </form>
      )}
      {!graded && sub && !editing && <button className={ghost} onClick={() => setEditing(true)}>Edit my submission</button>}
    </li>
  );
};

export const MyAssignments: React.FC<{ onClose: () => void; courseId?: string }> = ({ onClose, courseId: initialCourseId }) => {
  const { enrollments, isLoading } = useMyEnrollments();
  const active = enrollments.filter((e) => e.status !== "DROPPED");
  const [courseId, setCourseId] = useState(initialCourseId ?? "");
  useEffect(() => { if (!courseId && active.length) setCourseId(active[0].courseId); }, [active, courseId]);

  const list = useApiData<{ data: Assignment[] }>(courseId ? `/api/v1/courses/${courseId}/assignments` : null);
  const appeals = useApiData<{ data: Appeal[] }>(courseId ? `/api/v1/courses/${courseId}/appeals` : null);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="My assignments">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-3xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-slate-950 border-b border-slate-800 px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400"><FileText className="h-5 w-5" /></div>
            <div><h3 className="font-bold text-base text-white">My assignments</h3><p className="text-xs text-slate-400">Submit work, see grades and feedback, and appeal a grade.</p></div>
          </div>
          <div className="flex items-center gap-2">
            <select className={input} aria-label="Course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>{active.map((e) => <option key={e.courseId} value={e.courseId}>{e.course?.code} · {e.course?.title}</option>)}</select>
            <button onClick={onClose} aria-label="Close" className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? <div className="text-xs text-slate-500">Loading…</div>
            : !courseId ? <div className="text-xs text-slate-500 p-10 text-center">Enrol in a course to see its assignments.</div>
            : list.error ? <Banner kind="error">{list.error}</Banner>
            : (list.data?.data ?? []).length === 0 ? <div className="text-xs text-slate-500 p-10 text-center">This course has no assignments yet.</div>
            : <ul className="space-y-4">{(list.data?.data ?? []).map((a) => <Card key={a.id} a={a} appeals={appeals.data?.data ?? []} reloadAppeals={appeals.reload} />)}</ul>}
        </div>
      </div>
    </div>
  );
};
