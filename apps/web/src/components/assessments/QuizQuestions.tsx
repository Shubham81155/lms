"use client";

import React, { useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAction, useApiData } from "@/hooks/useApiData";
import { Banner } from "@/components/admin/IdentityPanels";
import { draftProblem, type ChoiceOption } from "@/lib/forms";
import { QuestionFields, blankQuestion, questionBody, type QuestionDraft } from "./QuestionFields";
import { card, ghost, label, primary } from "./ui";

interface ApiQuestion {
  id: string;
  questionText: string;
  questionType: string;
  points: number;
  optionsJson: ChoiceOption[] | null;
  correctAnswer: string | null;
  bloomLevel: string | null;
}

const toDraft = (q: ApiQuestion): QuestionDraft => ({
  type: q.questionType,
  text: q.questionText,
  points: String(q.points),
  options: q.optionsJson ?? [],
  answer: q.correctAnswer ?? "",
  bloom: q.bloomLevel ?? "",
});

interface FormProps {
  initial: QuestionDraft;
  saveLabel: string;
  busy: boolean;
  onSave: (d: QuestionDraft) => void;
  onCancel: () => void;
}

const QuestionForm: React.FC<FormProps> = ({ initial, saveLabel, busy, onSave, onCancel }) => {
  const [d, setD] = useState(initial);
  const problem = draftProblem(d);
  return (
    <form
      className="space-y-4 rounded-2xl border border-brand/40 bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(d);
      }}
    >
      <QuestionFields d={d} set={(p) => setD((x) => ({ ...x, ...p }))} />
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

/** The questions of one quiz: add, edit and delete. Staff see the answer keys here. */
export const QuizQuestions: React.FC<{ quizId: string; canEdit: boolean; onChanged: () => void }> = ({ quizId, canEdit, onChanged }) => {
  const quiz = useApiData<{ data: { questions: ApiQuestion[] } }>(`/api/v1/quizzes/${quizId}`);
  const { busy, error, run, clearError } = useAction();
  const [editing, setEditing] = useState<ApiQuestion | "new" | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const questions = quiz.data?.data.questions ?? [];

  const save = (d: QuestionDraft) =>
    run(async () => {
      if (editing && editing !== "new") await api.patch(`/api/v1/quizzes/${quizId}/questions/${editing.id}`, questionBody(d));
      else await api.post(`/api/v1/quizzes/${quizId}/questions`, questionBody(d));
      setEditing(null);
      await quiz.reload();
      onChanged();
    });

  const remove = (id: string) =>
    run(async () => {
      await api.delete(`/api/v1/quizzes/${quizId}/questions/${id}`);
      setDeleting(null);
      await quiz.reload();
      onChanged();
    });

  return (
    <div className="space-y-3">
      {(error || quiz.error) && <Banner kind="error">{error || quiz.error}</Banner>}
      {quiz.isLoading && !quiz.data && <p className="text-xs text-ink-subtle">Loading questions…</p>}

      {!quiz.isLoading && questions.length === 0 && editing !== "new" && (
        <p className={`${card} text-center text-xs text-ink-muted`}>No questions yet. {canEdit ? "Add one below, or copy several from the question bank." : ""}</p>
      )}

      <ol className="space-y-2">
        {questions.map((q, i) =>
          editing !== "new" && editing?.id === q.id ? (
            <li key={q.id}>
              <QuestionForm initial={toDraft(q)} saveLabel="Save question" busy={busy} onSave={save} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={q.id} className={`${card} flex items-start gap-3`}>
              <span className="text-xs font-bold text-ink-muted">{i + 1}.</span>
              <div className="min-w-0 flex-1">
                <div className="whitespace-pre-wrap text-xs text-ink">{q.questionText}</div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-ink">{label(q.questionType)}</span>
                  <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-ink">{q.points} pt</span>
                  {q.bloomLevel && <span className="rounded-full border border-orchid/30 bg-orchid/15 px-2 py-0.5 text-orchid">{label(q.bloomLevel)}</span>}
                </div>
              </div>
              {canEdit &&
                (deleting === q.id ? (
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-danger">Delete this question?</span>
                    <button className={ghost} disabled={busy} onClick={() => remove(q.id)}>
                      Delete
                    </button>
                    <button className={ghost} onClick={() => setDeleting(null)}>
                      Keep
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button className={ghost} onClick={() => { clearError(); setEditing(q); }} aria-label={`Edit question ${i + 1}`}>
                      Edit
                    </button>
                    <button className={ghost} onClick={() => setDeleting(q.id)} aria-label={`Delete question ${i + 1}`}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
            </li>
          )
        )}
      </ol>

      {canEdit &&
        (editing === "new" ? (
          <QuestionForm initial={blankQuestion()} saveLabel="Add question" busy={busy} onSave={save} onCancel={() => setEditing(null)} />
        ) : (
          <button className={ghost} onClick={() => { clearError(); setEditing("new"); }}>
            + Add question
          </button>
        ))}
    </div>
  );
};
