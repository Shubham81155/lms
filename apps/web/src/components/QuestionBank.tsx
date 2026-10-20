"use client";

import React, { useEffect, useState } from "react";
import { Plus, Trash2, X, Library } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useAction, useApiData } from "@/hooks/useApiData";
import { useStaffCourses } from "@/hooks/useStaffCourses";
import { Banner } from "@/components/admin/IdentityPanels";
import { draftProblem, type ChoiceOption } from "@/lib/forms";
import { BLOOM_LEVELS, QUESTION_TYPES, QuestionFields, blankQuestion, questionBody, type QuestionDraft } from "@/components/assessments/QuestionFields";
import { useEscapeKey } from "@/hooks/useEscapeKey";

const TYPES = QUESTION_TYPES;
const BLOOM = BLOOM_LEVELS;

type Option = ChoiceOption;
interface BankItem {
  id: string; questionText: string; questionType: string; points: number; optionsJson: Option[] | null;
  correctAnswer: string | null; explanation: string | null; tags: string[]; bloomLevel: string | null; courseId: string | null; ownerId: string;
}
interface List { data: BankItem[]; pagination: { page: number; totalPages: number; total: number } }

const input = "bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand";
const primary = "px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all";
const ghost = "px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50";
const label = (s: string) => s.replace(/_/g, " ").toLowerCase();

const blank = (type = "MULTIPLE_CHOICE"): QuestionDraft & { tags: string; courseId: string } => ({ ...blankQuestion(type), tags: "", courseId: "" });

const Editor: React.FC<{ item: BankItem | null; onDone: () => void; onCancel: () => void }> = ({ item, onDone, onCancel }) => {
  const { courses } = useStaffCourses();
  const { busy, error, run, clearError } = useAction();
  const [d, setD] = useState(() =>
    item
      ? { type: item.questionType, text: item.questionText, points: String(item.points), options: item.optionsJson ?? [], answer: item.correctAnswer ?? "", tags: item.tags.join(", "), bloom: item.bloomLevel ?? "", courseId: item.courseId ?? "" }
      : blank()
  );
  const problem = draftProblem(d);
  const set = (patch: Partial<typeof d>) => { clearError(); setD((p) => ({ ...p, ...patch })); };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const body = {
        ...questionBody(d),
        tags: d.tags.split(/[,\s]+/).filter(Boolean),
        courseId: d.courseId || null,
      };
      if (item) await api.patch(`/api/v1/question-bank/${item.id}`, body);
      else await api.post("/api/v1/question-bank", body);
      onDone();
    });
  };

  return (
    <form onSubmit={save} className="space-y-4 bg-canvas border border-line rounded-2xl p-5">
      <h4 className="text-sm font-bold text-ink">{item ? "Edit question" : "New question"}</h4>
      {error && <Banner kind="error">{error}</Banner>}
      <QuestionFields d={d} set={set} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1 text-xs text-ink-muted font-semibold">Tags (comma separated)
          <input className={`${input} w-full`} placeholder="raft, consensus" value={d.tags} onChange={(e) => set({ tags: e.target.value })} />
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">Share with course staff
          <select className={`${input} w-full`} value={d.courseId} onChange={(e) => set({ courseId: e.target.value })}>
            <option value="">Only me</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button className={primary} disabled={busy || !!problem}>{busy ? "Saving…" : "Save question"}</button>
        <button type="button" className={ghost} onClick={onCancel}>Cancel</button>
        {problem && <span className="text-[11px] text-accent">{problem}</span>}
      </div>
    </form>
  );
};

