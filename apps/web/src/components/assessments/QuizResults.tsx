'use client';

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { useLocale } from '@/lib/i18n';
import { card, ghost, input, label, primary } from './ui';

interface Question {
  id: string;
  questionText: string;
  questionType: string;
  points: number;
}

interface Submission {
  id: string;
  attemptNumber: number;
  score: number | null;
  maxScore: number;
  passed: boolean | null;
  startedAt: string;
  submittedAt: string | null;
  user?: { id: string; firstName: string; lastName: string; email: string };
  answersJson?: {
    submittedAnswers?: Record<string, string | string[] | null>;
    grading?: Record<string, { awardedPoints: number; needsManualGrading?: boolean }>;
    pendingManual?: string[];
  } | null;
}

interface ProctoringRow {
  submissionId: string;
  high: number;
  score: number;
  flagged: boolean;
  events: { id: string; eventType: string; severity: string; timestamp: string }[];
}

const MANUAL = ['ESSAY', 'CODE_SANDBOX'];
const answerText = (a: string | string[] | null | undefined) => (Array.isArray(a) ? a.join(', ') : (a ?? ''));

const SubmissionRow: React.FC<{
  quizId: string;
  sub: Submission;
  questions: Question[];
  proctoring?: ProctoringRow;
  onGraded: () => void;
}> = ({ quizId, sub, questions, proctoring, onGraded }) => {
  const { t, locale } = useLocale();
  // The browser's own time zone and format, as before; only the language follows the interface.
  const tag = locale === 'hi' ? 'hi-IN-u-nu-latn' : undefined;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(tag) : t('learn.results.notSubmitted'));
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  const manual = questions.filter((q) => MANUAL.includes(q.questionType));
  const pending = sub.answersJson?.pendingManual ?? [];
  const grading = sub.answersJson?.grading ?? {};
  const [points, setPoints] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      manual.map((q) => [q.id, grading[q.id] && !grading[q.id].needsManualGrading ? String(grading[q.id].awardedPoints) : ''])
    )
  );
  const name = sub.user ? `${sub.user.firstName} ${sub.user.lastName}` : t('learn.results.learner');
  const pct = sub.score !== null && sub.maxScore > 0 ? Math.round((sub.score / sub.maxScore) * 100) : null;

  const invalid = manual.some(
    (q) => points[q.id] !== '' && (Number(points[q.id]) < 0 || Number(points[q.id]) > q.points || !Number.isFinite(Number(points[q.id])))
  );
  const entered = manual.filter((q) => points[q.id] !== '');

  const save = () =>
    run(async () => {
      await api.patch(`/api/v1/quizzes/${quizId}/submissions/${sub.id}/grade`, {
        grades: Object.fromEntries(entered.map((q) => [q.id, Number(points[q.id])])),
      });
      onGraded();
    });

  return (
    <li className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm text-ink">{name}</strong>
            <span className="text-xs text-ink-muted">{t('learn.results.attempt', { n: sub.attemptNumber })}</span>
            {!sub.submittedAt && (
              <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-bold text-ink-muted">
                {t('learn.results.inProgress')}
              </span>
            )}
            {sub.submittedAt && pending.length > 0 && (
              <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
                {t('learn.results.needsGrading')}
              </span>
            )}
            {sub.submittedAt && pending.length === 0 && sub.passed !== null && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${sub.passed ? 'border-success/40 bg-success/10 text-success' : 'border-danger/40 bg-danger/10 text-danger'}`}
              >
                {sub.passed ? t('learn.results.passed') : t('learn.results.notPassed')}
              </span>
            )}
            {proctoring?.flagged && (
              <span className="flex items-center gap-1 rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">
                <AlertTriangle className="h-3 w-3" />
                {t('learn.results.flags')}
              </span>
            )}
          </div>
          <p className="text-[11px] text-ink-muted">
            {sub.user?.email} · {when(sub.submittedAt)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {sub.submittedAt && (
            <span className="text-xs font-bold text-ink">
              {sub.score ?? 0} / {sub.maxScore}
              {pct !== null && <span className="ml-1 font-normal text-ink-muted">({pct}%)</span>}
            </span>
          )}
          {sub.submittedAt && (manual.length > 0 || proctoring) && (
            <button
              className={ghost}
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={t(open ? 'learn.results.detailsHide' : 'learn.results.detailsOpen', { name, n: sub.attemptNumber })}
            >
              {open ? t('learn.results.hide') : pending.length > 0 ? t('learn.results.grade') : t('learn.results.details')}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          {error && <Banner kind="error">{error}</Banner>}

          {manual.map((q) => (
            <div key={q.id} className="space-y-1.5">
              <p className="whitespace-pre-wrap text-xs font-semibold text-ink">{q.questionText}</p>
              <p className="whitespace-pre-wrap rounded-xl border border-line bg-surface p-3 font-mono text-[11px] text-ink">
                {answerText(sub.answersJson?.submittedAnswers?.[q.id]) || (
                  <span className="font-sans italic text-ink-subtle">{t('learn.results.noAnswerGiven')}</span>
                )}
              </p>
              <label className="flex items-center gap-2 text-[11px] text-ink-muted">
                {t('learn.results.points', { max: q.points })}
                <input
                  type="number"
                  min={0}
                  max={q.points}
                  step="0.5"
                  className={`${input} w-24`}
                  aria-label={t('learn.results.pointsFor', { name, type: label(q.questionType) })}
                  value={points[q.id] ?? ''}
                  onChange={(e) => setPoints((p) => ({ ...p, [q.id]: e.target.value }))}
                />
              </label>
            </div>
          ))}
          {manual.length > 0 && (
            <button className={primary} disabled={busy || invalid || entered.length === 0} onClick={save}>
              {busy ? t('learn.results.saving') : t('learn.results.save')}
            </button>
          )}

          {proctoring && (
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-ink">
                {t('learn.results.events', { count: proctoring.events.length, high: proctoring.high })}
              </p>
              <ul className="space-y-1 text-[11px] text-ink-muted">
                {proctoring.events.map((e) => (
                  <li key={e.id}>
                    <span className="font-semibold text-ink">{label(e.eventType)}</span> ·{' '}
                    {t.dyn(`learn.results.severity.${e.severity}`, e.severity.toLowerCase())} ·{' '}
                    {new Date(e.timestamp).toLocaleTimeString(tag)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
};

/** Everyone's attempts at one quiz, with grading for essay and code questions and the integrity record. */
export const QuizResults: React.FC<{ quizId: string; onChanged: () => void }> = ({ quizId, onChanged }) => {
  const { t } = useLocale();
  const subs = useApiData<{ data: Submission[]; pagination: { total: number } }>(`/api/v1/quizzes/${quizId}/submissions`, { limit: 100 });
  const quiz = useApiData<{ data: { questions: Question[] } }>(`/api/v1/quizzes/${quizId}`);
  const proctoring = useApiData<{ data: ProctoringRow[] }>(`/api/v1/quizzes/${quizId}/proctoring`);
  const rows = subs.data?.data ?? [];
  const byId = new Map((proctoring.data?.data ?? []).map((p) => [p.submissionId, p]));

  if ((subs.isLoading && !subs.data) || (quiz.isLoading && !quiz.data))
    return <p className="text-xs text-ink-subtle">{t('learn.results.loading')}</p>;
  if (subs.error || quiz.error) return <Banner kind="error">{subs.error || quiz.error}</Banner>;
  if (rows.length === 0) return <p className={`${card} text-center text-xs text-ink-muted`}>{t('learn.results.none')}</p>;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-ink-subtle">
        {t('learn.results.count', { shown: rows.length, total: subs.data?.pagination.total ?? rows.length })}
      </p>
      <ul className="space-y-2">
        {rows.map((s) => (
          <SubmissionRow
            key={`${s.id}:${s.score}`}
            quizId={quizId}
            sub={s}
            questions={quiz.data?.data.questions ?? []}
            proctoring={byId.get(s.id)}
            onGraded={async () => {
              await subs.reload();
              onChanged();
            }}
          />
        ))}
      </ul>
    </div>
  );
};
