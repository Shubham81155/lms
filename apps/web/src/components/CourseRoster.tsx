'use client';

import React, { useEffect, useState } from 'react';
import { X, CheckCircle2, AlertTriangle, Award } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { errorMessage, useApiData } from '@/hooks/useApiData';
import { useStaffCourses } from '@/hooks/useStaffCourses';
import { useT } from '@/lib/i18n';

type Status = 'ENROLLED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'DROPPED';

interface RosterRow {
  id: string;
  status: Status;
  progressPercent: number;
  finalGrade: number | null;
  user?: { id: string; firstName: string; lastName: string; email: string };
  course?: { passingGradePercent: number };
  certificate?: { certificateNumber: string } | null;
}

/** A success is kept as a key (so it follows the language); an error carries the server's own text. */
type Notice = { kind: 'ok'; key: string; vars: Record<string, string> } | { kind: 'error'; text: string };

const STATUS_STYLE: Record<Status, string> = {
  ENROLLED: 'border-line bg-surface text-ink-muted',
  IN_PROGRESS: 'border-brand/40 bg-brand/15 text-brand-fg',
  COMPLETED: 'border-success/40 bg-success/10 text-success',
  FAILED: 'border-danger/40 bg-danger/10 text-danger',
  DROPPED: 'border-line bg-surface text-ink-subtle',
};

const smallBtn =
  'rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-raised disabled:opacity-50';
const primaryBtn =
  'rounded-lg bg-brand px-3 py-1.5 text-[11px] font-bold text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-50';

/**
 * Learners of a course and the one thing only staff can do for them: record that they finished it.
 * Completing issues the certificate; a final grade below the passing grade records a failure instead.
 */
