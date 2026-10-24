'use client';

import React, { useMemo, useState } from 'react';
import { Copy, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { Banner } from '@/components/admin/IdentityPanels';

interface Term {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
}
interface Source {
  id: string;
  code: string;
  title: string;
  termId: string | null;
}
interface CopyResult {
  course: { id: string; code: string; title: string };
  shiftDays: number;
  copied: {
    modules: number;
    lessons: number;
    quizzes: number;
    questions: number;
    assignments: number;
    gradeCategories: number;
    questionBankItems: number;
    files: number;
  };
}

const field =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const label = 'text-xs font-semibold text-ink-muted';
const DAY = 86_400_000;

/** Copy a course's material into a new draft course, for running it again (POST /courses/:id/copy). */
export const CourseCopy: React.FC<{ courseId: string; onClose: () => void; onCopied?: () => void }> = ({ courseId, onClose, onCopied }) => {
  useEscapeKey(onClose);
  const source = useApiData<{ data: Source }>(`/api/v1/courses/${courseId}`);
  const terms = useApiData<{ data: Term[] }>('/api/v1/terms');
  const { busy, error, run } = useAction();
  const [code, setCode] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [termId, setTermId] = useState<string | null | undefined>(undefined);
  const [shift, setShift] = useState('');
  const [result, setResult] = useState<CopyResult | null>(null);

  const src = source.data?.data;
  const list = terms.data?.data ?? [];
  const chosenTerm = termId === undefined ? (src?.termId ?? null) : termId;
  const codeValue = code ?? (src ? `${src.code}-COPY` : '');
  const titleValue = title ?? src?.title ?? '';

  /** What the API will use when no shift is typed: the gap between the two terms' starts. */
  const autoShift = useMemo(() => {
    const from = list.find((t) => t.id === src?.termId);
    const to = list.find((t) => t.id === chosenTerm);
    return from && to ? Math.round((Date.parse(to.startsOn) - Date.parse(from.startsOn)) / DAY) : 0;
  }, [list, src?.termId, chosenTerm]);

  const shiftNumber = shift.trim() === '' ? null : Number(shift);
  const invalid =
    codeValue.trim().length < 2 ||
    titleValue.trim().length < 3 ||
    (shiftNumber !== null && (!Number.isInteger(shiftNumber) || Math.abs(shiftNumber) > 1000));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post<{ data: CopyResult }>(`/api/v1/courses/${courseId}/copy`, {
        code: codeValue.trim(),
        title: titleValue.trim(),
        termId: chosenTerm,
        ...(shiftNumber !== null ? { shiftDays: shiftNumber } : {}),
      });
      setResult(r.data);
      onCopied?.();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="course-copy-h"
    >
      <form
        onSubmit={submit}
        className="bg-surface border border-line rounded-3xl w-full max-w-lg flex flex-col overflow-hidden shadow-2xl"
      >
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Copy className="h-5 w-5 text-brand-fg" />
            <h3 id="course-copy-h" className="font-bold text-sm text-ink">
              Copy {src ? src.code : 'course'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-xl hover:bg-raised text-ink-muted hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {source.error && <Banner kind="error">{source.error}</Banner>}
          {error && <Banner kind="error">{error}</Banner>}
          {result ? (
            <div className="space-y-3 text-xs text-ink">
              <Banner kind="ok">Created {result.course.code} as a draft. Check it, then publish it from Settings.</Banner>
              <p className="text-ink-muted">
                Copied {result.copied.modules} module(s) with {result.copied.lessons} lesson(s), {result.copied.quizzes} quiz(zes) with{' '}
                {result.copied.questions} question(s), {result.copied.assignments} assignment(s), {result.copied.gradeCategories} grade
                categor{result.copied.gradeCategories === 1 ? 'y' : 'ies'}, {result.copied.questionBankItems} question-bank item(s)
                {result.copied.files ? ` and ${result.copied.files} uploaded file(s)` : ''}.{' '}
                {result.shiftDays ? `Due dates moved by ${result.shiftDays} day(s).` : 'Due dates are unchanged.'}
              </p>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold"
                >
                  Done
                </button>
              </div>
            </div>
          ) : !src ? (
            !source.error && <p className="text-xs text-ink-muted">Loading…</p>
          ) : (
            <>
              <p className="text-xs text-ink-muted">
                Makes a new <strong className="text-ink">draft</strong> course with this course’s lessons, quizzes, assignments, rubrics,
                grade setup and question bank. Learners, submissions and grades stay with the original.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <label className="col-span-2 space-y-1.5">
                  <span className={label}>New title</span>
                  <input className={field} value={titleValue} maxLength={255} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label className="space-y-1.5">
                  <span className={label}>New code</span>
                  <input className={`${field} font-mono`} value={codeValue} maxLength={50} onChange={(e) => setCode(e.target.value)} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className={label}>Term</span>
                  <select className={field} value={chosenTerm ?? ''} onChange={(e) => setTermId(e.target.value || null)}>
                    <option value="">No term</option>
                    {list.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className={label}>Move due dates by (days)</span>
                  <input
                    className={field}
                    type="number"
                    min={-1000}
                    max={1000}
                    step={1}
                    placeholder={String(autoShift)}
                    value={shift}
                    onChange={(e) => setShift(e.target.value)}
                  />
                </label>
              </div>
              <p className="text-[11px] text-ink-subtle">
                {shiftNumber === null
                  ? autoShift
                    ? `Left empty, quiz windows and due dates move ${autoShift} day(s): the gap between the two terms’ start dates.`
                    : 'Left empty, quiz windows and due dates stay as they are.'
                  : `Quiz windows and due dates move ${shiftNumber} day(s).`}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold"
                >
                  Cancel
                </button>
                <button
                  className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold"
                  disabled={busy || invalid}
                >
                  {busy ? 'Copying…' : 'Copy course'}
                </button>
              </div>
            </>
          )}
        </div>
      </form>
    </div>
  );
};
