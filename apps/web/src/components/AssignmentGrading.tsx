'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Plus, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useStaffCourses } from '@/hooks/useStaffCourses';
import { Banner } from '@/components/admin/IdentityPanels';
import { SubmissionHistory } from '@/components/SubmissionHistory';
import { round2, rubricDraft, rubricProblemMsg, type Criterion } from '@/lib/forms';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useT } from '@/lib/i18n';

export type { Criterion };

interface Assignment {
  id: string;
  title: string;
  maxPoints: number;
  rubricJson: Criterion[] | null;
  _count?: { submissions: number };
}
interface Submission {
  id: string;
  userId: string;
  fileUrl: string | null;
  submissionText: string | null;
  grade: number | null;
  feedback: string | null;
  plagiarismScore: number | null;
  plagiarismReportUrl: string | null;
  plagiarismStatus: 'PENDING' | 'SUBMITTED' | 'COMPLETE' | 'FAILED' | null;
  rubricScoresJson: Record<string, number> | null;
  submittedAt: string;
  gradedAt: string | null;
  user?: { firstName: string; lastName: string; email: string };
}
interface Appeal {
  id: string;
  status: 'OPEN' | 'UPHELD' | 'DENIED';
  reason: string;
  response: string | null;
  student?: string;
  createdAt: string;
  submission: { id: string; grade: number | null; text?: string | null; rubricScores: Record<string, number> | null };
  assignment: Assignment;
}

const input =
  'bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const primary = 'px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all';
const ghost =
  'px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';

// Dates keep the viewer's own time zone, as before.
const DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: undefined };
const DAY_TIME: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: undefined,
};
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
              className={`${input} w-20`}
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

// ---------------------------------------------------------------------------

const GradePanel: React.FC<{ assignment: Assignment; sub: Submission; canGrade: boolean; onSaved: () => void }> = ({
  assignment,
  sub,
  canGrade,
  onSaved,
}) => {
  const rubric = assignment.rubricJson;
  const t = useT();
  const { busy, error, run, clearError } = useAction();
  const [grade, setGrade] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const [note, setNote] = useState<'saved' | 'reopened' | null>(null);

  useEffect(() => {
    setGrade(sub.grade === null ? '' : String(sub.grade));
    setValues(
      Object.fromEntries(
        (rubric ?? []).map((c) => [c.id, sub.rubricScoresJson?.[c.id] === undefined ? '' : String(sub.rubricScoresJson[c.id])])
      )
    );
    setFeedback(sub.feedback ?? '');
    setNote(null);
    clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub.id, sub.gradedAt]);

  const draft = rubric ? rubricDraft(rubric, values) : null;
  const plainOk = grade.trim() !== '' && Number(grade) >= 0 && Number(grade) <= assignment.maxPoints;
  const ok = rubric ? !draft!.problem : plainOk;

  const save = () =>
    run(async () => {
      const body = rubric
        ? { criteria: Object.fromEntries(rubric.map((c) => [c.id, Number(values[c.id])])), feedback: feedback.trim() || undefined }
        : { grade: Number(grade), feedback: feedback.trim() || undefined };
      const r = await api.patch<{ courseGradeReopened?: boolean }>(
        `/api/v1/assignments/${assignment.id}/submissions/${sub.id}/grade`,
        body
      );
      setNote(r.courseGradeReopened ? 'reopened' : 'saved');
      onSaved();
    });

  return (
    <div className="space-y-4">
      <div className="bg-canvas border border-line rounded-2xl p-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <strong className="text-ink">{sub.user ? `${sub.user.firstName} ${sub.user.lastName}` : t('grading.as.learner')}</strong>
          <span className="text-ink-subtle">{t('grading.as.submittedOn', { date: t.date(sub.submittedAt, DAY_TIME) })}</span>
        </div>
        {sub.submissionText && <p className="text-xs text-ink whitespace-pre-wrap max-h-48 overflow-y-auto">{sub.submissionText}</p>}
        {sub.fileUrl && (
          <a className="text-xs text-brand-fg underline break-all" href={sub.fileUrl} target="_blank" rel="noopener noreferrer">
            {sub.fileUrl}
          </a>
        )}
        <SubmissionHistory key={sub.submittedAt} assignmentId={assignment.id} submissionId={sub.id} />
        {sub.plagiarismScore !== null && (
          <div className={`text-[11px] ${sub.plagiarismScore >= 30 ? 'text-danger' : 'text-success'}`}>
            {t('grading.as.similarity', { percent: t.number(Math.round(sub.plagiarismScore)) })}{' '}
            {sub.plagiarismReportUrl && (
              <a className="underline" href={sub.plagiarismReportUrl} target="_blank" rel="noopener noreferrer">
                {t('grading.as.report')}
              </a>
            )}
          </div>
        )}
        {sub.plagiarismScore === null && sub.plagiarismStatus && sub.plagiarismStatus !== 'COMPLETE' && (
          <div className={`text-[11px] ${sub.plagiarismStatus === 'FAILED' ? 'text-accent' : 'text-ink-subtle'}`}>
            {t(`grading.as.sim.${sub.plagiarismStatus}`)}
          </div>
        )}
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {note && <Banner kind="ok">{note === 'reopened' ? t('grading.as.savedReopened') : t('grading.as.saved')}</Banner>}

      {rubric ? (
        <RubricInputs
          criteria={rubric}
          values={values}
          onChange={(v) => {
            clearError();
            setValues(v);
          }}
          disabled={!canGrade}
        />
      ) : (
        <label className="block space-y-1 text-xs text-ink-muted font-semibold">
          {t('grading.as.gradeOutOf', { max: assignment.maxPoints })}
          <input
            className={`${input} w-32 block`}
            type="number"
            min={0}
            max={assignment.maxPoints}
            step="0.5"
            disabled={!canGrade}
            value={grade}
            onChange={(e) => {
              clearError();
              setGrade(e.target.value);
            }}
          />
        </label>
      )}
      <label className="block space-y-1 text-xs text-ink-muted font-semibold">
        {t('grading.as.feedback')}
        <textarea
          className={`${input} w-full`}
          rows={3}
          maxLength={10000}
          disabled={!canGrade}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
      </label>
      {canGrade && (
        <button className={primary} disabled={busy || !ok} onClick={save}>
          {busy ? t('grading.as.saving') : sub.gradedAt ? t('grading.as.updateGrade') : t('grading.as.saveGrade')}
        </button>
      )}
    </div>
  );
};

