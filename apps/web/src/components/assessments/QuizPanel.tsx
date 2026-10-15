"use client";

import React, { useState } from "react";
import { api } from "@/lib/api";
import { useAction, useApiData } from "@/hooks/useApiData";
import { Banner } from "@/components/admin/IdentityPanels";
import { quizSettingsProblem, type QuizSettings as Settings } from "@/lib/assessmentForms";
import { QuizQuestions } from "./QuizQuestions";
import { QuizResults } from "./QuizResults";
import { card, danger, ghost, input, primary } from "./ui";

interface QuizRow {
  id: string;
  title: string;
  timeLimitMins: number | null;
  maxAttempts: number;
  passingPercent: number;
  requireProctoring: boolean;
  questionCount: number;
  submissionCount: number;
}

interface QuizDetail {
  title: string;
  timeLimitMins: number | null;
  maxAttempts: number;
  passingPercent: number;
  requireProctoring: boolean;
  randomizeQuestions: boolean;
}

const defaults: Settings = { title: "", timed: false, minutes: "30", attempts: "1", passing: "70", randomize: false, proctoring: false };

const fromDetail = (q: QuizDetail): Settings => ({
  title: q.title,
  timed: q.timeLimitMins !== null,
  minutes: String(q.timeLimitMins ?? 30),
  attempts: String(q.maxAttempts),
  passing: String(q.passingPercent),
  randomize: q.randomizeQuestions,
  proctoring: q.requireProctoring,
});

const toBody = (s: Settings) => ({
  title: s.title.trim(),
  timeLimitMins: s.timed ? Number(s.minutes) : null,
  maxAttempts: Number(s.attempts),
  passingPercent: Number(s.passing),
  randomizeQuestions: s.randomize,
  requireProctoring: s.proctoring,
});

const SettingsForm: React.FC<{ initial: Settings; saveLabel: string; busy: boolean; onSave: (s: Settings) => void; onCancel: () => void }> = ({ initial, saveLabel, busy, onSave, onCancel }) => {
  const [s, setS] = useState(initial);
  const problem = quizSettingsProblem(s);
  const set = (p: Partial<Settings>) => setS((x) => ({ ...x, ...p }));
  return (
    <form
      className="space-y-3 rounded-2xl border border-brand/40 bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(s);
      }}
    >
      <label className="block space-y-1 text-xs font-semibold text-ink-muted">
        Title
        <input className={`${input} w-full`} maxLength={255} value={s.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          Attempts allowed
          <input className={`${input} w-full`} type="number" min={1} max={100} value={s.attempts} onChange={(e) => set({ attempts: e.target.value })} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          Passing score (%)
          <input className={`${input} w-full`} type="number" min={0} max={100} value={s.passing} onChange={(e) => set({ passing: e.target.value })} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          Time limit
          <span className="flex items-center gap-2">
            <input type="checkbox" aria-label="Timed" checked={s.timed} onChange={(e) => set({ timed: e.target.checked })} />
            <input className={`${input} w-full`} type="number" min={1} max={1440} aria-label="Minutes" disabled={!s.timed} value={s.minutes} onChange={(e) => set({ minutes: e.target.value })} />
          </span>
        </label>
        <div className="space-y-1.5 pt-5 text-xs text-ink">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={s.randomize} onChange={(e) => set({ randomize: e.target.checked })} />
            Shuffle questions
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={s.proctoring} onChange={(e) => set({ proctoring: e.target.checked })} />
            Require proctoring
          </label>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className={primary} disabled={busy || !!problem}>
          {busy ? "Saving…" : saveLabel}
        </button>
        <button type="button" className={ghost} onClick={onCancel}>
          Cancel
        </button>
        {problem && <span className="text-[11px] text-accent">{problem}</span>}
      </div>
    </form>
  );
};

/** Loads a quiz's full settings (the list omits the shuffle option) before editing them. */
const EditSettings: React.FC<{ quizId: string; busy: boolean; onSave: (s: Settings) => void; onCancel: () => void }> = ({ quizId, busy, onSave, onCancel }) => {
  const detail = useApiData<{ data: QuizDetail }>(`/api/v1/quizzes/${quizId}`);
  if (detail.error) return <Banner kind="error">{detail.error}</Banner>;
  if (!detail.data) return <p className="text-xs text-ink-subtle">Loading…</p>;
  return <SettingsForm initial={fromDetail(detail.data.data)} saveLabel="Save settings" busy={busy} onSave={onSave} onCancel={onCancel} />;
};

