'use client';

import React from 'react';
import { Download } from 'lucide-react';
import { downloadFile, useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { useT } from '@/lib/i18n';
import { ghostBtnClass, type GridData, type Score } from './types';

const ScoreCell: React.FC<{ score?: Score }> = ({ score }) => {
  const t = useT();
  return !score ? (
    <span className="text-ink-subtle">–</span>
  ) : score.pending ? (
    <span className="text-accent font-semibold" title={t('grading.gb.waitingGrader')}>
      {t('grading.gb.pending')}
    </span>
  ) : score.missing ? (
    <span className="text-danger" title={t('grading.gb.notSubmittedTitle')}>
      {t('grading.gb.missing')}
    </span>
  ) : (
    <span className="text-ink">{score.percent}%</span>
  );
};

export const GradebookGrid: React.FC<{ courseId: string; courseCode: string }> = ({ courseId, courseCode }) => {
  const t = useT();
  const { data, isLoading, error } = useApiData<{ data: GridData }>(`/api/v1/courses/${courseId}/gradebook/grid`);
  const { busy, error: actionError, run } = useAction();

  const exportCsv = () =>
    run(() => downloadFile(`/api/v1/courses/${courseId}/gradebook/export.csv`, `grades-${courseCode.replace(/[^\w.-]+/g, '_')}.csv`));

  if (isLoading) return <div className="text-xs text-ink-subtle p-6">{t('grading.loading')}</div>;
  if (error) return <Banner kind="error">{error}</Banner>;
  const grid = data?.data;
  if (!grid) return null;

  return (
    <div className="space-y-4">
      {actionError && <Banner kind="error">{actionError}</Banner>}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-ink-subtle">{t('grading.gb.gridHint')}</p>
        <button className={ghostBtnClass} disabled={busy || grid.learners.length === 0} onClick={exportCsv}>
          <Download className="h-3 w-3 inline mr-1" />
          {t('grading.gb.exportCsv')}
        </button>
      </div>

      {grid.learners.length === 0 ? (
        <div className="text-xs text-ink-subtle p-8 text-center bg-canvas border border-line rounded-2xl">{t('grading.gb.noLearners')}</div>
      ) : (
        <div className="overflow-auto max-h-[60vh] bg-canvas border border-line rounded-2xl">
          <table className="text-xs border-separate border-spacing-0">
            <thead className="text-ink-subtle text-left">
              <tr>
                <th className="p-3 sticky left-0 top-0 z-20 bg-canvas border-b border-line min-w-48">{t('grading.gb.col.learner')}</th>
                {grid.items.map((i) => (
                  <th key={i.id} className="p-3 sticky top-0 z-10 bg-canvas border-b border-line min-w-28 align-bottom font-semibold">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-ink-subtle">
                      {i.type === 'QUIZ' ? t('grading.gb.quiz') : t('grading.gb.assignment')}
                      {i.category ? ` · ${i.category}` : ''}
                    </div>
                    <div className="text-ink line-clamp-2" title={i.title}>
                      {i.title}
                    </div>
                  </th>
                ))}
                <th className="p-3 sticky top-0 z-10 bg-canvas border-b border-line min-w-24 align-bottom">
                  {t('grading.gb.courseGrade')}
                </th>
              </tr>
            </thead>
            <tbody>
              {grid.learners.map((l) => (
                <tr key={l.userId}>
                  <td className="p-3 sticky left-0 z-10 bg-canvas border-b border-line text-ink">
                    {l.name}
                    <div className="text-[10px] text-ink-subtle">{l.email}</div>
                  </td>
                  {grid.items.map((i) => (
                    <td key={i.id} className="p-3 border-b border-line">
                      <ScoreCell score={l.scores[i.id]} />
                    </td>
                  ))}
                  <td className="p-3 border-b border-line">
                    {l.courseGrade ? (
                      <span className="font-bold text-ink" title={t.dyn(`grading.status.${l.courseGrade.status}`, l.courseGrade.status)}>
                        {l.courseGrade.curvedPercent}% · {l.courseGrade.letter}
                      </span>
                    ) : (
                      <span className="text-ink-subtle" title={t('grading.gb.notCalculated')}>
                        –
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
