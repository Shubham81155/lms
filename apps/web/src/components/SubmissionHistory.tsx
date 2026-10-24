'use client';

import React, { useState } from 'react';
import { History } from 'lucide-react';
import { useApiData } from '@/hooks/useApiData';

interface Version {
  version: number;
  fileUrl: string | null;
  submissionText: string | null;
  submittedAt: string;
  isLate: boolean;
}

/**
 * Every version of an assignment submission, newest first, loaded when opened. Remount it (key on the
 * submission's submittedAt) to pick up a resubmission.
 */
export const SubmissionHistory: React.FC<{ assignmentId: string; submissionId: string }> = ({ assignmentId, submissionId }) => {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useApiData<{ data: Version[] }>(
    open ? `/api/v1/assignments/${assignmentId}/submissions/${submissionId}/versions` : null
  );
  const versions = data?.data ?? [];

  return (
    <div className="text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 font-semibold text-ink-muted hover:text-ink"
      >
        <History className="h-3 w-3" />
        {open ? 'Hide submission history' : 'Submission history'}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {isLoading && <p className="text-ink-subtle">Loading…</p>}
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          {!isLoading && versions.length === 1 && <p className="text-ink-subtle">Only one version has been handed in.</p>}
          {versions.length > 1 &&
            versions.map((v, i) => (
              <div key={v.version} className="rounded-xl border border-line bg-surface p-3 space-y-1">
                <div className="flex items-center justify-between gap-2 text-ink-subtle">
                  <span className="font-bold text-ink">
                    Version {v.version}
                    {i === 0 ? ' (current)' : ''}
                  </span>
                  <span>
                    {new Date(v.submittedAt).toLocaleString()}
                    {v.isLate ? <span className="ml-1 font-semibold text-danger">· late</span> : null}
                  </span>
                </div>
                {v.submissionText && <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-ink">{v.submissionText}</p>}
                {v.fileUrl && (
                  <a className="break-all text-brand-fg underline" href={v.fileUrl} target="_blank" rel="noopener noreferrer">
                    {v.fileUrl}
                  </a>
                )}
                {!v.submissionText && !v.fileUrl && <p className="text-ink-subtle">Content removed.</p>}
              </div>
            ))}
        </div>
      )}
    </div>
  );
};
