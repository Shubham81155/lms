'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Plus, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { typedPut } from '@/lib/typed-api';
import { useAuth } from '@/context/AuthContext';
import { downloadFile, useAction, useApiData } from '@/hooks/useApiData';
import { useStaffCourses } from '@/hooks/useStaffCourses';
import { Banner } from '@/components/admin/IdentityPanels';
import { ScormResults } from '@/components/ScormResults';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useT } from '@/lib/i18n';

interface Category {
  id: string;
  name: string;
  weightPercent: number;
}
interface Item {
  type: 'QUIZ' | 'ASSIGNMENT';
  id: string;
  title: string;
  gradeCategoryId: string | null;
}
type CurveMethod = 'NONE' | 'ADD_POINTS' | 'SCALE_TO_MAX';
interface Config {
  curve: { method: CurveMethod; value: number };
  categories: Category[];
  items: Item[];
}
interface Row {
  userId: string;
  name: string;
  email: string;
  rawPercent: number;
  curvedPercent: number;
  letter: string;
  incomplete: boolean;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED';
  decisionNote: string | null;
}
interface Book {
  data: Row[];
  summary: { total: number; draft: number; submitted: number; approved: number; incomplete: number; average: number | null };
}

const input =
  'bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const primary = 'px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all';
const ghost =
  'px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';

