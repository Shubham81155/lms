'use client';

import React from 'react';
import { useApiData } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';
import { formatEnumLabel, type PersonEnrollment } from './shared';

export const UserEnrollments: React.FC<{ userId: string }> = ({ userId }) => {
  const t = useT();
  const data = useApiData<{ data: PersonEnrollment[] }>(`/api/v1/users/${userId}/enrollments`);
  if (data.isLoading && !data.data) return <p className="text-[11px] text-ink-subtle">{t('people.row.loadingCourses')}</p>;
  if (data.error) return <p className="text-[11px] text-danger">{data.error}</p>;
  const rows = data.data?.data ?? [];
  if (rows.length === 0) return <p className="text-[11px] text-ink-subtle">{t('people.row.noCourses')}</p>;
  return (
    <ul className="space-y-1 text-[11px] text-ink-muted">
      {rows.map((e) => (
        <li key={e.id}>
          <span className="font-semibold text-ink">{e.course?.code ?? t('people.row.courseFallback')}</span> ·{' '}
          {t.dyn(`people.enrol.${e.status}`, formatEnumLabel(e.status))} · {t.number(Math.round(e.progressPercent))}%
        </li>
      ))}
    </ul>
  );
};
