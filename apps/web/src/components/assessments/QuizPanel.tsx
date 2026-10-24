'use client';

import React, { useState } from 'react';
import { useT } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { quizSettingsProblem, toLocalInput, type QuizSettings as Settings } from '@/lib/assessmentForms';
import { ExtensionsPanel } from './ExtensionsPanel';
import { QuizQuestions } from './QuizQuestions';
import { QuizResults } from './QuizResults';
import { card, danger, ghost, input, primary, tProblem } from './ui';

interface QuizRow {
  id: string;
  title: string;
  timeLimitMins: number | null;
  maxAttempts: number;
  passingPercent: number;
  requireProctoring: boolean;
  questionCount: number;
  submissionCount: number;
  availableFrom?: string | null;
  dueAt?: string | null;
}

interface QuizDetail {
  title: string;
  timeLimitMins: number | null;
  maxAttempts: number;
  passingPercent: number;
  requireProctoring: boolean;
  proctorCamera: boolean;
  proctorMicrophone: boolean;
  randomizeQuestions: boolean;
  availableFrom: string | null;
  dueAt: string | null;
  reviewPolicy: Settings['review'];
}

const defaults: Settings = {
  title: '',
  timed: false,
  minutes: '30',
  attempts: '1',
  passing: '70',
  randomize: false,
  proctoring: false,
  camera: false,
  microphone: false,
  opens: '',
  closes: '',
  review: 'RESPONSES',
};

const fromDetail = (q: QuizDetail): Settings => ({
  title: q.title,
  timed: q.timeLimitMins !== null,
  minutes: String(q.timeLimitMins ?? 30),
  attempts: String(q.maxAttempts),
  passing: String(q.passingPercent),
  randomize: q.randomizeQuestions,
  proctoring: q.requireProctoring,
  camera: q.proctorCamera,
  microphone: q.proctorMicrophone,
  opens: toLocalInput(q.availableFrom),
  closes: toLocalInput(q.dueAt),
  review: q.reviewPolicy,
});

const toBody = (s: Settings) => ({
  title: s.title.trim(),
  timeLimitMins: s.timed ? Number(s.minutes) : null,
  maxAttempts: Number(s.attempts),
  passingPercent: Number(s.passing),
  randomizeQuestions: s.randomize,
  requireProctoring: s.proctoring,
  proctorCamera: s.proctoring && s.camera,
  proctorMicrophone: s.proctoring && s.microphone,
  availableFrom: s.opens ? new Date(s.opens).toISOString() : null,
  dueAt: s.closes ? new Date(s.closes).toISOString() : null,
  reviewPolicy: s.review,
});

