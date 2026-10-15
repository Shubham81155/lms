"use client";

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { CHOICE_TYPES, KEYED_TYPES } from "@/lib/forms";
import { optionsFor, type QuestionDraft } from "@/lib/questionDraft";
import { ghost, input, label } from "./ui";

export const QUESTION_TYPES = ["MULTIPLE_CHOICE", "MULTI_SELECT", "TRUE_FALSE", "SHORT_ANSWER", "FORMULA_CALCULATED", "ESSAY", "CODE_SANDBOX"] as const;
export const BLOOM_LEVELS = ["REMEMBER", "UNDERSTAND", "APPLY", "ANALYZE", "EVALUATE", "CREATE"] as const;

export { blankQuestion, optionsFor, questionBody, type QuestionDraft } from "@/lib/questionDraft";

interface Props<T extends QuestionDraft> {
  d: T;
  set: (patch: Partial<T>) => void;
}

/** Type, points, Bloom level, question text, options and answer key. */
export function QuestionFields<T extends QuestionDraft>({ d, set }: Props<T>) {
  const patch = (p: Partial<QuestionDraft>) => set(p as Partial<T>);
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          Type
          <select className={`${input} w-full`} value={d.type} onChange={(e) => patch({ type: e.target.value, options: optionsFor(e.target.value) })}>
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          Points
          <input className={`${input} w-full`} type="number" min={0.5} max={1000} step="0.5" value={d.points} onChange={(e) => patch({ points: e.target.value })} />
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          Bloom level
          <select className={`${input} w-full`} value={d.bloom} onChange={(e) => patch({ bloom: e.target.value })}>
            <option value="">Not tagged</option>
            {BLOOM_LEVELS.map((b) => (
              <option key={b} value={b}>
                {label(b)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1 text-xs text-ink-muted font-semibold">
        Question
        <textarea className={`${input} w-full`} rows={3} maxLength={10000} value={d.text} onChange={(e) => patch({ text: e.target.value })} />
      </label>

      {CHOICE_TYPES.includes(d.type) && (
        <fieldset className="space-y-2">
          <legend className="text-xs text-ink-muted font-semibold mb-1">Options ({d.type === "MULTI_SELECT" ? "tick every correct one" : "choose the correct one"})</legend>
          {d.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type={d.type === "MULTI_SELECT" ? "checkbox" : "radio"}
                name="correct"
                aria-label={`Option ${i + 1} is correct`}
                checked={o.isCorrect}
                onChange={(e) =>
                  patch({ options: d.options.map((x, j) => (d.type === "MULTI_SELECT" ? (j === i ? { ...x, isCorrect: e.target.checked } : x) : { ...x, isCorrect: j === i })) })
                }
              />
              <input
                className={`${input} flex-1`}
                aria-label={`Option ${i + 1} text`}
                maxLength={2000}
                value={o.text}
                disabled={d.type === "TRUE_FALSE"}
                onChange={(e) => patch({ options: d.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })}
              />
              {d.type !== "TRUE_FALSE" && d.options.length > 2 && (
                <button type="button" className={ghost} aria-label={`Remove option ${i + 1}`} onClick={() => patch({ options: d.options.filter((_, j) => j !== i) })}>
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {d.type !== "TRUE_FALSE" && d.options.length < 10 && (
            <button type="button" className={ghost} onClick={() => patch({ options: [...d.options, { text: "", isCorrect: false }] })}>
              <Plus className="h-3 w-3 inline mr-1" />
              Add option
            </button>
          )}
        </fieldset>
      )}
      {KEYED_TYPES.includes(d.type) && (
        <label className="block space-y-1 text-xs text-ink-muted font-semibold">
          Correct answer {d.type === "SHORT_ANSWER" && "(separate accepted alternatives with ||)"}
          <input className={`${input} w-full`} maxLength={5000} value={d.answer} onChange={(e) => patch({ answer: e.target.value })} />
        </label>
      )}
      {(d.type === "ESSAY" || d.type === "CODE_SANDBOX") && <p className="text-[11px] text-ink-subtle">This type is graded by a person, so there is no answer key.</p>}
    </>
  );
}
