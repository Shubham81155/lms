'use client';

import React from 'react';
import { Award } from 'lucide-react';
import { RichText, useT } from '@/lib/i18n';
import type { EnrollmentStats } from '@/lib/types';

export const StudentWelcomeBanner: React.FC<{
  userName?: string;
  tenantName?: string;
  stats: EnrollmentStats | null;
  todoRemainingCount: number | null;
  onOpenAssignments: () => void;
}> = ({ userName, tenantName, stats, todoRemainingCount, onOpenAssignments }) => {
  const t = useT();
  return (
    <div className="bg-gradient-to-r from-brand/15 via-surface to-brand/10 border border-line rounded-3xl p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden shadow-2xl">
      <div className="space-y-2 z-10">
        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-brand/15 text-brand-fg border border-brand/50 font-semibold">
            {t('student.role')}
          </span>
          <span className="text-xs text-ink-muted">{tenantName}</span>
        </div>
        <h1 className="text-3xl font-extrabold text-ink tracking-tight">
          {userName ? t('student.welcome', { name: userName.split(' ')[0] }) : t('student.welcomeNoName')}
        </h1>
        <p className="text-sm text-ink max-w-xl">
          {stats ? (
            <RichText
              text={t('student.progress', {
                inProgress: t.plural('student.inProgress', stats.inProgress),
                completed: t.plural('student.completed', stats.completed),
              })}
            />
          ) : (
            t('student.loadingProgress')
          )}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 z-10 w-full md:w-auto">
        <button
          onClick={onOpenAssignments}
          className="bg-surface/80 hover:bg-raised/80 border border-line hover:border-success/40 rounded-2xl p-4 flex items-center gap-3 shadow-lg transition-all text-left group w-full sm:w-auto"
        >
          <div className="h-10 w-10 rounded-xl bg-success/20 text-success flex items-center justify-center border border-success/30 group-hover:scale-105 transition-transform">
            <Award className="h-6 w-6" />
          </div>
          <div>
            <div className="text-xs text-ink-muted font-medium">{t('student.todoCount')}</div>
            <div className="text-lg font-bold text-ink">{todoRemainingCount !== null ? todoRemainingCount : '–'}</div>
          </div>
        </button>
      </div>
    </div>
  );
};
