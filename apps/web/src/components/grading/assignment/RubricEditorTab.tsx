'use client';

import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { round2 } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { ghostBtnClass, inputClass, primaryBtnClass, type Assignment, type Submission } from './types';

export const RubricEditorTab: React.FC<{ assignment: Assignment; canEdit: boolean; onSaved: () => void }> = ({
  assignment,
  canEdit,
  onSaved,
}) => {
  const t = useT();
  const graded = useApiData<{ data: Submission[] }>(`/api/v1/assignments/${assignment.id}/submissions`, { limit: 100 });
  const { busy, error, run, clearError } = useAction();
  const [rows, setRows] = useState<{ name: string; description: string; maxPoints: string }[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRows((assignment.rubricJson ?? []).map((c) => ({ name: c.name, description: c.description ?? '', maxPoints: String(c.maxPoints) })));
  }, [assignment.id, assignment.rubricJson]);

  const locked = (graded.data?.data ?? []).some((s) => s.gradedAt);
  const total = round2(rows.reduce((s, r) => s + (Number(r.maxPoints) || 0), 0));
  const valid = rows.length > 0 && rows.every((r) => r.name.trim() && Number(r.maxPoints) > 0);
  const edit = canEdit && !locked;

  const save = (criteria: unknown) =>
    run(async () => {
      await api.put(`/api/v1/assignments/${assignment.id}/rubric`, { criteria });
      setSaved(true);
      onSaved();
    });

  return (
    <div
      className="space-y-4 max-w-2xl"
      onChange={() => {
        clearError();
        setSaved(false);
      }}
    >
      {locked && <Banner kind="error">{t('grading.as.locked')}</Banner>}
      {!canEdit && <Banner kind="error">{t('grading.as.onlyInstructor')}</Banner>}
      {error && <Banner kind="error">{error}</Banner>}
      {saved && <Banner kind="ok">{t('grading.as.rubricSaved')}</Banner>}
      <p className="text-xs text-ink-muted">{t('grading.as.rubricWorth', { total })}</p>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-start">
          <input
            className={`${inputClass} col-span-4`}
            aria-label={t('grading.as.critName', { n: i + 1 })}
            placeholder={t('grading.as.critPlaceholder')}
            disabled={!edit}
            value={r.name}
            onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
          />
          <input
            className={`${inputClass} col-span-5`}
            aria-label={t('grading.as.critDescription', { n: i + 1 })}
            placeholder={t('grading.as.critDescPlaceholder')}
            disabled={!edit}
            value={r.description}
            onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
          />
          <input
            className={`${inputClass} col-span-2`}
            type="number"
            min={0.5}
            step="0.5"
            aria-label={t('grading.as.critPoints', { n: i + 1 })}
            disabled={!edit}
            value={r.maxPoints}
            onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, maxPoints: e.target.value } : x)))}
          />
          <button
            className={`${ghostBtnClass} col-span-1`}
            disabled={!edit}
            aria-label={t('grading.as.critRemove', { n: i + 1 })}
            onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          className={ghostBtnClass}
          disabled={!edit}
          onClick={() => setRows((p) => [...p, { name: '', description: '', maxPoints: '' }])}
        >
          <Plus className="h-3 w-3 inline mr-1" />
          {t('grading.as.addCriterion')}
        </button>
        <button
          className={primaryBtnClass}
          disabled={!edit || busy || !valid}
          onClick={() =>
            save(
              rows.map((r) => ({
                name: r.name.trim(),
                ...(r.description.trim() ? { description: r.description.trim() } : {}),
                maxPoints: Number(r.maxPoints),
              }))
            )
          }
        >
          {t('grading.as.saveRubric')}
        </button>
        {assignment.rubricJson && (
          <button
            className={ghostBtnClass}
            disabled={!edit || busy}
            onClick={() => window.confirm(t('grading.as.removeRubricConfirm')) && save(null)}
          >
            {t('grading.as.removeRubric')}
          </button>
        )}
      </div>
    </div>
  );
};
