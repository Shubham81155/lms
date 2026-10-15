"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { typedPut } from "@/lib/typed-api";
import { useAuth } from "@/context/AuthContext";
import { useAction, useApiData } from "@/hooks/useApiData";
import { useStaffCourses } from "@/hooks/useStaffCourses";
import { Banner } from "@/components/admin/IdentityPanels";

interface Category { id: string; name: string; weightPercent: number }
interface Item { type: "QUIZ" | "ASSIGNMENT"; id: string; title: string; gradeCategoryId: string | null }
type CurveMethod = "NONE" | "ADD_POINTS" | "SCALE_TO_MAX";
interface Config { curve: { method: CurveMethod; value: number }; categories: Category[]; items: Item[] }
interface Row {
  userId: string; name: string; email: string; rawPercent: number; curvedPercent: number; letter: string;
  incomplete: boolean; status: "DRAFT" | "SUBMITTED" | "APPROVED"; decisionNote: string | null;
}
interface Book { data: Row[]; summary: { total: number; draft: number; submitted: number; approved: number; incomplete: number; average: number | null } }

const input = "bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand";
const primary = "px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all";
const ghost = "px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50";

const STATUS_STYLE: Record<Row["status"], string> = {
  DRAFT: "bg-raised text-ink border-line",
  SUBMITTED: "bg-accent/10 text-accent border-accent/30",
  APPROVED: "bg-success/10 text-success border-success/30",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Setup: categories, items, curve
// ---------------------------------------------------------------------------

const Setup: React.FC<{ courseId: string; canEdit: boolean }> = ({ courseId, canEdit }) => {
  const { data, isLoading, error, reload } = useApiData<{ data: Config }>(`/api/v1/courses/${courseId}/gradebook/config`);
  const { busy, error: actionError, run, clearError } = useAction();
  const [cats, setCats] = useState<{ name: string; weight: string }[]>([]);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<CurveMethod>("NONE");
  const [curveValue, setCurveValue] = useState("0");
  const [saved, setSaved] = useState<string | null>(null);

  const cfg = data?.data;
  useEffect(() => {
    if (!cfg) return;
    setCats(cfg.categories.map((c) => ({ name: c.name, weight: String(c.weightPercent) })));
    setAssign(Object.fromEntries(cfg.items.map((i) => [`${i.type}:${i.id}`, i.gradeCategoryId ?? ""])));
    setMethod(cfg.curve.method);
    setCurveValue(String(cfg.curve.value ?? 0));
  }, [cfg]);

  const total = round2(cats.reduce((s, c) => s + (Number(c.weight) || 0), 0));
  const totalOk = Math.abs(total - 100) < 0.005;
  const done = (what: string) => setSaved(what);

  const saveCategories = () =>
    run(async () => {
      await typedPut("/api/v1/courses/{courseId}/gradebook/categories", {
        categories: cats.map((c) => ({ name: c.name.trim(), weightPercent: Number(c.weight) })),
      }, { courseId });
      await reload();
      done("Categories saved.");
    });

  const saveItems = () =>
    run(async () => {
      if (!cfg) return;
      const byName = new Map(cfg.categories.map((c) => [c.id, c.id]));
      await typedPut("/api/v1/courses/{courseId}/gradebook/items", {
        items: cfg.items.map((i) => {
          const v = assign[`${i.type}:${i.id}`] ?? "";
          return { type: i.type, id: i.id, categoryId: v && byName.has(v) ? v : null };
        }),
      }, { courseId });
      await reload();
      done("Assignments saved.");
    });

  const saveCurve = () =>
    run(async () => {
      await typedPut("/api/v1/courses/{courseId}/gradebook/curve", { method, value: method === "NONE" ? 0 : Number(curveValue) }, { courseId });
      await reload();
      done("Curve saved.");
    });

  if (isLoading) return <div className="text-xs text-ink-subtle p-6">Loading…</div>;
  if (error) return <Banner kind="error">{error}</Banner>;
  if (!cfg) return null;

  return (
    <div className="space-y-8" onChange={() => { clearError(); setSaved(null); }}>
      {actionError && <Banner kind="error">{actionError}</Banner>}
      {saved && <Banner kind="ok">{saved} Recalculate grades to apply the change.</Banner>}
      {!canEdit && <Banner kind="error">Teaching assistants can view the setup but not change it.</Banner>}

      <section className="space-y-3" aria-labelledby="cat-h">
        <div className="flex items-center justify-between">
          <h4 id="cat-h" className="text-xs font-bold uppercase tracking-wider text-ink">Grade categories</h4>
          <span className={`text-xs font-mono ${totalOk ? "text-success" : "text-danger"}`}>Total {total}% {totalOk ? "✓" : "(must be 100)"}</span>
        </div>
        {cats.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className={`${input} flex-1`} aria-label={`Category ${i + 1} name`} value={c.name} disabled={!canEdit} placeholder="e.g. Exams" onChange={(e) => setCats((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input className={`${input} w-24`} aria-label={`Category ${i + 1} weight`} type="number" min={0.01} max={100} step="0.01" value={c.weight} disabled={!canEdit} onChange={(e) => setCats((p) => p.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))} />
            <span className="text-xs text-ink-subtle">%</span>
            <button className={ghost} disabled={!canEdit} aria-label={`Remove category ${i + 1}`} onClick={() => setCats((p) => p.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></button>
          </div>
        ))}
        <div className="flex gap-2">
          <button className={ghost} disabled={!canEdit} onClick={() => setCats((p) => [...p, { name: "", weight: "" }])}><Plus className="h-3 w-3 inline mr-1" />Add category</button>
          <button className={primary} disabled={!canEdit || busy || !totalOk || cats.some((c) => !c.name.trim())} onClick={saveCategories}>Save categories</button>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="items-h">
        <h4 id="items-h" className="text-xs font-bold uppercase tracking-wider text-ink">Which work counts</h4>
        {cfg.items.length === 0 && <p className="text-xs text-ink-subtle">This course has no quizzes or assignments yet.</p>}
        {cfg.items.map((i) => (
          <div key={`${i.type}:${i.id}`} className="flex items-center justify-between gap-3 bg-canvas border border-line rounded-xl px-3 py-2">
            <div className="text-xs text-ink">
              <span className="text-[10px] font-bold text-ink-subtle mr-2">{i.type}</span>{i.title}
            </div>
            <select className={input} aria-label={`Category for ${i.title}`} disabled={!canEdit} value={assign[`${i.type}:${i.id}`] ?? ""} onChange={(e) => setAssign((p) => ({ ...p, [`${i.type}:${i.id}`]: e.target.value }))}>
              <option value="">Not graded</option>
              {cfg.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        ))}
        {cfg.items.length > 0 && <button className={primary} disabled={!canEdit || busy || cfg.categories.length === 0} onClick={saveItems}>Save assignments</button>}
        {cfg.categories.length === 0 && cfg.items.length > 0 && <p className="text-[11px] text-ink-subtle">Save categories first.</p>}
      </section>

      <section className="space-y-3" aria-labelledby="curve-h">
        <h4 id="curve-h" className="text-xs font-bold uppercase tracking-wider text-ink">Curve</h4>
        <div className="flex items-center gap-2">
          <select className={input} aria-label="Curve method" disabled={!canEdit} value={method} onChange={(e) => setMethod(e.target.value as CurveMethod)}>
            <option value="NONE">No curve</option>
            <option value="ADD_POINTS">Add points to everyone</option>
            <option value="SCALE_TO_MAX">Scale so the best score is 100</option>
          </select>
          {method === "ADD_POINTS" && <input className={`${input} w-24`} aria-label="Points to add" type="number" min={0.5} max={50} step="0.5" value={curveValue} disabled={!canEdit} onChange={(e) => setCurveValue(e.target.value)} />}
          <button className={primary} disabled={!canEdit || busy || (method === "ADD_POINTS" && !(Number(curveValue) > 0))} onClick={saveCurve}>Save curve</button>
        </div>
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Grades and approval
// ---------------------------------------------------------------------------

const Grades: React.FC<{ courseId: string; canEdit: boolean; isAdmin: boolean }> = ({ courseId, canEdit, isAdmin }) => {
  const { data, isLoading, error, reload } = useApiData<Book>(`/api/v1/courses/${courseId}/gradebook`);
  const { busy, error: actionError, run } = useAction();
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const base = `/api/v1/courses/${courseId}/gradebook`;

  const act = (path: string, body: unknown, done: (r: any) => string) =>
    run(async () => {
      const r = await api.post<any>(`${base}/${path}`, body);
      setMsg(done(r.data));
      await reload();
    });

  const s = data?.summary;
  const submit = () => {
    if (s && s.incomplete > 0 && !window.confirm(`${s.incomplete} grade(s) still have work waiting for a grader. Submit anyway?`)) return;
    act("submit", { allowIncomplete: !!s && s.incomplete > 0 }, (r) => `${r.submitted} grade(s) submitted for approval.`);
  };

  if (isLoading) return <div className="text-xs text-ink-subtle p-6">Loading…</div>;
  if (error) return <Banner kind="error">{error}</Banner>;

  return (
    <div className="space-y-4">
      {actionError && <Banner kind="error">{actionError}</Banner>}
      {msg && <Banner kind="ok">{msg}</Banner>}

      <div className="flex flex-wrap items-center gap-2">
        {canEdit && <button className={primary} disabled={busy} onClick={() => act("calculate", undefined, (r) => `Calculated ${r.calculated} grade(s)${r.skippedApproved ? `; ${r.skippedApproved} approved grade(s) left unchanged` : ""}.`)}>Calculate grades</button>}
        {canEdit && <button className={ghost} disabled={busy || !s?.draft} onClick={submit}>Submit for approval</button>}
        {isAdmin && <button className={ghost} disabled={busy || !s?.submitted} onClick={() => act("approve", undefined, (r) => `${r.approved} grade(s) approved and released to learners.`)}>Approve</button>}
        {isAdmin && <button className={ghost} disabled={busy || !s?.submitted} onClick={() => setRejecting((v) => !v)}>Send back…</button>}
        {isAdmin && <button className={ghost} disabled={busy || !s?.approved} onClick={() => window.confirm("Reopen approved grades for correction? Learners will stop seeing them until re-approved.") && act("reopen", undefined, (r) => `${r.reopened} grade(s) reopened.`)}>Reopen</button>}
      </div>

      {rejecting && (
        <div className="flex items-center gap-2">
          <input className={`${input} flex-1`} aria-label="Reason for sending back" placeholder="Reason (shown to the instructor)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className={primary} disabled={busy || note.trim().length < 3} onClick={() => act("reject", { note: note.trim() }, (r) => `${r.returned} grade(s) sent back.`).then(() => { setRejecting(false); setNote(""); })}>Send back</button>
        </div>
      )}
      {isAdmin && s?.submitted ? <p className="text-[11px] text-ink-subtle">You cannot approve grades you submitted yourself; another administrator must.</p> : null}

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
          {[["Learners", s.total], ["Draft", s.draft], ["Submitted", s.submitted], ["Approved", s.approved], ["Average", s.average === null ? "–" : `${s.average}%`]].map(([l, v]) => (
            <div key={String(l)} className="bg-canvas border border-line rounded-xl p-3"><div className="text-[10px] text-ink-subtle">{l}</div><div className="text-lg font-bold text-ink">{v}</div></div>
          ))}
        </div>
      )}

      {data && data.data.length === 0 ? (
        <div className="text-xs text-ink-subtle p-8 text-center bg-canvas border border-line rounded-2xl">No grades yet. Set up categories, then calculate.</div>
      ) : (
        <div className="overflow-x-auto bg-canvas border border-line rounded-2xl">
          <table className="w-full text-xs">
            <thead className="text-ink-subtle text-left"><tr><th className="p-3">Learner</th><th className="p-3">Raw</th><th className="p-3">Final</th><th className="p-3">Letter</th><th className="p-3">Status</th></tr></thead>
            <tbody>
              {(data?.data ?? []).map((r) => (
                <tr key={r.userId} className="border-t border-line">
                  <td className="p-3 text-ink">{r.name}<div className="text-[10px] text-ink-subtle">{r.email}</div></td>
                  <td className="p-3 text-ink-muted">{r.rawPercent}%</td>
                  <td className="p-3 font-bold text-ink">{r.curvedPercent}%</td>
                  <td className="p-3 text-ink">{r.letter}</td>
                  <td className="p-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                    {r.incomplete && <span title="Work is still waiting for a grader" className="ml-2 text-accent inline-flex items-center"><AlertTriangle className="h-3 w-3" /></span>}
                    {r.decisionNote && <div className="text-[10px] text-ink-subtle mt-1">Sent back: {r.decisionNote}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------

export const CourseGradebook: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { user } = useAuth();
  const { courses, isLoading } = useStaffCourses();
  const [courseId, setCourseId] = useState<string>("");
  const [tab, setTab] = useState<"grades" | "setup">("grades");

  useEffect(() => {
    if (!courseId && courses.length > 0) setCourseId(courses[0].id);
  }, [courses, courseId]);

  const isAdmin = user?.role === "TENANT_ADMIN" || user?.role === "SUPER_ADMIN";
  const canEdit = isAdmin || user?.role === "INSTRUCTOR";
  const course = useMemo(() => courses.find((c) => c.id === courseId), [courses, courseId]);

  return (
    <div className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Gradebook">
      <div className="bg-surface border border-line rounded-3xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-success/20 border border-success/30 flex items-center justify-center text-success"><CheckCircle2 className="h-5 w-5" /></div>
            <div>
              <h3 className="font-bold text-base text-ink">Gradebook</h3>
              <p className="text-xs text-ink-muted">Weighted categories, curve and two-person approval.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <select className={input} aria-label="Course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}
            </select>
            <button onClick={onClose} aria-label="Close" className="p-1 rounded-xl hover:bg-raised text-ink-muted hover:text-ink"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="bg-canvas/60 border-b border-line px-6 py-2.5 flex gap-2">
          {(["grades", "setup"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-xl text-xs font-bold ${tab === t ? "bg-brand text-on-brand" : "text-ink-muted hover:bg-surface"}`}>{t === "grades" ? "Grades & approval" : "Setup"}</button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="text-xs text-ink-subtle">Loading courses…</div>
          ) : !course ? (
            <div className="text-xs text-ink-subtle p-10 text-center">You are not assigned to any course yet.</div>
          ) : tab === "grades" ? (
            <Grades key={course.id} courseId={course.id} canEdit={canEdit} isAdmin={isAdmin} />
          ) : (
            <Setup key={course.id} courseId={course.id} canEdit={canEdit} />
          )}
        </div>
      </div>
    </div>
  );
};
