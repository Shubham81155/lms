'use client';

import React, { useState } from 'react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { rubricDraft } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { RubricInputs } from './RubricInputs';
import { ghostBtnClass, inputClass, primaryBtnClass, type Appeal } from './types';

const ResolveAppeal: React.FC<{ appeal: Appeal; onDone: () => void }> = ({ appeal, onDone }) => {
  const t = useT();
  const rubric = appeal.assignment.rubricJson;
  const { busy, error, run, clearError } = useAction();
  const [decision, setDecision] = useState<'UPHELD' | 'DENIED'>('DENIED');
  const [response, setResponse] = useState('');
  const [grade, setGrade] = useState('');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (rubric ?? []).map((c) => [
        c.id,
        appeal.submission.rubricScores?.[c.id] === undefined ? '' : String(appeal.submission.rubricScores[c.id]),
      ])
    )
  );
  const draft = rubric ? rubricDraft(rubric, values) : null;
  const gradeOk = grade.trim() !== '' && Number(grade) >= 0 && Number(grade) <= appeal.assignment.maxPoints;
  const ready = response.trim().length >= 3 && (decision === 'DENIED' || (rubric ? !draft!.problem : gradeOk));

  const submit = () =>
    run(async () => {
      await api.post(`/api/v1/appeals/${appeal.id}/resolve`, {
        decision,
        response: response.trim(),
        ...(decision === 'UPHELD'
          ? rubric
            ? { criteria: Object.fromEntries(rubric.map((c) => [c.id, Number(values[c.id])])) }
            : { grade: Number(grade) }
          : {}),
      });
      onDone();
    });

  return (
    <div className="space-y-3 border-t border-line pt-3" onChange={clearError}>
      {error && <Banner kind="error">{error}</Banner>}
      <fieldset className="flex gap-4 text-xs text-ink">
        <legend className="sr-only">{t('grading.as.decision')}</legend>
        {(['DENIED', 'UPHELD'] as const).map((d) => (
          <label key={d} className="flex items-center gap-1.5">
            <input type="radio" name={`d-${appeal.id}`} checked={decision === d} onChange={() => setDecision(d)} />
            {d === 'DENIED' ? t('grading.as.keepGrade') : t('grading.as.changeGrade')}
          </label>
        ))}
      </fieldset>
      {decision === 'UPHELD' &&
        (rubric ? (
          <RubricInputs criteria={rubric} values={values} onChange={setValues} />
        ) : (
          <label className="block space-y-1 text-xs text-ink-muted font-semibold">
            {t('grading.as.correctedGrade', { max: appeal.assignment.maxPoints })}
            <input
              className={`${inputClass} w-32 block`}
              type="number"
              min={0}
              max={appeal.assignment.maxPoints}
              step="0.5"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
            />
          </label>
        ))}
      <label className="block space-y-1 text-xs text-ink-muted font-semibold">
        {t('grading.as.explanation')}
        <textarea
          className={`${inputClass} w-full`}
          rows={2}
          maxLength={2000}
          value={response}
          onChange={(e) => setResponse(e.target.value)}
        />
      </label>
      <button className={primaryBtnClass} disabled={busy || !ready} onClick={submit}>
        {busy ? t('grading.as.saving') : t('grading.as.recordDecision')}
      </button>
    </div>
  );
};

export const AppealsTab: React.FC<{ courseId: string; canResolve: boolean }> = ({ courseId, canResolve }) => {
  const t = useT();
  const { data, isLoading, error, reload } = useApiData<{ data: Appeal[] }>(`/api/v1/courses/${courseId}/appeals`);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = data?.data ?? [];

  if (isLoading) return <div className="text-xs text-ink-subtle">{t('grading.loading')}</div>;
  if (error) return <Banner kind="error">{error}</Banner>;
  if (list.length === 0)
    return (
      <div className="text-xs text-ink-subtle p-10 text-center bg-canvas border border-line rounded-2xl">{t('grading.as.noAppeals')}</div>
    );

  return (
    <ul className="space-y-3">
      {list.map((a) => (
        <li key={a.id} className="bg-canvas border border-line rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div>
              <strong className="text-ink">{a.student}</strong>
              <span className="text-ink-subtle"> · {a.assignment.title}</span>
            </div>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${a.status === 'OPEN' ? 'bg-accent/10 text-accent border-accent/30' : a.status === 'UPHELD' ? 'bg-success/10 text-success border-success/30' : 'bg-raised text-ink border-line'}`}
            >
              {t.dyn(`grading.as.appeal.${a.status}`, a.status)}
            </span>
          </div>
          <p className="text-xs text-ink">"{a.reason}"</p>
          <div className="text-[11px] text-ink-subtle">
            {t('grading.as.currentGrade', { grade: a.submission.grade ?? '', max: a.assignment.maxPoints })}
          </div>
          {a.response && <div className="text-[11px] text-ink-muted">{t('grading.as.decisionText', { response: a.response })}</div>}
          {a.status === 'OPEN' &&
            canResolve &&
            (openId === a.id ? (
              <ResolveAppeal
                appeal={a}
                onDone={() => {
                  setOpenId(null);
                  reload();
                }}
              />
            ) : (
              <button className={ghostBtnClass} onClick={() => setOpenId(a.id)}>
                {t('grading.as.review')}
              </button>
            ))}
        </li>
      ))}
    </ul>
  );
};
