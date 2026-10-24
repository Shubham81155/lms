'use client';

import React from 'react';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useApiData } from '@/hooks/useApiData';
import { useT, type Translator } from '@/lib/i18n';

interface ReviewQuestion {
  id: string;
  questionText: string;
  questionType: string;
  options: { id: string | null; text: string }[];
  yourAnswer: unknown;
  awardedPoints: number;
  maxPoints: number;
  isCorrect: boolean | null;
  needsManualGrading: boolean;
  correctOptionIds?: (string | null)[];
  correctAnswer?: string | null;
  explanation?: string | null;
}

interface Review {
  reviewPolicy: 'SCORE_ONLY' | 'RESPONSES' | 'ANSWERS';
  answersRevealed: boolean;
  questions: ReviewQuestion[];
}

/** Text of an answer: option ids become their option text; lists are joined. */
function answerText(q: ReviewQuestion, answer: unknown, t: Translator): string {
  const list = Array.isArray(answer)
    ? answer.map(String)
    : answer === null || answer === undefined || answer === ''
      ? []
      : [String(answer)];
  if (list.length === 0) return t('learn.review.noAnswer');
  return list.map((a) => q.options.find((o) => o.id === a || o.text === a)?.text ?? a).join(', ');
}

/** One finished attempt, question by question, as the quiz's review policy allows (GET …/review). */
export const AttemptReview: React.FC<{ quizId: string; submissionId: string }> = ({ quizId, submissionId }) => {
  const t = useT();
  const { data, isLoading, error } = useApiData<{ data: Review }>(`/api/v1/quizzes/${quizId}/submissions/${submissionId}/review`);
  if (isLoading) return <p className="text-xs text-ink-subtle">{t('learn.review.loading')}</p>;
  if (error)
    return (
      <p role="alert" className="text-xs text-danger">
        {error}
      </p>
    );
  const review = data?.data;
  if (!review) return null;
  if (review.reviewPolicy === 'SCORE_ONLY') return <p className="text-xs text-ink-muted">{t('learn.review.scoreOnly')}</p>;

  return (
    <div className="space-y-3 text-left">
      {!review.answersRevealed && review.reviewPolicy === 'ANSWERS' && (
        <p className="text-[11px] text-ink-muted">{t('learn.review.answersLater')}</p>
      )}
      <ol className="space-y-3">
        {review.questions.map((q, i) => (
          <li key={q.id} className="rounded-xl border border-line bg-canvas p-3 space-y-1.5 text-xs">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold text-ink">
                {i + 1}. {q.questionText}
              </p>
              <span className="shrink-0 flex items-center gap-1 font-semibold">
                {q.needsManualGrading ? (
                  <>
                    <Clock className="h-3.5 w-3.5 text-accent" /> <span className="text-accent">{t('learn.review.toBeMarked')}</span>
                  </>
                ) : q.isCorrect ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />{' '}
                    <span className="text-success">
                      {q.awardedPoints} / {q.maxPoints}
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5 text-danger" />{' '}
                    <span className="text-danger">
                      {q.awardedPoints} / {q.maxPoints}
                    </span>
                  </>
                )}
              </span>
            </div>
            <p className="text-ink-muted">
              {t('learn.review.yourAnswer')} <span className="text-ink whitespace-pre-wrap">{answerText(q, q.yourAnswer, t)}</span>
            </p>
            {review.answersRevealed && !q.isCorrect && (q.correctOptionIds?.length || q.correctAnswer) && (
              <p className="text-ink-muted">
                {t('learn.review.correctAnswer')}{' '}
                <span className="text-success">{q.correctOptionIds?.length ? answerText(q, q.correctOptionIds, t) : q.correctAnswer}</span>
              </p>
            )}
            {review.answersRevealed && q.explanation && <p className="text-ink-muted italic">{q.explanation}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
};