export const CourseRoster: React.FC<{
  onClose: () => void;
  /** Open on this course when the person may use it. */ initialCourseId?: string | null;
}> = ({ onClose, initialCourseId }) => {
  useEscapeKey(onClose);
  const t = useT();
  const { user } = useAuth();
  const { courses, isLoading: coursesLoading } = useStaffCourses();
  // Administrators and the assigned instructor manage enrolment; assistants can only look.
  const canManage = user?.role === 'INSTRUCTOR' || user?.role === 'TENANT_ADMIN' || user?.role === 'SUPER_ADMIN';
  const [enrollEmail, setEnrollEmail] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [courseId, setCourseId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [grade, setGrade] = useState('');

  useEffect(() => {
    if (!courseId && courses.length > 0)
      setCourseId(initialCourseId && courses.some((c) => c.id === initialCourseId) ? initialCourseId : courses[0].id);
  }, [courses, courseId]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const roster = useApiData<{ data: RosterRow[]; pagination?: { total: number } }>(courseId ? '/api/v1/enrollments' : null, {
    courseId,
    limit: 100,
  });
  const rows = (roster.data?.data ?? []).filter((r) => r.status !== 'DROPPED');
  const total = roster.data?.pagination?.total ?? rows.length;
  const course = courses.find((c) => c.id === courseId);
  const gradeValue = grade.trim() === '' ? undefined : Number(grade);
  const gradeInvalid = gradeValue !== undefined && (!Number.isFinite(gradeValue) || gradeValue < 0 || gradeValue > 100);

  const enroll = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = enrollEmail.trim();
    if (!email) return;
    setBusy(true);
    try {
      await api.post('/api/v1/enrollments', { courseId, email });
      setNotice({ kind: 'ok', key: 'teach.roster.enrolled', vars: { email, code: course?.code ?? '' } });
      setEnrollEmail('');
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err, t('teach.roster.enrollFailed')) });
    } finally {
      setBusy(false);
      roster.reload();
    }
  };

  const remove = async (row: RosterRow) => {
    const name = row.user ? `${row.user.firstName} ${row.user.lastName}` : t('teach.roster.thisLearner');
    setBusy(true);
    try {
      await api.delete(`/api/v1/enrollments/${row.id}`);
      setNotice({
        kind: 'ok',
        key: 'teach.roster.removed',
        vars: { name, code: course?.code ?? '' },
      });
      setRemoving(null);
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err, t('teach.roster.removeFailed')) });
    } finally {
      setBusy(false);
      roster.reload();
    }
  };

  const complete = async (row: RosterRow) => {
    const name = row.user ? `${row.user.firstName} ${row.user.lastName}` : t('teach.roster.thisLearner');
    setBusy(true);
    try {
      const res = await api.patch<{ data?: { status: Status } }>(`/api/v1/enrollments/${row.id}/progress`, {
        progressPercent: 100,
        ...(gradeValue !== undefined ? { finalGrade: gradeValue } : {}),
      });
      const status = res.data?.status ?? 'COMPLETED';
      setNotice(
        status === 'FAILED'
          ? { kind: 'ok', key: 'teach.roster.notPassed', vars: { name } }
          : { kind: 'ok', key: 'teach.roster.completed', vars: { name } }
      );
      setConfirming(null);
      setGrade('');
    } catch (e) {
      setNotice({ kind: 'error', text: errorMessage(e, t('teach.roster.completeFailed')) });
    } finally {
      setBusy(false);
      roster.reload();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/85 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={t('teach.roster.dialog')}
    >
      <div className="relative flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-line bg-canvas px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-ink">{t('teach.roster.title')}</h3>
            <p className="text-xs text-ink-muted">{t('teach.roster.subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={courseId}
              onChange={(e) => {
                setCourseId(e.target.value);
                setConfirming(null);
              }}
              aria-label={t('teach.roster.course')}
              disabled={busy}
              className="rounded-xl border border-line bg-surface px-3 py-1.5 text-xs text-ink focus:border-brand focus:outline-none"
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.title}
                </option>
              ))}
            </select>
            <button
              onClick={onClose}
              aria-label={t('teach.roster.close')}
              className="rounded-xl p-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {coursesLoading || (courseId && roster.isLoading && !roster.data) ? (
            <p role="status" className="py-16 text-center text-xs text-ink-muted">
              {t('teach.roster.loading')}
            </p>
          ) : courses.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line px-6 py-12 text-center text-xs text-ink-muted">
              {t('teach.roster.noCourses')}
            </p>
          ) : roster.error ? (
            <div role="alert" className="mx-auto max-w-md rounded-2xl border border-danger/30 bg-danger/10 p-6 text-center">
              <p className="text-sm font-bold text-danger">{t('teach.roster.loadError', { code: course?.code ?? '' })}</p>
              <p className="mt-1.5 text-xs text-ink-muted">{roster.error}</p>
              <button onClick={roster.reload} className={`${smallBtn} mt-4`}>
                {t('teach.roster.retry')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {canManage && (
                <form onSubmit={enroll} className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-canvas p-3">
                  <label className="text-xs font-semibold text-ink-muted" htmlFor="enroll-email">
                    {t('teach.roster.enrollLabel')}
                  </label>
                  <input
                    id="enroll-email"
                    type="email"
                    value={enrollEmail}
                    onChange={(e) => setEnrollEmail(e.target.value)}
                    placeholder={t('teach.roster.emailPlaceholder')}
                    maxLength={254}
                    disabled={busy}
                    className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs text-ink focus:border-brand focus:outline-none"
                  />
                  <button type="submit" disabled={busy || !enrollEmail.trim()} className={primaryBtn}>
                    {t('teach.roster.enroll')}
                  </button>
                </form>
              )}
              {rows.length === 0 && (
                <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-xs text-ink-muted">
                  {t('teach.roster.nobody', { code: course?.code ?? '' })}
                </p>
              )}
              {rows.length > 0 && (
                <p className="text-[11px] text-ink-subtle">
                  {t.plural('teach.roster.shown', total, { count: t.number(total), shown: t.number(rows.length) })}
                </p>
              )}
              {rows.map((row) => {
                const name = row.user ? `${row.user.firstName} ${row.user.lastName}` : t('teach.roster.learner');
                const open = row.status === 'ENROLLED' || row.status === 'IN_PROGRESS';
                const asking = confirming === row.id;
                const passing = row.course?.passingGradePercent;
                return (
                  <div key={row.id} className="rounded-2xl border border-line bg-canvas p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-sm text-ink">{name}</strong>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[row.status]}`}>
                            {t.dyn(`teach.roster.status.${row.status}`, row.status.replace('_', ' '))}
                          </span>
                        </div>
                        {row.user && <p className="text-xs text-ink-muted">{row.user.email}</p>}
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="w-36">
                          <div className="mb-1 flex justify-between text-[11px] text-ink-muted">
                            <span>{t('teach.roster.progress')}</span>
                            <span className="font-bold text-ink">{t.number(Math.round(row.progressPercent))}%</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full border border-line bg-surface">
                            <div className="h-full rounded-full bg-brand" style={{ width: `${row.progressPercent}%` }} />
                          </div>
                        </div>
                        {row.finalGrade !== null && (
                          <span className="text-xs text-ink-muted">
                            {t('teach.roster.grade', { grade: `${t.number(Math.round(row.finalGrade))}%` })}
                          </span>
                        )}
                        {row.certificate && (
                          <span className="flex items-center gap-1 text-[11px] text-success" title={t('teach.roster.certificate')}>
                            <Award className="h-3.5 w-3.5" />
                            {row.certificate.certificateNumber}
                          </span>
                        )}
                        {open && !asking && (
                          <button
                            onClick={() => {
                              setConfirming(row.id);
                              setGrade('');
                            }}
                            disabled={busy}
                            aria-label={t('teach.roster.markDoneAria', { name })}
                            className={smallBtn}
                          >
                            {t('teach.roster.markDone')}
                          </button>
                        )}
                        {open && canManage && removing !== row.id && (
                          <button
                            onClick={() => setRemoving(row.id)}
                            disabled={busy}
                            aria-label={t('teach.roster.removeAria', { name })}
                            className={smallBtn}
                          >
                            {t('teach.roster.remove')}
                          </button>
                        )}
                      </div>
                    </div>

                    {open && canManage && removing === row.id && (
                      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5 text-xs">
                        <span className="text-ink">{t('teach.roster.removeConfirm', { name, code: course?.code ?? '' })}</span>
                        <button
                          onClick={() => remove(row)}
                          disabled={busy}
                          aria-label={t('teach.roster.removeConfirmAria', { name })}
                          className="rounded-lg bg-danger px-3 py-1.5 text-[11px] font-bold text-on-brand disabled:opacity-50"
                        >
                          {busy ? t('teach.roster.removing') : t('teach.roster.remove')}
                        </button>
                        <button onClick={() => setRemoving(null)} disabled={busy} className={smallBtn}>
                          {t('teach.roster.keep')}
                        </button>
                      </div>
                    )}

                    {open && asking && (
                      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2.5 text-xs">
                        <span className="text-ink">{t('teach.roster.completeConfirm', { name })}</span>
                        <label className="flex items-center gap-1.5 text-ink-muted">
                          {t('teach.roster.finalGrade')}
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={grade}
                            onChange={(e) => setGrade(e.target.value)}
                            aria-label={t('teach.roster.finalGradeAria', { name })}
                            className="w-16 rounded-lg border border-line bg-canvas px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
                          />
                          %
                        </label>
                        {passing !== undefined && (
                          <span className="text-[11px] text-ink-subtle">
                            {t('teach.roster.below', { passing: `${t.number(passing)}%` })}
                          </span>
                        )}
                        <button
                          onClick={() => complete(row)}
                          disabled={busy || gradeInvalid}
                          aria-label={t('teach.roster.confirmAria', { name })}
                          className={primaryBtn}
                        >
                          {busy ? t('teach.roster.saving') : t('teach.roster.confirm')}
                        </button>
                        <button onClick={() => setConfirming(null)} disabled={busy} className={smallBtn}>
                          {t('teach.roster.cancel')}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {notice && (
          <div
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={`absolute bottom-6 left-1/2 z-10 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-xl border bg-surface px-4 py-2.5 text-xs shadow-xl ${
              notice.kind === 'ok' ? 'border-success/40 text-success' : 'border-danger/40 text-danger'
            }`}
          >
            {notice.kind === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            <span className="font-semibold">{notice.kind === 'ok' ? t.dyn(notice.key, '', notice.vars) : notice.text}</span>
          </div>
        )}
      </div>
    </div>
  );
};