export const QuestionBank: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useEscapeKey(onClose);
  const { user } = useAuth();
  const { courses } = useStaffCourses();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [bloom, setBloom] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<BankItem | "new" | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [courseId, setCourseId] = useState("");
  const [quizId, setQuizId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  // Search as the user pauses typing rather than on every key press.
  useEffect(() => {
    const t = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading, error: loadError, reload } = useApiData<List>("/api/v1/question-bank", {
    page, limit: 10, q: query || undefined, tag: tag.trim().toLowerCase() || undefined, bloomLevel: bloom || undefined, type: type || undefined,
  });
  const quizzes = useApiData<{ data: { id: string; title: string }[] }>(courseId ? `/api/v1/courses/${courseId}/quizzes` : null);
  useEffect(() => { setQuizId(""); }, [courseId]);

  const isAdmin = user?.role === "TENANT_ADMIN" || user?.role === "SUPER_ADMIN";
  const items = data?.data ?? [];
  const canModify = (i: BankItem) => isAdmin || i.ownerId === user?.id;

  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const addToQuiz = () =>
    run(async () => {
      const r = await api.post<{ data: unknown[] }>(`/api/v1/quizzes/${quizId}/questions/from-bank`, { itemIds: [...selected] });
      setMsg(`Added ${r.data.length} question(s) to the quiz.`);
      setSelected(new Set());
    });

  const remove = (i: BankItem) => {
    if (!window.confirm("Delete this question from the bank? Copies already in quizzes are not affected.")) return;
    run(async () => {
      await api.delete(`/api/v1/question-bank/${i.id}`);
      setSelected((p) => { const n = new Set(p); n.delete(i.id); return n; });
      await reload();
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Question bank">
      <div className="bg-surface border border-line rounded-3xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-orchid/20 border border-orchid/30 flex items-center justify-center text-orchid"><Library className="h-5 w-5" /></div>
            <div>
              <h3 className="font-bold text-base text-ink">Question bank</h3>
              <p className="text-xs text-ink-muted">Reusable questions with tags and Bloom levels. Copy them into any quiz you teach.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className={primary} onClick={() => setEditing("new")}><Plus className="h-3.5 w-3.5 inline mr-1" />New question</button>
            <button onClick={onClose} aria-label="Close" className="p-1 rounded-xl hover:bg-raised text-ink-muted hover:text-ink"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {(error || loadError) && <Banner kind="error">{error || loadError}</Banner>}
          {msg && <Banner kind="ok">{msg}</Banner>}

          {editing ? (
            <Editor item={editing === "new" ? null : editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />
          ) : (
            <>
              <div role="search" className="flex flex-wrap items-center gap-2">
                <input className={`${input} w-56`} aria-label="Search questions" placeholder="Search text…" value={q} onChange={(e) => setQ(e.target.value)} />
                <input className={`${input} w-32`} aria-label="Filter by tag" placeholder="Tag" value={tag} onChange={(e) => { setTag(e.target.value); setPage(1); }} />
                <select className={input} aria-label="Filter by type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
                  <option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                </select>
                <select className={input} aria-label="Filter by Bloom level" value={bloom} onChange={(e) => { setBloom(e.target.value); setPage(1); }}>
                  <option value="">All levels</option>{BLOOM.map((b) => <option key={b} value={b}>{label(b)}</option>)}
                </select>
              </div>

              <ul className="space-y-2">
                {isLoading && <li className="text-xs text-ink-subtle">Loading…</li>}
                {!isLoading && items.length === 0 && <li className="text-xs text-ink-subtle p-8 text-center bg-canvas border border-line rounded-2xl">No questions match. Create your first one.</li>}
                {items.map((i) => (
                  <li key={i.id} className="bg-canvas border border-line rounded-2xl p-4 flex items-start gap-3">
                    <input type="checkbox" className="mt-1" aria-label={`Select question: ${i.questionText.slice(0, 40)}`} checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-ink whitespace-pre-wrap">{i.questionText}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span className="px-2 py-0.5 rounded-full bg-surface border border-line text-ink">{label(i.questionType)}</span>
                        <span className="px-2 py-0.5 rounded-full bg-surface border border-line text-ink">{i.points} pt</span>
                        {i.bloomLevel && <span className="px-2 py-0.5 rounded-full bg-orchid/15 border border-orchid/30 text-orchid">{label(i.bloomLevel)}</span>}
                        {i.courseId && <span className="px-2 py-0.5 rounded-full bg-brand/15 border border-brand/30 text-brand-fg">shared</span>}
                        {i.tags.map((t) => <span key={t} className="px-2 py-0.5 rounded-full bg-surface border border-line text-ink-muted">#{t}</span>)}
                      </div>
                    </div>
                    {canModify(i) && (
                      <div className="flex gap-2">
                        <button className={ghost} onClick={() => setEditing(i)}>Edit</button>
                        <button className={ghost} aria-label="Delete question" disabled={busy} onClick={() => remove(i)}><Trash2 className="h-3 w-3" /></button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              {data && data.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between text-xs text-ink-muted">
                  <span>Page {data.pagination.page} of {data.pagination.totalPages} · {data.pagination.total} questions</span>
                  <div className="flex gap-2">
                    <button className={ghost} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                    <button className={ghost} disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {!editing && (
          <div className="bg-canvas border-t border-line px-6 py-3 flex flex-wrap items-center gap-3">
            <span className="text-xs text-ink-muted">{selected.size} selected</span>
            <select className={input} aria-label="Course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">Choose a course…</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}
            </select>
            <select className={input} aria-label="Quiz" value={quizId} onChange={(e) => setQuizId(e.target.value)} disabled={!courseId}>
              <option value="">Choose a quiz…</option>{(quizzes.data?.data ?? []).map((z) => <option key={z.id} value={z.id}>{z.title}</option>)}
            </select>
            <button className={primary} disabled={busy || !quizId || selected.size === 0} onClick={addToQuiz}>Add to quiz</button>
          </div>
        )}
      </div>
    </div>
  );
};
