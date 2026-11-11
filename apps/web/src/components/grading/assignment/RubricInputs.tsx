'use client';

import React from 'react';
import { round2, rubricDraft, rubricProblemMsg, type Criterion } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { inputClass } from './types';

/** One number input per criterion, with a live total. */
export const RubricInputs: React.FC<{
  criteria: Criterion[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  disabled?: boolean;
}> = ({ criteria, values, onChange, disabled }) => {
  const t = useT();
  const { total, problem } = rubricDraft(criteria, values);
  const problemMsg = rubricProblemMsg(criteria, values);
  const max = round2(criteria.reduce((s, c) => s + c.maxPoints, 0));
  return (
    <div className="space-y-2">
      {criteria.map((c) => (
        <div key={c.id} className="flex items-start justify-between gap-3 bg-canvas border border-line rounded-xl px-3 py-2">
          <div className="text-xs">
            <div className="font-semibold text-ink">{c.name}</div>
            {c.description && <div className="text-[11px] text-ink-subtle">{c.description}</div>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <input
              className={`${inputClass} w-20`}
              type="number"
              min={0}
              max={c.maxPoints}
              step="0.5"
              aria-label={t('grading.as.criterionScore', { name: c.name })}
              disabled={disabled}
              value={values[c.id] ?? ''}
              onChange={(e) => onChange({ ...values, [c.id]: e.target.value })}
            />
            <span className="text-[11px] text-ink-subtle">/ {c.maxPoints}</span>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold text-ink">{t('grading.as.total', { total, max })}</span>
        {problem && <span className="text-accent">{problemMsg ? t.dyn(problemMsg.key, problem, problemMsg.vars) : problem}</span>}
      </div>
    </div>
  );
};