type Section = "questions" | "results" | "settings" | "delete";

export const QuizPanel: React.FC<{ courseId: string; canEdit: boolean }> = ({ courseId, canEdit }) => {
  const list = useApiData<{ data: QuizRow[] }>(`/api/v1/courses/${courseId}/quizzes`);
  const { busy, error, run, clearError } = useAction();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<{ id: string; section: Section } | null>(null);
  const quizzes = list.data?.data ?? [];
  const toggle = (id: string, section: Section) => {
    clearError();
    setOpen((o) => (o && o.id === id && o.section === section ? null : { id, section }));
  };

  const create = (s: Settings) =>
    run(async () => {
      const r = await api.post<{ data: { id: string } }>(`/api/v1/courses/${courseId}/quizzes`, toBody(s));
      setCreating(false);
      await list.reload();
      setOpen({ id: r.data.id, section: "questions" });
    });

  const update = (id: string, s: Settings) =>
    run(async () => {
      await api.patch(`/api/v1/quizzes/${id}`, toBody(s));
      setOpen(null);
      await list.reload();
    });

  const remove = (id: string) =>
    run(async () => {
      await api.delete(`/api/v1/quizzes/${id}`);
      setOpen(null);
      await list.reload();
    });

  return (
    <div className="space-y-3">
      {(error || list.error) && <Banner kind="error">{error || list.error}</Banner>}
      {list.isLoading && !list.data && <p className="text-xs text-ink-subtle">Loading quizzes…</p>}

      {!list.isLoading && quizzes.length === 0 && !creating && (
        <p className={`${card} text-center text-xs text-ink-muted`}>This course has no quizzes yet.{canEdit ? " Create the first one." : ""}</p>
      )}

      <ul className="space-y-3">
        {quizzes.map((q) => (
          <li key={q.id} className={`${card} space-y-3`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-ink">{q.title}</h4>
                <p className="text-[11px] text-ink-muted">
                  {q.questionCount} question{q.questionCount === 1 ? "" : "s"} · {q.submissionCount} attempt{q.submissionCount === 1 ? "" : "s"} · pass at {q.passingPercent}% · {q.maxAttempts} attempt
                  {q.maxAttempts === 1 ? "" : "s"} allowed · {q.timeLimitMins ? `${q.timeLimitMins} min` : "untimed"}
                  {q.requireProctoring ? " · proctored" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className={ghost} onClick={() => toggle(q.id, "questions")} aria-expanded={open?.id === q.id && open.section === "questions"} aria-label={`Questions of ${q.title}`}>
                  Questions
                </button>
                <button className={ghost} onClick={() => toggle(q.id, "results")} aria-expanded={open?.id === q.id && open.section === "results"} aria-label={`Results of ${q.title}`}>
                  Results
                </button>
                {canEdit && (
                  <>
                    <button className={ghost} onClick={() => toggle(q.id, "settings")} aria-label={`Settings of ${q.title}`}>
                      Settings
                    </button>
                    <button className={ghost} onClick={() => toggle(q.id, "delete")} aria-label={`Delete ${q.title}`}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>

            {open?.id === q.id && open.section === "questions" && <QuizQuestions quizId={q.id} canEdit={canEdit} onChanged={list.reload} />}
            {open?.id === q.id && open.section === "results" && <QuizResults quizId={q.id} onChanged={list.reload} />}
            {open?.id === q.id && open.section === "settings" && <EditSettings quizId={q.id} busy={busy} onSave={(s) => update(q.id, s)} onCancel={() => setOpen(null)} />}
            {open?.id === q.id && open.section === "delete" && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5 text-xs">
                <span className="text-ink">Delete “{q.title}” and its {q.questionCount} question{q.questionCount === 1 ? "" : "s"}? A quiz that learners have already attempted cannot be deleted.</span>
                <button className={danger} disabled={busy} onClick={() => remove(q.id)}>
                  Delete quiz
                </button>
                <button className={ghost} onClick={() => setOpen(null)}>
                  Keep
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {canEdit &&
        (creating ? (
          <SettingsForm initial={defaults} saveLabel="Create quiz" busy={busy} onSave={create} onCancel={() => setCreating(false)} />
        ) : (
          <button className={primary} onClick={() => { clearError(); setCreating(true); }}>
            + New quiz
          </button>
        ))}
    </div>
  );
};
