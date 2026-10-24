'use client';

import React, { useState } from 'react';
import { EyeOff, Eye, Flag, Lock, Pin, Unlock, X } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';
import type { ForumFlagView, ForumThreadView } from '@/hooks/useEngagement';

const chip =
  'px-2.5 py-1 bg-surface border border-line text-ink-muted hover:text-ink rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors disabled:opacity-60';

/** Any participant can report a thread or a reply; the course staff see it in their reports queue. */
export const ReportControl: React.FC<{ targetType: 'THREAD' | 'POST'; targetId: string; subject: string }> = ({
  targetType,
  targetId,
  subject,
}) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async () => {
    setBusy(true);
    try {
      await api.post('/api/v1/flags', { targetType, targetId, reason: reason.trim() });
      setResult({ ok: true, text: t('teach.mod.reported') });
      setOpen(false);
      setReason('');
    } catch (e) {
      setResult({ ok: false, text: errorMessage(e, t('teach.mod.reportFailed')) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {!open && (
        <button
          onClick={() => {
            setResult(null);
            setOpen(true);
          }}
          className={chip}
          aria-label={t('teach.mod.reportAria', { subject })}
        >
          <Flag className="h-3 w-3" />
          <span>{t('teach.mod.report')}</span>
        </button>
      )}
      {open && (
        <span className="inline-flex items-center gap-1.5">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder={t('teach.mod.reasonPlaceholder')}
            aria-label={t('teach.mod.reasonAria', { subject })}
            className="w-56 rounded-lg border border-line bg-canvas px-2 py-1 text-[11px] text-ink focus:border-brand focus:outline-none"
          />
          <button
            onClick={send}
            disabled={busy || reason.trim().length < 3}
            className="rounded-lg bg-danger px-2 py-1 text-[11px] font-bold text-on-brand disabled:opacity-50"
          >
            {busy ? t('teach.mod.sending') : t('teach.mod.send')}
          </button>
          <button onClick={() => setOpen(false)} className={chip}>
            {t('teach.mod.cancel')}
          </button>
        </span>
      )}
      {result && (
        <span role={result.ok ? 'status' : 'alert'} className={`text-[11px] font-semibold ${result.ok ? 'text-success' : 'text-danger'}`}>
          {result.text}
        </span>
      )}
    </span>
  );
};

/** Course staff: pin, lock or hide the open thread. */
export const ThreadModerationBar: React.FC<{
  thread: ForumThreadView;
  busy: boolean;
  onModerate: (patch: { pinned?: boolean; locked?: boolean; hidden?: boolean }) => void;
}> = ({ thread, busy, onModerate }) => {
  const t = useT();
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/60 px-3 py-2"
      role="group"
      aria-label={t('teach.mod.group')}
    >
      <span className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">{t('teach.mod.moderate')}</span>
      <button className={chip} disabled={busy} onClick={() => onModerate({ pinned: !thread.pinned })}>
        <Pin className="h-3 w-3" />
        <span>{thread.pinned ? t('teach.mod.unpin') : t('teach.mod.pin')}</span>
      </button>
      <button className={chip} disabled={busy} onClick={() => onModerate({ locked: !thread.locked })}>
        {thread.locked ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
        <span>{thread.locked ? t('teach.mod.unlock') : t('teach.mod.lock')}</span>
      </button>
      <button className={chip} disabled={busy} onClick={() => onModerate({ hidden: !thread.hidden })}>
        {thread.hidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        <span>{thread.hidden ? t('teach.mod.restore') : t('teach.mod.hide')}</span>
      </button>
      {thread.hidden && <span className="text-[11px] font-semibold text-accent">{t('teach.mod.hiddenFromLearners')}</span>}
    </div>
  );
};

interface PanelProps {
  flags: ForumFlagView[];
  error: string | null;
  onClose: () => void;
  onOpenThread: (threadId: string) => void;
  /** Called after a report is resolved or content is hidden, so the forum can refresh. */
  onChanged: () => void;
}

/** The open reports of a course. Staff can hide the reported text, dismiss the report, or go to the thread. */
export const ReportsPanel: React.FC<PanelProps> = ({ flags, error, onClose, onOpenThread, onChanged }) => {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (flag: ForumFlagView, hide: boolean) => {
    setBusy(flag.id);
    setProblem(null);
    try {
      if (hide) {
        if (flag.targetType === 'THREAD') await api.patch(`/api/v1/threads/${flag.targetId}/moderate`, { hidden: true });
        else await api.patch(`/api/v1/posts/${flag.targetId}/moderate`, { hidden: true });
      }
      await api.post(`/api/v1/flags/${flag.id}/resolve`, {});
      onChanged();
    } catch (e) {
      setProblem(errorMessage(e, t('teach.mod.updateFailed')));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-surface" role="region" aria-label={t('teach.mod.reports')}>
      <div className="flex items-center justify-between border-b border-line bg-canvas px-6 py-4">
        <div>
          <h4 className="text-sm font-bold text-ink">{t('teach.mod.reportsTitle', { count: t.number(flags.length) })}</h4>
          <p className="text-xs text-ink-muted">{t('teach.mod.reportsHint')}</p>
        </div>
        <button
          onClick={onClose}
          aria-label={t('teach.mod.closeReports')}
          className="rounded-xl p-1 text-ink-muted hover:bg-raised hover:text-ink"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-6">
        {(error || problem) && (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-xs font-semibold text-danger">
            {error || problem}
          </p>
        )}
        {flags.length === 0 && !error && (
          <p className="rounded-2xl border border-dashed border-line px-6 py-12 text-center text-xs text-ink-muted">
            {t('teach.mod.noReports')}
          </p>
        )}
        {flags.map((f) => (
          <div key={f.id} className="space-y-2 rounded-2xl border border-line bg-canvas p-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
              <span className="rounded-full border border-line bg-surface px-2 py-0.5 font-bold text-ink">
                {f.targetType === 'THREAD' ? t('teach.mod.thread') : t('teach.mod.reply')}
              </span>
              <span>{t('teach.mod.inThread', { title: f.target?.threadTitle ?? t('teach.mod.deletedThread') })}</span>
              <span>{t('teach.mod.reportedBy', { name: f.reporterName })}</span>
              {f.target?.hidden && <span className="font-semibold text-accent">{t('teach.mod.alreadyHidden')}</span>}
            </div>
            <p className="whitespace-pre-wrap rounded-xl border border-line bg-surface p-3 text-xs text-ink">
              {f.target?.excerpt ?? t('teach.mod.unavailable')}
            </p>
            <p className="text-xs text-ink">
              <span className="font-semibold text-danger">{t('teach.mod.reason')}</span> {f.reason}
            </p>
            <div className="flex flex-wrap gap-2">
              {f.target && (
                <button className={chip} onClick={() => onOpenThread(f.target!.threadId)}>
                  {t('teach.mod.openThread')}
                </button>
              )}
              {f.target && !f.target.hidden && (
                <button
                  className={chip}
                  disabled={busy === f.id}
                  onClick={() => run(f, true)}
                  aria-label={t('teach.mod.hideResolveAria', { id: f.id })}
                >
                  <EyeOff className="h-3 w-3" />
                  <span>{t('teach.mod.hideResolve')}</span>
                </button>
              )}
              <button
                className={chip}
                disabled={busy === f.id}
                onClick={() => run(f, false)}
                aria-label={t('teach.mod.dismissAria', { id: f.id })}
              >
                {t('teach.mod.dismiss')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
