'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { SubmissionHistory } from '@/components/SubmissionHistory';
import { rubricDraft } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { RubricInputs } from './RubricInputs';
import { DAY_TIME, inputClass, primaryBtnClass, type Assignment, type Submission } from './types';

export const GradePanel: React.FC<{ assignment: Assignment; sub: Submission; canGrade: boolean; onSaved: () => void }> = ({
  assignment,
  sub,
  canGrade,
  onSaved,
}) => {
  const rubric = assignment.rubricJson;
  const t = useT();
  const { busy, error, run, clearError } = useAction();
  const [grade, setGrade] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const [note, setNote] = useState<'saved' | 'reopened' | null>(null);

  useEffect(() => {
    setGrade(sub.grade === null ? '' : String(sub.grade));
    setValues(
      Object.fromEntries(
        (rubric ?? []).map((c) => [c.id, sub.rubricScoresJson?.[c.id] === undefined ? '' : String(sub.rubricScoresJson[c.id])])
      )
    );
    setFeedback(sub.feedback ?? '');
    setNote(null);
    clearError();
  }, [sub.id, sub.gradedAt, sub.grade, sub.feedback, sub.rubricScoresJson, rubric, clearError]);

  const draft = rubric ? rubricDraft(rubric, values) : null;
  const plainOk = grade.trim() !== '' && Number(grade) >= 0 && Number(grade) <= assignment.maxPoints;
  const ok = rubric ? !draft!.problem : plainOk;

  const save = () =>
    run(async () => {
      const body = rubric
        ? { criteria: Object.fromEntries(rubric.map((c) => [c.id, Number(values[c.id])])), feedback: feedback.trim() || undefined }
        : { grade: Number(grade), feedback: feedback.trim() || undefined };
      const r = await api.patch<{ courseGradeReopened?: boolean }>(
        `/api/v1/assignments/${assignment.id}/submissions/${sub.id}/grade`,
        body
      );
      setNote(r.courseGradeReopened ? 'reopened' : 'saved');
      onSaved();
    });

  return (
    <div className="space-y-4">
      <div className="bg-canvas border border-line rounded-2xl p-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <strong className="text-ink">{sub.user ? `${sub.user.firstName} ${sub.user.lastName}` : t('grading.as.learner')}</strong>
          <span className="text-ink-subtle">{t('grading.as.submittedOn', { date: t.date(sub.submittedAt, DAY_TIME) })}</span>
        </div>
        {sub.submissionText && <p className="text-xs text-ink whitespace-pre-wrap max-h-48 overflow-y-auto">{sub.submissionText}</p>}
        {sub.fileUrl && (
          <a className="text-xs text-brand-fg underline break-all" href={sub.fileUrl} target="_blank" rel="noopener noreferrer">
            {sub.fileUrl}
          </a>
        )}
        <SubmissionHistory key={sub.submittedAt} assignmentId={assignment.id} submissionId={sub.id} />
        {sub.plagiarismScore !== null && (
          <div className={`text-[11px] ${sub.plagiarismScore >= 30 ? 'text-danger' : 'text-success'}`}>
            {t('grading.as.similarity', { percent: t.number(Math.round(sub.plagiarismScore)) })}{' '}
            {sub.plagiarismReportUrl && (
              <a className="underline" href={sub.plagiarismReportUrl} target="_blank" rel="noopener noreferrer">
                {t('grading.as.report')}
              </a>
            )}
          </div>
        )}
        {sub.plagiarismScore === null && sub.plagiarismStatus && sub.plagiarismStatus !== 'COMPLETE' && (
          <div className={`text-[11px] ${sub.plagiarismStatus === 'FAILED' ? 'text-accent' : 'text-ink-subtle'}`}>
            {t(`grading.as.sim.${sub.plagiarismStatus}`)}
          </div>
        )}
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {note && <Banner kind="ok">{note === 'reopened' ? t('grading.as.savedReopened') : t('grading.as.saved')}</Banner>}

      {rubric ? (
        <RubricInputs
          criteria={rubric}
          values={values}
          onChange={(v) => {
            clearError();
            setValues(v);
          }}
          disabled={!canGrade}
        />
      ) : (
        <label className="block space-y-1 text-xs text-ink-muted font-semibold">
          {t('grading.as.gradeOutOf', { max: assignment.maxPoints })}
          <input
            className={`${inputClass} w-32 block`}
            type="number"
            min={0}
            max={assignment.maxPoints}
            step="0.5"
            disabled={!canGrade}
            value={grade}
            onChange={(e) => {
              clearError();
              setGrade(e.target.value);
            }}
          />
        </label>
      )}
      <label className="block space-y-1 text-xs text-ink-muted font-semibold">
        {t('grading.as.feedback')}
        <textarea
          className={`${inputClass} w-full`}
          rows={3}
          maxLength={10000}
          disabled={!canGrade}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
      </label>
      {canGrade && (
        <button className={primaryBtnClass} disabled={busy || !ok} onClick={save}>
          {busy ? t('grading.as.saving') : sub.gradedAt ? t('grading.as.updateGrade') : t('grading.as.saveGrade')}
        </button>
      )}
    </div>
  );
};
