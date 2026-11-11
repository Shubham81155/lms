'use client';

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { useT } from '@/lib/i18n';
import { STATUS_STYLE, ghostBtnClass, inputClass, primaryBtnClass, type Book } from './types';

interface GradebookActionResult {
  calculated?: number;
  skippedApproved?: number;
  submitted?: number;
  approved?: number;
  completed?: number;
  returned?: number;
  reopened?: number;
}

export const GradebookGrades: React.FC<{ courseId: string; canEdit: boolean; isAdmin: boolean }> = ({ courseId, canEdit, isAdmin }) => {
  const t = useT();
  const { data, isLoading, error, reload } = useApiData<Book>(`/api/v1/courses/${courseId}/gradebook`);
  const { busy, error: actionError, run } = useAction();
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const base = `/api/v1/courses/${courseId}/gradebook`;

  const act = (path: string, body: unknown, done: (r: GradebookActionResult) => string) =>
    run(async () => {
      const r = await api.post<{ data: GradebookActionResult }>(`${base}/${path}`, body);
      setMsg(done(r.data));
      await reload();
    });

  const s = data?.summary;
  const submit = () => {
    if (s && s.incomplete > 0 && !window.confirm(t.plural('grading.gb.confirmSubmit', s.incomplete))) return;
    act('submit', { allowIncomplete: !!s && s.incomplete > 0 }, (r) => t.plural('grading.gb.submittedDone', r.submitted ?? 0));
  };

  if (isLoading) return <div className="text-xs text-ink-subtle p-6">{t('grading.loading')}</div>;
  if (error) return <Banner kind="error">{error}</Banner>;

  return (
    <div className="space-y-4">
      {actionError && <Banner kind="error">{actionError}</Banner>}
      {msg && <Banner kind="ok">{msg}</Banner>}

      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <button
            className={primaryBtnClass}
            disabled={busy}
            onClick={() =>
              act('calculate', undefined, (r) =>
                r.skippedApproved
                  ? t('grading.gb.calcSkipped', {
                      calc: t.plural('grading.gb.calc', r.calculated ?? 0),
                      skipped: t.plural('grading.gb.skipped', r.skippedApproved),
                    })
                  : t('grading.gb.calcDone', { calc: t.plural('grading.gb.calc', r.calculated ?? 0) })
              )
            }
          >
            {t('grading.gb.calculate')}
          </button>
        )}
        {canEdit && (
          <button className={ghostBtnClass} disabled={busy || !s?.draft} onClick={submit}>
            {t('grading.gb.submitForApproval')}
          </button>
        )}
        {isAdmin && (
          <button
            className={ghostBtnClass}
            disabled={busy || !s?.submitted}
            onClick={() =>
              act('approve', undefined, (r) =>
                r.completed
                  ? t('grading.gb.approveCompleted', {
                      approved: t.plural('grading.gb.approved', r.approved ?? 0),
                      completed: t.plural('grading.gb.completed', r.completed),
                    })
                  : t('grading.gb.approveDone', { approved: t.plural('grading.gb.approved', r.approved ?? 0) })
              )
            }
          >
            {t('grading.gb.approve')}
          </button>
        )}
        {isAdmin && (
          <button className={ghostBtnClass} disabled={busy || !s?.submitted} onClick={() => setRejecting((v) => !v)}>
            {t('grading.gb.sendBackOpen')}
          </button>
        )}
        {isAdmin && (
          <button
            className={ghostBtnClass}
            disabled={busy || !s?.approved}
            onClick={() =>
              window.confirm(t('grading.gb.reopenConfirm')) &&
              act('reopen', undefined, (r) => t.plural('grading.gb.reopened', r.reopened ?? 0))
            }
          >
            {t('grading.gb.reopen')}
          </button>
        )}
      </div>

      {rejecting && (
        <div className="flex items-center gap-2">
          <input
            className={`${inputClass} flex-1`}
            aria-label={t('grading.gb.reasonLabel')}
            placeholder={t('grading.gb.reasonPlaceholder')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className={primaryBtnClass}
            disabled={busy || note.trim().length < 3}
            onClick={() =>
              act('reject', { note: note.trim() }, (r) => t.plural('grading.gb.returned', r.returned ?? 0)).then(() => {
                setRejecting(false);
                setNote('');
              })
            }
          >
            {t('grading.gb.sendBack')}
          </button>
        </div>
      )}
      {isAdmin && s?.submitted ? <p className="text-[11px] text-ink-subtle">{t('grading.gb.noSelfApprove')}</p> : null}

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
          {[
            [t('grading.gb.tile.learners'), s.total],
            [t('grading.gb.tile.draft'), s.draft],
            [t('grading.gb.tile.submitted'), s.submitted],
            [t('grading.gb.tile.approved'), s.approved],
            [t('grading.gb.tile.average'), s.average === null ? '–' : `${s.average}%`],
          ].map(([l, v]) => (
            <div key={String(l)} className="bg-canvas border border-line rounded-xl p-3">
              <div className="text-[10px] text-ink-subtle">{l}</div>
              <div className="text-lg font-bold text-ink">{v}</div>
            </div>
          ))}
        </div>
      )}

      {data && data.data.length === 0 ? (
        <div className="text-xs text-ink-subtle p-8 text-center bg-canvas border border-line rounded-2xl">{t('grading.gb.noGrades')}</div>
      ) : (
        <div className="overflow-x-auto bg-canvas border border-line rounded-2xl">
          <table className="w-full text-xs">
            <thead className="text-ink-subtle text-left">
              <tr>
                <th className="p-3">{t('grading.gb.col.learner')}</th>
                <th className="p-3">{t('grading.gb.col.raw')}</th>
                <th className="p-3">{t('grading.gb.col.final')}</th>
                <th className="p-3">{t('grading.gb.col.letter')}</th>
                <th className="p-3">{t('grading.gb.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.data ?? []).map((r) => (
                <tr key={r.userId} className="border-t border-line">
                  <td className="p-3 text-ink">
                    {r.name}
                    <div className="text-[10px] text-ink-subtle">{r.email}</div>
                  </td>
                  <td className="p-3 text-ink-muted">{r.rawPercent}%</td>
                  <td className="p-3 font-bold text-ink">{r.curvedPercent}%</td>
                  <td className="p-3 text-ink">{r.letter}</td>
                  <td className="p-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLE[r.status]}`}>
                      {t.dyn(`grading.status.${r.status}`, r.status)}
                    </span>
                    {r.incomplete && (
                      <span title={t('grading.gb.workWaiting')} className="ml-2 text-accent inline-flex items-center">
                        <AlertTriangle className="h-3 w-3" />
                      </span>
                    )}
                    {r.decisionNote && (
                      <div className="text-[10px] text-ink-subtle mt-1">{t('grading.gb.sentBackNote', { note: r.decisionNote })}</div>
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
