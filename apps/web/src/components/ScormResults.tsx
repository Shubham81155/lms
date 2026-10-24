'use client';

import React, { useEffect, useState } from 'react';
import { useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { plural } from '@/lib/plural';

interface Package {
  id: string;
  title: string;
  version: '1.2' | '2004';
  createdAt: string;
  /** A virus scan found malware in its zip: learners can no longer open it. */
  withdrawn: boolean;
}
interface Attempt {
  userId: string;
  name: string;
  email: string;
  /** not attempted | incomplete | completed | passed | failed | unknown */
  status: string;
  scorePercent: number | null;
  completedAt: string | null;
  /** Null when the learner has not opened the package. */
  updatedAt: string | null;
}

const input = 'bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink focus:outline-none focus:border-brand';

const STATUS: Record<string, { label: string; style: string }> = {
  passed: { label: 'Passed', style: 'bg-success/10 text-success border-success/30' },
  completed: { label: 'Completed', style: 'bg-success/10 text-success border-success/30' },
  failed: { label: 'Failed', style: 'bg-danger/10 text-danger border-danger/30' },
  incomplete: { label: 'In progress', style: 'bg-accent/10 text-accent border-accent/30' },
  'not attempted': { label: 'Not started', style: 'bg-raised text-ink-muted border-line' },
};
const statusOf = (s: string) => STATUS[s] ?? { label: s === 'unknown' ? 'Unknown' : s, style: 'bg-raised text-ink-muted border-line' };

const Results: React.FC<{ packageId: string }> = ({ packageId }) => {
  const { data, isLoading, error } = useApiData<{ data: Attempt[] }>(`/api/v1/scorm-packages/${packageId}/attempts`);
  if (isLoading) return <div className="text-xs text-ink-subtle p-6">Loading…</div>;
  if (error) return <Banner kind="error">{error}</Banner>;
  const rows = data?.data ?? [];
  if (rows.length === 0)
    return (
      <div className="text-xs text-ink-subtle p-8 text-center bg-canvas border border-line rounded-2xl">No learners are enrolled yet.</div>
    );

  const count = (...s: string[]) => rows.filter((r) => s.includes(r.status)).length;
  const scores = rows.map((r) => r.scorePercent).filter((n): n is number => n !== null);
  const average = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
  const tiles = [
    { label: 'Finished', value: count('passed', 'completed') },
    { label: 'Failed', value: count('failed') },
    { label: 'In progress', value: count('incomplete', 'unknown') },
    { label: 'Not started', value: count('not attempted') },
    { label: 'Average score', value: average === null ? '–' : `${average}%` },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="bg-canvas border border-line rounded-2xl p-3">
            <div className="text-[10px] font-semibold text-ink-subtle">{t.label}</div>
            <div className="text-lg font-bold text-ink">{t.value}</div>
          </div>
        ))}
      </div>
      <div className="overflow-auto max-h-[50vh] bg-canvas border border-line rounded-2xl">
        <table className="w-full text-xs">
          <thead className="text-ink-subtle text-left">
            <tr className="border-b border-line">
              <th className="p-3">Learner</th>
              <th className="p-3">Status</th>
              <th className="p-3">Score</th>
              <th className="p-3">Finished</th>
              <th className="p-3">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = statusOf(r.status);
              return (
                <tr key={r.userId} className="border-b border-line last:border-0">
                  <td className="p-3 text-ink">
                    {r.name}
                    <div className="text-[10px] text-ink-subtle">{r.email}</div>
                  </td>
                  <td className="p-3">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${s.style}`}>{s.label}</span>
                  </td>
                  <td className="p-3 text-ink">
                    {r.scorePercent === null ? <span className="text-ink-subtle">–</span> : `${r.scorePercent}%`}
                  </td>
                  <td className="p-3 text-ink-muted">{r.completedAt ? new Date(r.completedAt).toLocaleDateString() : '–'}</td>
                  <td className="p-3 text-ink-muted">{r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** Each learner's status and score in the course's SCORM packages, as the packages report them. */
export const ScormResults: React.FC<{ courseId: string }> = ({ courseId }) => {
  const { data, isLoading, error } = useApiData<{ data: Package[] }>(`/api/v1/courses/${courseId}/scorm-packages`);
  const packages = data?.data ?? [];
  const [packageId, setPackageId] = useState('');
  useEffect(() => {
    if (packages.length > 0 && !packages.some((p) => p.id === packageId)) setPackageId(packages[0].id);
  }, [packages, packageId]);

  if (isLoading) return <div className="text-xs text-ink-subtle p-6">Loading…</div>;
  if (error) return <Banner kind="error">{error}</Banner>;
  if (packages.length === 0) {
    return (
      <div className="text-xs text-ink-subtle p-8 text-center bg-canvas border border-line rounded-2xl">
        This course has no SCORM packages. Add one from the course&apos;s Content tool.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-ink-subtle">
          Status and score as each package reports them. {plural(packages.length, 'package')} in this course.
        </p>
        {packages.length > 1 && (
          <select className={input} aria-label="SCORM package" value={packageId} onChange={(e) => setPackageId(e.target.value)}>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} (SCORM {p.version}){p.withdrawn ? ' · withdrawn' : ''}
              </option>
            ))}
          </select>
        )}
      </div>
      {packages.find((p) => p.id === packageId)?.withdrawn && (
        <Banner kind="error">
          A virus scan found malware in this package&apos;s zip, so learners can no longer open it. Upload a clean copy as a new lesson.
        </Banner>
      )}
      {packageId && <Results key={packageId} packageId={packageId} />}
    </div>
  );
};
