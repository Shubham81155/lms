'use client';

import React, { useState } from 'react';
import { useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { useT } from '@/lib/i18n';
import { GradePanel } from './GradePanel';
import { DAY, type Assignment, type Submission } from './types';

export const SubmissionsTab: React.FC<{ assignment: Assignment; canGrade: boolean }> = ({ assignment, canGrade }) => {
  const t = useT();
  const { data, isLoading, error, reload } = useApiData<{ data: Submission[] }>(`/api/v1/assignments/${assignment.id}/submissions`, {
    limit: 100,
  });
  const [active, setActive] = useState<string | null>(null);
  const list = data?.data ?? [];
  const current = list.find((s) => s.id === active) ?? list.find((s) => !s.gradedAt) ?? list[0];

  if (isLoading) return <div className="text-xs text-ink-subtle">{t('grading.loading')}</div>;
  if (error) return <Banner kind="error">{error}</Banner>;
  if (list.length === 0)
    return (
      <div className="text-xs text-ink-subtle p-10 text-center bg-canvas border border-line rounded-2xl">{t('grading.as.nobody')}</div>
    );

  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
      <ul className="md:col-span-2 space-y-2 max-h-[55vh] overflow-y-auto">
        {list.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => setActive(s.id)}
              className={`w-full text-left p-3 rounded-xl border text-xs ${current?.id === s.id ? 'bg-brand/15 border-brand/60' : 'bg-canvas border-line hover:border-line'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">{s.user ? `${s.user.firstName} ${s.user.lastName}` : s.userId}</span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${s.gradedAt ? 'bg-success/10 text-success border-success/30' : 'bg-accent/10 text-accent border-accent/30'}`}
                >
                  {s.gradedAt ? `${s.grade} / ${assignment.maxPoints}` : t('grading.as.toGrade')}
                </span>
              </div>
              <div className="text-[10px] text-ink-subtle mt-1">{t.date(s.submittedAt, DAY)}</div>
            </button>
          </li>
        ))}
      </ul>
      <div className="md:col-span-3">
        {current && <GradePanel assignment={assignment} sub={current} canGrade={canGrade} onSaved={reload} />}
      </div>
    </div>
  );
};