const Submissions: React.FC<{ assignment: Assignment; canGrade: boolean }> = ({ assignment, canGrade }) => {
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

// ---------------------------------------------------------------------------

const RubricEditor: React.FC<{ assignment: Assignment; canEdit: boolean; onSaved: () => void }> = ({ assignment, canEdit, onSaved }) => {
  const t = useT();
  const graded = useApiData<{ data: Submission[] }>(`/api/v1/assignments/${assignment.id}/submissions`, { limit: 100 });
  const { busy, error, run, clearError } = useAction();
  const [rows, setRows] = useState<{ name: string; description: string; maxPoints: string }[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRows((assignment.rubricJson ?? []).map((c) => ({ name: c.name, description: c.description ?? '', maxPoints: String(c.maxPoints) })));
  }, [assignment.id, assignment.rubricJson]);

  const locked = (graded.data?.data ?? []).some((s) => s.gradedAt);
  const total = round2(rows.reduce((s, r) => s + (Number(r.maxPoints) || 0), 0));
  const valid = rows.length > 0 && rows.every((r) => r.name.trim() && Number(r.maxPoints) > 0);
  const edit = canEdit && !locked;

  const save = (criteria: unknown) =>
    run(async () => {
      await api.put(`/api/v1/assignments/${assignment.id}/rubric`, { criteria });
      setSaved(true);
      onSaved();
    });

  return (
    <div
      className="space-y-4 max-w-2xl"
      onChange={() => {
        clearError();
        setSaved(false);
      }}
    >
      {locked && <Banner kind="error">{t('grading.as.locked')}</Banner>}
      {!canEdit && <Banner kind="error">{t('grading.as.onlyInstructor')}</Banner>}
      {error && <Banner kind="error">{error}</Banner>}
      {saved && <Banner kind="ok">{t('grading.as.rubricSaved')}</Banner>}
      <p className="text-xs text-ink-muted">{t('grading.as.rubricWorth', { total })}</p>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-start">
          <input
            className={`${input} col-span-4`}
            aria-label={t('grading.as.critName', { n: i + 1 })}
            placeholder={t('grading.as.critPlaceholder')}
            disabled={!edit}
            value={r.name}
            onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
          />
          <input
            className={`${input} col-span-5`}
            aria-label={t('grading.as.critDescription', { n: i + 1 })}
            placeholder={t('grading.as.critDescPlaceholder')}
            disabled={!edit}
            value={r.description}
            onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
          />
          <input
            className={`${input} col-span-2`}
            type="number"
            min={0.5}
            step="0.5"
            aria-label={t('grading.as.critPoints', { n: i + 1 })}
            disabled={!edit}
            value={r.maxPoints}
            onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, maxPoints: e.target.value } : x)))}
          />
          <button
            className={`${ghost} col-span-1`}
            disabled={!edit}
            aria-label={t('grading.as.critRemove', { n: i + 1 })}
            onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button className={ghost} disabled={!edit} onClick={() => setRows((p) => [...p, { name: '', description: '', maxPoints: '' }])}>
          <Plus className="h-3 w-3 inline mr-1" />
          {t('grading.as.addCriterion')}
        </button>
        <button
          className={primary}
          disabled={!edit || busy || !valid}
          onClick={() =>
            save(
              rows.map((r) => ({
                name: r.name.trim(),
                ...(r.description.trim() ? { description: r.description.trim() } : {}),
                maxPoints: Number(r.maxPoints),
              }))
            )
          }
        >
          {t('grading.as.saveRubric')}
        </button>
        {assignment.rubricJson && (
          <button
            className={ghost}
            disabled={!edit || busy}
            onClick={() => window.confirm(t('grading.as.removeRubricConfirm')) && save(null)}
          >
            {t('grading.as.removeRubric')}
          </button>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------

const Appeals: React.FC<{ courseId: string; canResolve: boolean }> = ({ courseId, canResolve }) => {
  const t = useT();
  const { data, isLoading, error, reload } = useApiData<{ data: Appeal[] }>(`/api/v1/courses/${courseId}/appeals`);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = data?.data ?? [];

  if (isLoading) return <div className="text-xs text-ink-subtle">{t('grading.loading')}</div>;
  if (error) return <Banner kind="error">{error}</Banner>;
  if (list.length === 0)
    return (
      <div className="text-xs text-ink-subtle p-10 text-center bg-canvas border border-line rounded-2xl">{t('grading.as.noAppeals')}</div>
    );

  return (
    <ul className="space-y-3">
      {list.map((a) => (
        <li key={a.id} className="bg-canvas border border-line rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div>
              <strong className="text-ink">{a.student}</strong>
              <span className="text-ink-subtle"> · {a.assignment.title}</span>
            </div>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${a.status === 'OPEN' ? 'bg-accent/10 text-accent border-accent/30' : a.status === 'UPHELD' ? 'bg-success/10 text-success border-success/30' : 'bg-raised text-ink border-line'}`}
            >
              {t.dyn(`grading.as.appeal.${a.status}`, a.status)}
            </span>
          </div>
          <p className="text-xs text-ink">"{a.reason}"</p>
          <div className="text-[11px] text-ink-subtle">
            {t('grading.as.currentGrade', { grade: a.submission.grade ?? '', max: a.assignment.maxPoints })}
          </div>
          {a.response && <div className="text-[11px] text-ink-muted">{t('grading.as.decisionText', { response: a.response })}</div>}
          {a.status === 'OPEN' &&
            canResolve &&
            (openId === a.id ? (
              <Resolve
                appeal={a}
                onDone={() => {
                  setOpenId(null);
                  reload();
                }}
              />
            ) : (
              <button className={ghost} onClick={() => setOpenId(a.id)}>
                {t('grading.as.review')}
              </button>
            ))}
        </li>
      ))}
    </ul>
  );
};

const Resolve: React.FC<{ appeal: Appeal; onDone: () => void }> = ({ appeal, onDone }) => {
  const t = useT();
  const rubric = appeal.assignment.rubricJson;
  const { busy, error, run, clearError } = useAction();
  const [decision, setDecision] = useState<'UPHELD' | 'DENIED'>('DENIED');
  const [response, setResponse] = useState('');
  const [grade, setGrade] = useState('');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (rubric ?? []).map((c) => [
        c.id,
        appeal.submission.rubricScores?.[c.id] === undefined ? '' : String(appeal.submission.rubricScores[c.id]),
      ])
    )
  );
  const draft = rubric ? rubricDraft(rubric, values) : null;
  const gradeOk = grade.trim() !== '' && Number(grade) >= 0 && Number(grade) <= appeal.assignment.maxPoints;
  const ready = response.trim().length >= 3 && (decision === 'DENIED' || (rubric ? !draft!.problem : gradeOk));

  const submit = () =>
    run(async () => {
      await api.post(`/api/v1/appeals/${appeal.id}/resolve`, {
        decision,
        response: response.trim(),
        ...(decision === 'UPHELD'
          ? rubric
            ? { criteria: Object.fromEntries(rubric.map((c) => [c.id, Number(values[c.id])])) }
            : { grade: Number(grade) }
          : {}),
      });
      onDone();
    });

  return (
    <div className="space-y-3 border-t border-line pt-3" onChange={clearError}>
      {error && <Banner kind="error">{error}</Banner>}
      <fieldset className="flex gap-4 text-xs text-ink">
        <legend className="sr-only">{t('grading.as.decision')}</legend>
        {(['DENIED', 'UPHELD'] as const).map((d) => (
          <label key={d} className="flex items-center gap-1.5">
            <input type="radio" name={`d-${appeal.id}`} checked={decision === d} onChange={() => setDecision(d)} />
            {d === 'DENIED' ? t('grading.as.keepGrade') : t('grading.as.changeGrade')}
          </label>
        ))}
      </fieldset>
      {decision === 'UPHELD' &&
        (rubric ? (
          <RubricInputs criteria={rubric} values={values} onChange={setValues} />
        ) : (
          <label className="block space-y-1 text-xs text-ink-muted font-semibold">
            {t('grading.as.correctedGrade', { max: appeal.assignment.maxPoints })}
            <input
              className={`${input} w-32 block`}
              type="number"
              min={0}
              max={appeal.assignment.maxPoints}
              step="0.5"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
            />
          </label>
        ))}
      <label className="block space-y-1 text-xs text-ink-muted font-semibold">
        {t('grading.as.explanation')}
        <textarea className={`${input} w-full`} rows={2} maxLength={2000} value={response} onChange={(e) => setResponse(e.target.value)} />
      </label>
      <button className={primary} disabled={busy || !ready} onClick={submit}>
        {busy ? t('grading.as.saving') : t('grading.as.recordDecision')}
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------

export const AssignmentGrading: React.FC<{
  onClose: () => void;
  /** Open on this course when the person may use it. */ initialCourseId?: string | null;
}> = ({ onClose, initialCourseId }) => {
  const t = useT();
  useEscapeKey(onClose);
  const { user } = useAuth();
  const { courses, isLoading } = useStaffCourses();
  const [courseId, setCourseId] = useState('');
  const [assignmentId, setAssignmentId] = useState('');
  const [tab, setTab] = useState<'submissions' | 'rubric' | 'appeals'>('submissions');

  useEffect(() => {
    if (!courseId && courses.length)
      setCourseId(initialCourseId && courses.some((c) => c.id === initialCourseId) ? initialCourseId : courses[0].id);
  }, [courses, courseId]);
  const assignments = useApiData<{ data: Assignment[] }>(courseId ? `/api/v1/courses/${courseId}/assignments` : null);
  const list = useMemo(() => assignments.data?.data ?? [], [assignments.data]);
  useEffect(() => {
    setAssignmentId((cur) => (list.some((a) => a.id === cur) ? cur : (list[0]?.id ?? '')));
  }, [list]);
  const assignment = useMemo(() => list.find((a) => a.id === assignmentId), [list, assignmentId]);

  const isAdmin = user?.role === 'TENANT_ADMIN' || user?.role === 'SUPER_ADMIN';
  const isEditor = isAdmin || user?.role === 'INSTRUCTOR';

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('grading.as.title')}
    >
      <div className="bg-surface border border-line rounded-3xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-brand/20 border border-brand/30 flex items-center justify-center text-brand-fg">
              <ClipboardCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-ink">{t('grading.as.title')}</h3>
              <p className="text-xs text-ink-muted">{t('grading.as.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select className={input} aria-label={t('grading.course')} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.title}
                </option>
              ))}
            </select>
            <select
              className={input}
              aria-label={t('grading.as.assignment')}
              value={assignmentId}
              onChange={(e) => setAssignmentId(e.target.value)}
            >
              {list.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
            <button
              onClick={onClose}
              aria-label={t('grading.close')}
              className="p-1 rounded-xl hover:bg-raised text-ink-muted hover:text-ink"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="bg-canvas/60 border-b border-line px-6 py-2.5 flex gap-2">
          {(['submissions', 'rubric', 'appeals'] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold ${tab === id ? 'bg-brand text-on-brand' : 'text-ink-muted hover:bg-surface'}`}
            >
              {t(`grading.as.tab.${id}`)}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="text-xs text-ink-subtle">{t('grading.loading')}</div>
          ) : !courseId ? (
            <div className="text-xs text-ink-subtle p-10 text-center">{t('grading.noCourse')}</div>
          ) : tab === 'appeals' ? (
            <Appeals key={courseId} courseId={courseId} canResolve={isEditor} />
          ) : !assignment ? (
            <div className="text-xs text-ink-subtle p-10 text-center">{t('grading.as.noAssignments')}</div>
          ) : tab === 'submissions' ? (
            <Submissions key={assignment.id} assignment={assignment} canGrade />
          ) : (
            <RubricEditor key={assignment.id} assignment={assignment} canEdit={isEditor} onSaved={assignments.reload} />
          )}
        </div>
      </div>
    </div>
  );
};