const SettingsForm: React.FC<{
  initial: Settings;
  saveLabel: string;
  busy: boolean;
  onSave: (s: Settings) => void;
  onCancel: () => void;
}> = ({ initial, saveLabel, busy, onSave, onCancel }) => {
  const t = useT();
  const [s, setS] = useState(initial);
  const problem = tProblem(t, quizSettingsProblem(s));
  const set = (p: Partial<Settings>) => setS((x) => ({ ...x, ...p }));
  return (
    <form
      className="space-y-3 rounded-2xl border border-brand/40 bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(s);
      }}
    >
      <label className="block space-y-1 text-xs font-semibold text-ink-muted">
        {t('assess.common.title')}
        <input className={`${input} w-full`} maxLength={255} value={s.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('assess.quiz.attempts')}
          <input
            className={`${input} w-full`}
            type="number"
            min={1}
            max={100}
            value={s.attempts}
            onChange={(e) => set({ attempts: e.target.value })}
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('assess.quiz.passing')}
          <input
            className={`${input} w-full`}
            type="number"
            min={0}
            max={100}
            value={s.passing}
            onChange={(e) => set({ passing: e.target.value })}
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('assess.quiz.timeLimit')}
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label={t('assess.quiz.timed')}
              checked={s.timed}
              onChange={(e) => set({ timed: e.target.checked })}
            />
            <input
              className={`${input} w-full`}
              type="number"
              min={1}
              max={1440}
              aria-label={t('assess.quiz.minutes')}
              disabled={!s.timed}
              value={s.minutes}
              onChange={(e) => set({ minutes: e.target.value })}
            />
          </span>
        </label>
        <div className="space-y-1.5 pt-5 text-xs text-ink">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={s.randomize} onChange={(e) => set({ randomize: e.target.checked })} />
            {t('assess.quiz.shuffle')}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={s.proctoring} onChange={(e) => set({ proctoring: e.target.checked })} />
            {t('assess.quiz.proctoring')}
          </label>
          {s.proctoring && (
            <>
              <label className="flex items-center gap-2 pl-5">
                <input type="checkbox" checked={s.camera} onChange={(e) => set({ camera: e.target.checked })} />
                {t('assess.quiz.camera')}
              </label>
              <label className="flex items-center gap-2 pl-5">
                <input type="checkbox" checked={s.microphone} onChange={(e) => set({ microphone: e.target.checked })} />
                {t('assess.quiz.mic')}
              </label>
              {(s.camera || s.microphone) && <p className="pl-5 text-[10px] text-ink-subtle max-w-xs">{t('assess.quiz.proctorNote')}</p>}
            </>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('assess.quiz.opens')}
          <input className={`${input} w-full`} type="datetime-local" value={s.opens} onChange={(e) => set({ opens: e.target.value })} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('assess.quiz.closes')}
          <input className={`${input} w-full`} type="datetime-local" value={s.closes} onChange={(e) => set({ closes: e.target.value })} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('assess.quiz.review')}
          <select className={`${input} w-full`} value={s.review} onChange={(e) => set({ review: e.target.value as Settings['review'] })}>
            <option value="SCORE_ONLY">{t('assess.review.SCORE_ONLY')}</option>
            <option value="RESPONSES">{t('assess.review.RESPONSES')}</option>
            <option value="ANSWERS">{t('assess.review.ANSWERS')}</option>
          </select>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button className={primary} disabled={busy || !!problem}>
          {busy ? t('assess.common.saving') : saveLabel}
        </button>
        <button type="button" className={ghost} onClick={onCancel}>
          {t('assess.common.cancel')}
        </button>
        {problem && <span className="text-[11px] text-accent">{problem}</span>}
      </div>
    </form>
  );
};