const STATUS_STYLE: Record<Row['status'], string> = {
  DRAFT: 'bg-raised text-ink border-line',
  SUBMITTED: 'bg-accent/10 text-accent border-accent/30',
  APPROVED: 'bg-success/10 text-success border-success/30',
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const CURVE_OPTIONS: CurveMethod[] = ['NONE', 'ADD_POINTS', 'SCALE_TO_MAX'];

// ---------------------------------------------------------------------------
// Setup: categories, items, curve
// ---------------------------------------------------------------------------

const Setup: React.FC<{ courseId: string; canEdit: boolean }> = ({ courseId, canEdit }) => {
  const t = useT();
  const { data, isLoading, error, reload } = useApiData<{ data: Config }>(`/api/v1/courses/${courseId}/gradebook/config`);
  const { busy, error: actionError, run, clearError } = useAction();
  const [cats, setCats] = useState<{ name: string; weight: string }[]>([]);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<CurveMethod>('NONE');
  const [curveValue, setCurveValue] = useState('0');
  const [saved, setSaved] = useState<'categories' | 'items' | 'curve' | null>(null);

  const cfg = data?.data;
  useEffect(() => {
    if (!cfg) return;
    setCats(cfg.categories.map((c) => ({ name: c.name, weight: String(c.weightPercent) })));
    setAssign(Object.fromEntries(cfg.items.map((i) => [`${i.type}:${i.id}`, i.gradeCategoryId ?? ''])));
    setMethod(cfg.curve.method);
    setCurveValue(String(cfg.curve.value ?? 0));
  }, [cfg]);

  const total = round2(cats.reduce((s, c) => s + (Number(c.weight) || 0), 0));
  const totalOk = Math.abs(total - 100) < 0.005;
  const done = (what: 'categories' | 'items' | 'curve') => setSaved(what);

  const saveCategories = () =>
    run(async () => {
      await typedPut(
        '/api/v1/courses/{courseId}/gradebook/categories',
        {
          categories: cats.map((c) => ({ name: c.name.trim(), weightPercent: Number(c.weight) })),
        },
        { courseId }
      );
      await reload();
      done('categories');
    });

  const saveItems = () =>
    run(async () => {
      if (!cfg) return;
      const byName = new Map(cfg.categories.map((c) => [c.id, c.id]));
      await typedPut(
        '/api/v1/courses/{courseId}/gradebook/items',
        {
          items: cfg.items.map((i) => {
            const v = assign[`${i.type}:${i.id}`] ?? '';
            return { type: i.type, id: i.id, categoryId: v && byName.has(v) ? v : null };
          }),
        },
        { courseId }
      );
      await reload();
      done('items');
    });

  const saveCurve = () =>
    run(async () => {
      await typedPut(
        '/api/v1/courses/{courseId}/gradebook/curve',
        { method, value: method === 'NONE' ? 0 : Number(curveValue) },
        { courseId }
      );
      await reload();
      done('curve');
    });

  if (isLoading) return <div className="text-xs text-ink-subtle p-6">{t('grading.loading')}</div>;
  if (error) return <Banner kind="error">{error}</Banner>;
  if (!cfg) return null;

  return (
    <div
      className="space-y-8"
      onChange={() => {
        clearError();
        setSaved(null);
      }}
    >
      {actionError && <Banner kind="error">{actionError}</Banner>}
      {saved && <Banner kind="ok">{t('grading.gb.savedBanner', { saved: t(`grading.gb.saved.${saved}`) })}</Banner>}
      {!canEdit && <Banner kind="error">{t('grading.gb.taReadOnly')}</Banner>}

      <section className="space-y-3" aria-labelledby="cat-h">
        <div className="flex items-center justify-between">
          <h4 id="cat-h" className="text-xs font-bold uppercase tracking-wider text-ink">
            {t('grading.gb.categories')}
          </h4>
          <span className={`text-xs font-mono ${totalOk ? 'text-success' : 'text-danger'}`}>
            {t('grading.gb.total', { total: t.number(total) })} {totalOk ? '✓' : t('grading.gb.mustBe100')}
          </span>
        </div>
        {cats.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className={`${input} flex-1`}
              aria-label={t('grading.gb.catName', { n: i + 1 })}
              value={c.name}
              disabled={!canEdit}
              placeholder={t('grading.gb.catPlaceholder')}
              onChange={(e) => setCats((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <input
              className={`${input} w-24`}
              aria-label={t('grading.gb.catWeight', { n: i + 1 })}
              type="number"
              min={0.01}
              max={100}
              step="0.01"
              value={c.weight}
              disabled={!canEdit}
              onChange={(e) => setCats((p) => p.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))}
            />
            <span className="text-xs text-ink-subtle">%</span>
            <button
              className={ghost}
              disabled={!canEdit}
              aria-label={t('grading.gb.catRemove', { n: i + 1 })}
              onClick={() => setCats((p) => p.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <button className={ghost} disabled={!canEdit} onClick={() => setCats((p) => [...p, { name: '', weight: '' }])}>
            <Plus className="h-3 w-3 inline mr-1" />
            {t('grading.gb.addCategory')}
          </button>
          <button className={primary} disabled={!canEdit || busy || !totalOk || cats.some((c) => !c.name.trim())} onClick={saveCategories}>
            {t('grading.gb.saveCategories')}
          </button>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="items-h">
        <h4 id="items-h" className="text-xs font-bold uppercase tracking-wider text-ink">
          {t('grading.gb.whichWork')}
        </h4>
        {cfg.items.length === 0 && <p className="text-xs text-ink-subtle">{t('grading.gb.noItems')}</p>}
        {cfg.items.map((i) => (
          <div
            key={`${i.type}:${i.id}`}
            className="flex items-center justify-between gap-3 bg-canvas border border-line rounded-xl px-3 py-2"
          >
            <div className="text-xs text-ink">
              <span className="text-[10px] font-bold text-ink-subtle mr-2">{t.dyn(`grading.type.${i.type}`, i.type)}</span>
              {i.title}
            </div>
            <select
              className={input}
              aria-label={t('grading.gb.categoryFor', { title: i.title })}
              disabled={!canEdit}
              value={assign[`${i.type}:${i.id}`] ?? ''}
              onChange={(e) => setAssign((p) => ({ ...p, [`${i.type}:${i.id}`]: e.target.value }))}
            >
              <option value="">{t('grading.gb.notGraded')}</option>
              {cfg.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ))}
        {cfg.items.length > 0 && (
          <button className={primary} disabled={!canEdit || busy || cfg.categories.length === 0} onClick={saveItems}>
            {t('grading.gb.saveItems')}
          </button>
        )}
        {cfg.categories.length === 0 && cfg.items.length > 0 && (
          <p className="text-[11px] text-ink-subtle">{t('grading.gb.saveCategoriesFirst')}</p>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="curve-h">
        <h4 id="curve-h" className="text-xs font-bold uppercase tracking-wider text-ink">
          {t('grading.gb.curve')}
        </h4>
        <div className="flex items-center gap-2">
          <select
            className={input}
            aria-label={t('grading.gb.curveMethod')}
            disabled={!canEdit}
            value={method}
            onChange={(e) => setMethod(e.target.value as CurveMethod)}
          >
            {CURVE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {t(`grading.gb.curve.${m}`)}
              </option>
            ))}
          </select>
          {method === 'ADD_POINTS' && (
            <input
              className={`${input} w-24`}
              aria-label={t('grading.gb.pointsToAdd')}
              type="number"
              min={0.5}
              max={50}
              step="0.5"
              value={curveValue}
              disabled={!canEdit}
              onChange={(e) => setCurveValue(e.target.value)}
            />
          )}
          <button
            className={primary}
            disabled={!canEdit || busy || (method === 'ADD_POINTS' && !(Number(curveValue) > 0))}
            onClick={saveCurve}
          >
            {t('grading.gb.saveCurve')}
          </button>
        </div>
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Grades and approval
// ---------------------------------------------------------------------------

const Grades: React.FC<{ courseId: string; canEdit: boolean; isAdmin: boolean }> = ({ courseId, canEdit, isAdmin }) => {
  const t = useT();
  const { data, isLoading, error, reload } = useApiData<Book>(`/api/v1/courses/${courseId}/gradebook`);
  const { busy, error: actionError, run } = useAction();
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const base = `/api/v1/courses/${courseId}/gradebook`;

  const act = (path: string, body: unknown, done: (r: any) => string) =>
    run(async () => {
      const r = await api.post<any>(`${base}/${path}`, body);
      setMsg(done(r.data));
      await reload();
    });

  const s = data?.summary;
  const submit = () => {
    if (s && s.incomplete > 0 && !window.confirm(t.plural('grading.gb.confirmSubmit', s.incomplete))) return;
    act('submit', { allowIncomplete: !!s && s.incomplete > 0 }, (r) => t.plural('grading.gb.submittedDone', r.submitted));
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
            className={primary}
            disabled={busy}
            onClick={() =>
              act('calculate', undefined, (r) =>
                r.skippedApproved
                  ? t('grading.gb.calcSkipped', {
                      calc: t.plural('grading.gb.calc', r.calculated),
                      skipped: t.plural('grading.gb.skipped', r.skippedApproved),
                    })
                  : t('grading.gb.calcDone', { calc: t.plural('grading.gb.calc', r.calculated) })
              )
            }
          >
            {t('grading.gb.calculate')}
          </button>
        )}
        {canEdit && (
          <button className={ghost} disabled={busy || !s?.draft} onClick={submit}>
            {t('grading.gb.submitForApproval')}
          </button>
        )}
        {isAdmin && (
          <button
            className={ghost}
            disabled={busy || !s?.submitted}
            onClick={() =>
              act('approve', undefined, (r) =>
                r.completed
                  ? t('grading.gb.approveCompleted', {
                      approved: t.plural('grading.gb.approved', r.approved),
                      completed: t.plural('grading.gb.completed', r.completed),
                    })
                  : t('grading.gb.approveDone', { approved: t.plural('grading.gb.approved', r.approved) })
              )
            }
          >
            {t('grading.gb.approve')}
          </button>
        )}
        {isAdmin && (
          <button className={ghost} disabled={busy || !s?.submitted} onClick={() => setRejecting((v) => !v)}>
            {t('grading.gb.sendBackOpen')}
          </button>
        )}
        {isAdmin && (
          <button
            className={ghost}
            disabled={busy || !s?.approved}
            onClick={() =>
              window.confirm(t('grading.gb.reopenConfirm')) && act('reopen', undefined, (r) => t.plural('grading.gb.reopened', r.reopened))
            }
          >
            {t('grading.gb.reopen')}
          </button>
        )}
      </div>

      {rejecting && (
        <div className="flex items-center gap-2">
          <input
            className={`${input} flex-1`}
            aria-label={t('grading.gb.reasonLabel')}
            placeholder={t('grading.gb.reasonPlaceholder')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className={primary}
            disabled={busy || note.trim().length < 3}
            onClick={() =>
              act('reject', { note: note.trim() }, (r) => t.plural('grading.gb.returned', r.returned)).then(() => {
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

// ---------------------------------------------------------------------------
// Grid: every learner against every quiz and assignment
// ---------------------------------------------------------------------------

interface Score {
  percent: number | null;
  pending: boolean;
  missing: boolean;
}
interface GridData {
  items: { id: string; type: 'QUIZ' | 'ASSIGNMENT'; title: string; category: string | null }[];
  learners: {
    userId: string;
    name: string;
    email: string;
    scores: Record<string, Score>;
    courseGrade: { rawPercent: number; curvedPercent: number; letter: string; status: Row['status'] } | null;
  }[];
}

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

const Grid: React.FC<{ courseId: string; courseCode: string }> = ({ courseId, courseCode }) => {
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
        <button className={ghost} disabled={busy || grid.learners.length === 0} onClick={exportCsv}>
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

// ---------------------------------------------------------------------------

export const CourseGradebook: React.FC<{
  onClose: () => void;
  /** Open on this course when the person may use it. */ initialCourseId?: string | null;
}> = ({ onClose, initialCourseId }) => {
  const t = useT();
  useEscapeKey(onClose);
  const { user } = useAuth();
  const { courses, isLoading } = useStaffCourses();
  const [courseId, setCourseId] = useState<string>('');
  const [tab, setTab] = useState<'grades' | 'grid' | 'scorm' | 'setup'>('grades');

  useEffect(() => {
    if (!courseId && courses.length > 0)
      setCourseId(initialCourseId && courses.some((c) => c.id === initialCourseId) ? initialCourseId : courses[0].id);
  }, [courses, courseId]);

  const isAdmin = user?.role === 'TENANT_ADMIN' || user?.role === 'SUPER_ADMIN';
  const canEdit = isAdmin || user?.role === 'INSTRUCTOR';
  const course = useMemo(() => courses.find((c) => c.id === courseId), [courses, courseId]);

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('grading.gb.title')}
    >
      <div className="bg-surface border border-line rounded-3xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-success/20 border border-success/30 flex items-center justify-center text-success">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-ink">{t('grading.gb.title')}</h3>
              <p className="text-xs text-ink-muted">{t('grading.gb.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <select className={input} aria-label={t('grading.course')} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.title}
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
          {(['grades', 'grid', 'scorm', 'setup'] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold ${tab === id ? 'bg-brand text-on-brand' : 'text-ink-muted hover:bg-surface'}`}
            >
              {t(`grading.gb.tab.${id}`)}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="text-xs text-ink-subtle">{t('grading.gb.loadingCourses')}</div>
          ) : !course ? (
            <div className="text-xs text-ink-subtle p-10 text-center">{t('grading.noCourse')}</div>
          ) : tab === 'grades' ? (
            <Grades key={course.id} courseId={course.id} canEdit={canEdit} isAdmin={isAdmin} />
          ) : tab === 'grid' ? (
            <Grid key={course.id} courseId={course.id} courseCode={course.code} />
          ) : tab === 'scorm' ? (
            <ScormResults key={course.id} courseId={course.id} />
          ) : (
            <Setup key={course.id} courseId={course.id} canEdit={canEdit} />
          )}
        </div>
      </div>
    </div>
  );
};
