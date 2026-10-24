'use client';

import React, { useEffect, useState } from 'react';
import { X, Plus, Trash2, Sparkles, Save, CheckCircle, Layers, ArrowRight, Sliders, Shield, Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/hooks/useApiData';
import { aiOffText, useAiStatus } from '@/hooks/useAi';
import { useT } from '@/lib/i18n';
import { LessonFields, blankLesson, isHttpUrl, type LessonDraft } from './LessonFields';

export type BuilderLesson = LessonDraft;

export interface BuilderModule {
  id: string;
  title: string;
  lessons: BuilderLesson[];
}

export interface CourseDraft {
  title: string;
  code: string;
  description: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  passingGradePercent: number;
  allowSelfEnroll: boolean;
  modules: BuilderModule[];
}

interface CourseBuilderProps {
  onClose: () => void;
  /** Resolves once the course is saved; rejects with the reason it was not. The builder stays open on rejection. */
  onSave: (course: CourseDraft) => Promise<void>;
}

export const CourseBuilder: React.FC<CourseBuilderProps> = ({ onClose, onSave }) => {
  const t = useT();
  const [courseTitle, setCourseTitle] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [description, setDescription] = useState('');
  const [courseStatus, setCourseStatus] = useState<CourseDraft['status']>('DRAFT');
  const [passingGradePercent, setPassingGradePercent] = useState(70);
  const [allowSelfEnroll, setAllowSelfEnroll] = useState(false);

  const [modules, setModules] = useState<BuilderModule[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const ai = useAiStatus();
  const [aiTopic, setAiTopic] = useState('');
  const [aiAudience, setAiAudience] = useState('');
  const [aiModules, setAiModules] = useState(4);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  /** How many modules the last "Add to course" added (the message is built at render, in the current language). */
  const [aiAdded, setAiAdded] = useState<number | null>(null);
  const [outline, setOutline] = useState<Outline | null>(null);

  const draftOutline = async () => {
    setAiBusy(true);
    setAiError(null);
    setAiAdded(null);
    try {
      const res = await api.post<{ data: Outline }>('/api/v1/ai/course-outline', {
        topic: aiTopic.trim(),
        audience: aiAudience.trim() || undefined,
        moduleCount: aiModules,
      });
      setOutline(res.data);
    } catch (e) {
      setAiError(errorMessage(e, t('builder.new.ai.failed')));
    } finally {
      setAiBusy(false);
    }
  };

  /** Adds the drafted modules after any the instructor already has, and fills empty course fields. */
  const addOutline = () => {
    if (!outline) return;
    const added: BuilderModule[] = outline.modules.map((m, i) => ({
      id: `mod_ai_${Date.now()}_${i}`,
      title: m.title,
      lessons: m.lessons.map((l) => blankLesson({ title: l.title, minutes: l.minutes, body: l.body })),
    }));
    setModules((prev) => [...prev, ...added]);
    if (!courseTitle.trim()) setCourseTitle(outline.title);
    if (!description.trim()) setDescription(outline.description);
    setAiAdded(added.length);
    setOutline(null);
  };

  const addModule = () => {
    setModules([...modules, { id: `mod_${Date.now()}`, title: '', lessons: [blankLesson()] }]);
  };

  const deleteModule = (modId: string) => {
    setModules(modules.filter((m) => m.id !== modId));
  };

  const renameModule = (modId: string, title: string) => {
    setModules(modules.map((m) => (m.id === modId ? { ...m, title } : m)));
  };

  const addLesson = (modId: string) => {
    setModules(modules.map((m) => (m.id === modId ? { ...m, lessons: [...m.lessons, blankLesson()] } : m)));
  };

  const updateLesson = (modId: string, lessonId: string, patch: Partial<BuilderLesson>) => {
    setModules(
      modules.map((m) => (m.id === modId ? { ...m, lessons: m.lessons.map((l) => (l.id === lessonId ? { ...l, ...patch } : l)) } : m))
    );
  };

  const deleteLesson = (modId: string, lessonId: string) => {
    setModules(modules.map((m) => (m.id === modId ? { ...m, lessons: m.lessons.filter((l) => l.id !== lessonId) } : m)));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !isSaving && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, isSaving]);

  const curriculumProblem = modules.some((m) => !m.title.trim() || m.lessons.some((l) => !l.title.trim()))
    ? t('builder.new.problem.title')
    : modules.some((m) => m.lessons.some((l) => l.url.trim() && !isHttpUrl(l.url.trim())))
      ? t('builder.new.problem.url')
      : null;
  const canSave = courseTitle.trim().length >= 3 && courseCode.trim().length >= 2 && !curriculumProblem && !isSaving;

  const save = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave({
        title: courseTitle.trim(),
        code: courseCode.trim(),
        description: description.trim(),
        status: courseStatus,
        passingGradePercent,
        allowSelfEnroll,
        modules,
      });
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t('builder.new.saveFailed'));
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="course-builder-h"
    >
      <div className="bg-surface border border-line rounded-3xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-2xl bg-brand/20 border border-brand/40 flex items-center justify-center text-brand-fg">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h3 id="course-builder-h" className="font-bold text-sm text-ink">
                {t('builder.new.title')}
              </h3>
              <p className="text-[11px] text-ink-muted">{t('builder.new.subtitle')}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={!canSave}
              className="px-5 py-2 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-brand/20 transition-all disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span>{isSaving ? t('builder.new.saving') : t('builder.new.create')}</span>
            </button>
            <button
              onClick={onClose}
              disabled={isSaving}
              aria-label={t('builder.common.close')}
              className="p-1 rounded-xl hover:bg-raised text-ink-muted hover:text-ink transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {saveError && (
          <div role="alert" className="border-b border-danger/30 bg-danger/10 px-6 py-2.5 text-xs font-semibold text-danger">
            {saveError}
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main Course Modules Column */}
          <div className="md:col-span-2 space-y-6">
            {/* Title, Code & Status */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1.5">
                <label htmlFor="course-title" className="text-xs font-semibold text-ink-muted">
                  {t('builder.new.courseTitle')}
                </label>
                <input
                  id="course-title"
                  type="text"
                  value={courseTitle}
                  placeholder={t('builder.new.courseTitlePlaceholder')}
                  maxLength={255}
                  onChange={(e) => setCourseTitle(e.target.value)}
                  className="w-full bg-canvas border border-line rounded-xl px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-brand"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="course-code" className="text-xs font-semibold text-ink-muted">
                  {t('builder.new.courseCode')}
                </label>
                <input
                  id="course-code"
                  type="text"
                  value={courseCode}
                  placeholder={t('builder.new.courseCodePlaceholder')}
                  maxLength={50}
                  onChange={(e) => setCourseCode(e.target.value)}
                  className="w-full bg-canvas border border-line rounded-xl px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-brand font-mono"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="course-description" className="text-xs font-semibold text-ink-muted">
                {t('builder.new.description')} <span className="font-normal text-ink-subtle">{t('builder.new.descriptionHint')}</span>
              </label>
              <textarea
                id="course-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={20000}
                placeholder={t('builder.new.descriptionPlaceholder')}
                className="w-full bg-canvas border border-line rounded-xl px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-brand"
              />
            </div>

            {/* Course Settings Bar */}
            <div className="bg-canvas border border-line rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <label htmlFor="course-status" className="text-ink-muted font-semibold block mb-1">
                  {t('builder.new.publicationStatus')}
                </label>
                <select
                  id="course-status"
                  value={courseStatus}
                  onChange={(e) => setCourseStatus(e.target.value as any)}
                  className="w-full bg-surface border border-line rounded-xl px-3 py-1.5 text-xs text-ink focus:outline-none focus:border-brand font-medium"
                >
                  <option value="DRAFT">{t('builder.statusOption.DRAFT')}</option>
                  <option value="PUBLISHED">{t('builder.statusOption.PUBLISHED')}</option>
                  <option value="ARCHIVED">{t('builder.statusOption.ARCHIVED')}</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between text-ink-muted font-semibold mb-1">
                  <span id="passing-score-label">{t('builder.new.passingScore')}</span>
                  <span className="text-brand-fg">{passingGradePercent}%</span>
                </div>
                <input
                  type="range"
                  aria-labelledby="passing-score-label"
                  aria-valuetext={`${passingGradePercent}%`}
                  min="50"
                  max="100"
                  value={passingGradePercent}
                  onChange={(e) => setPassingGradePercent(Number(e.target.value))}
                  className="w-full accent-brand mt-1"
                />
              </div>

              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowSelfEnroll}
                    onChange={(e) => setAllowSelfEnroll(e.target.checked)}
                    className="rounded bg-surface border-line text-brand-fg"
                  />
                  <span className="text-ink">{t('builder.new.allowSelfEnroll')}</span>
                </label>
              </div>
            </div>

            {/* Modules List */}
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                  {t('builder.new.modulesHeading', { count: t.number(modules.length) })}
                </h4>
                <button onClick={addModule} className="text-xs font-semibold text-brand-fg hover:text-brand-fg flex items-center gap-1">
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t('builder.new.addModule')}</span>
                </button>
              </div>

              {modules.length === 0 && (
                <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-xs text-ink-muted">
                  {ai.enabled ? t('builder.new.noModulesAi') : t('builder.new.noModules')}
                </p>
              )}

              {curriculumProblem && modules.length > 0 && (
                <p role="status" className="text-[11px] font-semibold text-accent">
                  {curriculumProblem}
                </p>
              )}

              {modules.map((mod, modIdx) => (
                <div key={mod.id} className="bg-canvas border border-line rounded-2xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-xs font-bold text-ink-muted">{t('builder.new.moduleN', { n: modIdx + 1 })}</span>
                    <input
                      type="text"
                      value={mod.title}
                      onChange={(e) => renameModule(mod.id, e.target.value)}
                      placeholder={t('builder.new.moduleTitlePlaceholder')}
                      maxLength={255}
                      aria-label={t('builder.new.aria.moduleTitle', { n: modIdx + 1 })}
                      className="min-w-0 flex-1 bg-surface border border-line rounded-xl px-3 py-1.5 text-xs font-bold text-ink focus:outline-none focus:border-brand"
                    />
                    <button
                      onClick={() => addLesson(mod.id)}
                      className="shrink-0 text-[11px] text-brand-fg hover:text-brand-fg font-semibold"
                    >
                      {t('builder.new.addLesson')}
                    </button>
                    <button
                      onClick={() => deleteModule(mod.id)}
                      aria-label={t('builder.new.aria.deleteModule', { n: modIdx + 1 })}
                      className="shrink-0 text-ink-subtle hover:text-danger transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {mod.lessons.length === 0 && <p className="text-[11px] text-ink-subtle">{t('builder.new.noLessons')}</p>}

                  <div className="space-y-2">
                    {mod.lessons.map((les, lesIdx) => (
                      <LessonFields
                        key={les.id}
                        lesson={les}
                        label={t('builder.label.lesson', {
                          lesson: lesIdx + 1,
                          module: t('builder.label.module', { n: modIdx + 1 }),
                        })}
                        onChange={(patch) => updateLesson(mod.id, les.id, patch)}
                        onDelete={() => deleteLesson(mod.id, les.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI outline drafts */}
          <div className="border-t md:border-t-0 md:border-l border-line pt-6 md:pt-0 md:pl-6 space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-brand-fg uppercase tracking-wider">
              <Sparkles className="h-4 w-4" />
              <span>{t('builder.new.ai.heading')}</span>
            </div>

            {!ai.enabled ? (
              <p className="text-xs text-ink-muted">
                {ai.isLoading ? t('builder.new.ai.checking') : ai.reason ? aiOffText(t, ai.reason) : t('builder.new.ai.unavailable')}
              </p>
            ) : (
              <>
                <p className="text-xs text-ink-muted">{t('builder.new.ai.intro')}</p>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder={t('builder.new.ai.topicPlaceholder')}
                    aria-label={t('builder.new.ai.topicLabel')}
                    value={aiTopic}
                    maxLength={300}
                    onChange={(e) => setAiTopic(e.target.value)}
                    className="w-full bg-canvas border border-line rounded-xl p-2.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand"
                  />
                  <input
                    type="text"
                    placeholder={t('builder.new.ai.audiencePlaceholder')}
                    aria-label={t('builder.new.ai.audienceLabel')}
                    value={aiAudience}
                    maxLength={200}
                    onChange={(e) => setAiAudience(e.target.value)}
                    className="w-full bg-canvas border border-line rounded-xl p-2.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand"
                  />
                  <label className="flex items-center justify-between text-xs text-ink-muted">
                    <span>{t('builder.new.ai.modules')}</span>
                    <select
                      value={aiModules}
                      onChange={(e) => setAiModules(Number(e.target.value))}
                      className="bg-canvas border border-line rounded-lg px-2 py-1 text-xs text-ink"
                    >
                      {[2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={aiTopic.trim().length < 3 || aiBusy}
                    onClick={draftOutline}
                    className="w-full py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-semibold shadow-md shadow-brand/20 transition-all"
                  >
                    {aiBusy ? t('builder.new.ai.drafting') : t('builder.new.ai.draft')}
                  </button>
                </div>
              </>
            )}

            {aiError && (
              <p role="alert" className="text-[11px] font-semibold text-danger">
                {aiError}
              </p>
            )}
            {aiAdded !== null && (
              <p role="status" className="text-[11px] font-semibold text-success">
                {t.plural('builder.new.ai.added', aiAdded)}
              </p>
            )}

            {outline && (
              <div className="bg-canvas border border-line rounded-xl p-3.5 text-xs space-y-3 max-h-[28rem] overflow-y-auto">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-ink">{outline.title}</div>
                    <p className="text-[11px] text-ink-muted mt-0.5">{outline.description}</p>
                  </div>
                  <button
                    onClick={addOutline}
                    className="shrink-0 px-2.5 py-1 bg-brand hover:bg-brand-hover text-on-brand rounded-lg text-[10px] font-bold shadow-md"
                  >
                    {t('builder.new.ai.addToCourse')}
                  </button>
                </div>
                <ol className="space-y-2 list-decimal list-inside">
                  {outline.modules.map((m, i) => (
                    <li key={i} className="text-ink font-medium">
                      {m.title}
                      <ul className="mt-1 ml-4 space-y-0.5 list-disc text-[11px] font-normal text-ink-muted">
                        {m.lessons.map((l, j) => (
                          <li key={j}>
                            {l.title} <span className="text-ink-subtle">· {t('builder.new.ai.lessonMinutes', { minutes: l.minutes })}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
                <p className="text-[10px] text-ink-subtle">{t('builder.new.ai.warning')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface Outline {
  title: string;
  description: string;
  modules: { title: string; lessons: { title: string; minutes: number; body: string }[] }[];
}
