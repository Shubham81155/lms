'use client';

import React, { useMemo, useState } from 'react';
import { Copy, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { Banner } from '@/components/admin/IdentityPanels';
import { RichText, useT } from '@/lib/i18n';

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
  const t = useT();
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
              {src ? t('builder.copy.title', { code: src.code }) : t('builder.copy.titleFallback')}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('builder.common.close')}
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
              <Banner kind="ok">{t('builder.copy.created', { code: result.course.code })}</Banner>
              <p className="text-ink-muted">
                {t('builder.copy.summary', {
                  modules: t.number(result.copied.modules),
                  lessons: t.number(result.copied.lessons),
                  quizzes: t.number(result.copied.quizzes),
                  questions: t.number(result.copied.questions),
                  assignments: t.number(result.copied.assignments),
                  categories: t.plural('builder.copy.categories', result.copied.gradeCategories),
                  bank: t.number(result.copied.questionBankItems),
                  files: result.copied.files ? t('builder.copy.filesPart', { n: t.number(result.copied.files) }) : '',
                })}{' '}
                {result.shiftDays ? t('builder.copy.shifted', { days: t.number(result.shiftDays) }) : t('builder.copy.unchanged')}
              </p>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold"
                >
                  {t('builder.copy.done')}
                </button>
              </div>
            </div>
          ) : !src ? (
            !source.error && <p className="text-xs text-ink-muted">{t('builder.common.loading')}</p>
          ) : (
            <>
              <p className="text-xs text-ink-muted [&_strong]:text-ink">
                <RichText text={t('builder.copy.intro')} />
              </p>
              <div className="grid grid-cols-3 gap-3">
                <label className="col-span-2 space-y-1.5">
                  <span className={label}>{t('builder.copy.newTitle')}</span>
                  <input className={field} value={titleValue} maxLength={255} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label className="space-y-1.5">
                  <span className={label}>{t('builder.copy.newCode')}</span>
                  <input className={`${field} font-mono`} value={codeValue} maxLength={50} onChange={(e) => setCode(e.target.value)} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className={label}>{t('builder.copy.term')}</span>
                  <select className={field} value={chosenTerm ?? ''} onChange={(e) => setTermId(e.target.value || null)}>
                    <option value="">{t('builder.copy.noTerm')}</option>
                    {list.map((term) => (
                      <option key={term.id} value={term.id}>
                        {term.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className={label}>{t('builder.copy.shiftLabel')}</span>
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
                    ? t('builder.copy.hintAuto', { days: t.number(autoShift) })
                    : t('builder.copy.hintNone')
                  : t('builder.copy.hintManual', { days: t.number(shiftNumber) })}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold"
                >
                  {t('builder.common.cancel')}
                </button>
                <button
                  className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold"
                  disabled={busy || invalid}
                >
                  {busy ? t('builder.copy.copying') : t('builder.copy.submit')}
                </button>
              </div>
            </>
          )}
        </div>
      </form>
    </div>
  );
};