/** Loads a quiz's full settings (the list omits the shuffle option) before editing them. */
const EditSettings: React.FC<{ quizId: string; busy: boolean; onSave: (s: Settings) => void; onCancel: () => void }> = ({
  quizId,
  busy,
  onSave,
  onCancel,
}) => {
  const t = useT();
  const detail = useApiData<{ data: QuizDetail }>(`/api/v1/quizzes/${quizId}`);
  if (detail.error) return <Banner kind="error">{detail.error}</Banner>;
  if (!detail.data) return <p className="text-xs text-ink-subtle">{t('assess.common.loading')}</p>;
  return (
    <SettingsForm
      initial={fromDetail(detail.data.data)}
      saveLabel={t('assess.quiz.saveSettings')}
      busy={busy}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
};

type Section = 'questions' | 'results' | 'extensions' | 'settings' | 'delete';

export const QuizPanel: React.FC<{ courseId: string; canEdit: boolean }> = ({ courseId, canEdit }) => {
  const t = useT();
  const list = useApiData<{ data: QuizRow[] }>(`/api/v1/courses/${courseId}/quizzes`);
  const { busy, error, run, clearError } = useAction();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<{ id: string; section: Section } | null>(null);
  const quizzes = list.data?.data ?? [];
  const toggle = (id: string, section: Section) => {
    clearError();
    setOpen((o) => (o && o.id === id && o.section === section ? null : { id, section }));
  };

  const create = (s: Settings) =>
    run(async () => {
      const r = await api.post<{ data: { id: string } }>(`/api/v1/courses/${courseId}/quizzes`, toBody(s));
      setCreating(false);
      await list.reload();
      setOpen({ id: r.data.id, section: 'questions' });
    });

  const update = (id: string, s: Settings) =>
    run(async () => {
      await api.patch(`/api/v1/quizzes/${id}`, toBody(s));
      setOpen(null);
      await list.reload();
    });

  const remove = (id: string) =>
    run(async () => {
      await api.delete(`/api/v1/quizzes/${id}`);
      setOpen(null);
      await list.reload();
    });

  return (
    <div className="space-y-3">
      {(error || list.error) && <Banner kind="error">{error || list.error}</Banner>}
      {list.isLoading && !list.data && <p className="text-xs text-ink-subtle">{t('assess.quiz.loading')}</p>}

      {!list.isLoading && quizzes.length === 0 && !creating && (
        <p className={`${card} text-center text-xs text-ink-muted`}>
          {t('assess.quiz.empty')}
          {canEdit ? ` ${t('assess.quiz.emptyCreate')}` : ''}
        </p>
      )}

      <ul className="space-y-3">
        {quizzes.map((q) => (
          <li key={q.id} className={`${card} space-y-3`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-ink">{q.title}</h4>
                <p className="text-[11px] text-ink-muted">
                  {t.plural('assess.quiz.questions', q.questionCount)} · {t.plural('assess.quiz.attemptsMade', q.submissionCount)} ·{' '}
                  {t('assess.quiz.passAt', { percent: q.passingPercent })} · {t.plural('assess.quiz.allowed', q.maxAttempts)} ·{' '}
                  {q.timeLimitMins ? t('assess.quiz.mins', { minutes: q.timeLimitMins }) : t('assess.quiz.untimed')}
                  {q.requireProctoring ? ` · ${t('assess.quiz.proctored')}` : ''}
                  {q.availableFrom ? ` · ${t('assess.quiz.opensAt', { when: new Date(q.availableFrom).toLocaleString() })}` : ''}
                  {q.dueAt ? ` · ${t('assess.quiz.closesAt', { when: new Date(q.dueAt).toLocaleString() })}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className={ghost}
                  onClick={() => toggle(q.id, 'questions')}
                  aria-expanded={open?.id === q.id && open.section === 'questions'}
                  aria-label={t('assess.quiz.questionsOf', { title: q.title })}
                >
                  {t('assess.quiz.btnQuestions')}
                </button>
                <button
                  className={ghost}
                  onClick={() => toggle(q.id, 'results')}
                  aria-expanded={open?.id === q.id && open.section === 'results'}
                  aria-label={t('assess.quiz.resultsOf', { title: q.title })}
                >
                  {t('assess.quiz.btnResults')}
                </button>
                <button
                  className={ghost}
                  onClick={() => toggle(q.id, 'extensions')}
                  aria-expanded={open?.id === q.id && open.section === 'extensions'}
                  aria-label={t('assess.quiz.extensionsOn', { title: q.title })}
                >
                  {t('assess.common.extensions')}
                </button>
                {canEdit && (
                  <>
                    <button
                      className={ghost}
                      onClick={() => toggle(q.id, 'settings')}
                      aria-label={t('assess.quiz.settingsOf', { title: q.title })}
                    >
                      {t('assess.quiz.btnSettings')}
                    </button>
                    <button
                      className={ghost}
                      onClick={() => toggle(q.id, 'delete')}
                      aria-label={t('assess.quiz.deleteTitle', { title: q.title })}
                    >
                      {t('assess.common.delete')}
                    </button>
                  </>
                )}
              </div>
            </div>

            {open?.id === q.id && open.section === 'questions' && <QuizQuestions quizId={q.id} canEdit={canEdit} onChanged={list.reload} />}
            {open?.id === q.id && open.section === 'results' && <QuizResults quizId={q.id} onChanged={list.reload} />}
            {open?.id === q.id && open.section === 'extensions' && (
              <ExtensionsPanel courseId={courseId} itemType="QUIZ" itemId={q.id} courseDue={q.dueAt ?? null} />
            )}
            {open?.id === q.id && open.section === 'settings' && (
              <EditSettings quizId={q.id} busy={busy} onSave={(s) => update(q.id, s)} onCancel={() => setOpen(null)} />
            )}
            {open?.id === q.id && open.section === 'delete' && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5 text-xs">
                <span className="text-ink">{t.plural('assess.quiz.confirmDelete', q.questionCount, { title: q.title })}</span>
                <button className={danger} disabled={busy} onClick={() => remove(q.id)}>
                  {t('assess.quiz.deleteBtn')}
                </button>
                <button className={ghost} onClick={() => setOpen(null)}>
                  {t('assess.common.keep')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {canEdit &&
        (creating ? (
          <SettingsForm
            initial={defaults}
            saveLabel={t('assess.quiz.createBtn')}
            busy={busy}
            onSave={create}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <button
            className={primary}
            onClick={() => {
              clearError();
              setCreating(true);
            }}
          >
            {t('assess.quiz.new')}
          </button>
        ))}
    </div>
  );
};
