'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, Search, BookOpen, CheckCircle2, Clock, Award, Layers, Lock, User } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage, useApiData } from '@/hooks/useApiData';
import { useMyEnrollments } from '@/hooks/useEnrollments';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useT } from '@/lib/i18n';

interface CourseCatalogProps {
  onClose: () => void;
  /** Pre-fills the search box, e.g. from the top-bar search. */
  initialQuery?: string;
  /** Called after the server accepted the enrolment. */
  onEnrolled?: (courseId: string) => void;
}

interface CatalogCourse {
  id: string;
  code: string;
  title: string;
  description: string | null;
  syllabus: string | null;
  passingGradePercent: number;
  allowSelfEnroll: boolean;
  moduleCount: number;
  lessonCount: number;
  estimatedMinutes: number;
  department: { id: string; name: string } | null;
  instructors: { isPrimary: boolean; user: { firstName: string; lastName: string } }[];
}

/** Published courses from the server, searched server-side; enrolment errors are shown as they are. */
export const CourseCatalog: React.FC<CourseCatalogProps> = ({ onClose, onEnrolled, initialQuery = '' }) => {
  useEscapeKey(onClose);
  const t = useT();
  const studyTime = (minutes: number) =>
    minutes < 60
      ? t('work.catalog.minutes', { n: t.number(minutes) })
      : t('work.catalog.hours', { n: t.number(Math.round((minutes / 60) * 10) / 10) });
  const [query, setQuery] = useState(initialQuery);
  const [search, setSearch] = useState(initialQuery.trim());
  const [department, setDepartment] = useState<string>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Search on the server once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isLoading, error } = useApiData<{ data: CatalogCourse[]; pagination: { total: number } }>('/api/v1/courses', {
    limit: 100,
    status: 'PUBLISHED',
    search: search || undefined,
  });
  const { enrollments, refetch: refetchEnrollments } = useMyEnrollments();

  const courses = useMemo(() => data?.data ?? [], [data]);
  const departments = useMemo(
    () => Array.from(new Set(courses.map((c) => c.department?.name).filter((d): d is string => !!d))).sort(),
    [courses]
  );
  const shown = department === 'ALL' ? courses : courses.filter((c) => c.department?.name === department);
  const selected = shown.find((c) => c.id === selectedId) ?? shown[0] ?? null;

  const enrolment = (courseId: string) =>
    (enrollments ?? []).find((e) => (e.courseId || e.course?.id) === courseId && e.status !== 'DROPPED');

  const enroll = async (course: CatalogCourse) => {
    setEnrolling(true);
    setResult(null);
    try {
      await api.post('/api/v1/enrollments', { courseId: course.id });
      await refetchEnrollments();
      setResult({ ok: true, text: t('work.catalog.enrolledOk', { title: course.title }) });
      onEnrolled?.(course.id);
    } catch (e) {
      setResult({ ok: false, text: errorMessage(e, t('work.catalog.enrolError')) });
    } finally {
      setEnrolling(false);
    }
  };

  const total = data?.pagination.total ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="catalog-h"
    >
      <div className="bg-surface border border-line rounded-3xl w-full max-w-6xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-brand/20 border border-brand/30 flex items-center justify-center text-brand-fg">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h3 id="catalog-h" className="font-bold text-base text-ink">
                {t('work.catalog.title')}
              </h3>
              <p className="text-xs text-ink-muted">
                {isLoading
                  ? t('common.loading')
                  : `${t.plural('work.catalog.count', total)}${search ? t('work.catalog.matching', { query: search }) : ''}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="h-8 w-8 rounded-xl bg-surface hover:bg-raised border border-line flex items-center justify-center text-ink-muted hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {result && (
          <div
            role={result.ok ? 'status' : 'alert'}
            className={`border-b px-6 py-2.5 text-xs font-medium ${result.ok ? 'bg-success/10 border-success/30 text-success' : 'bg-danger/10 border-danger/30 text-danger'}`}
          >
            {result.text}
          </div>
        )}

        <div className="bg-surface/90 border-b border-line px-6 py-3 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative flex-1 w-full md:max-w-md">
            <Search className="h-4 w-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              placeholder={t('work.catalog.searchPlaceholder')}
              aria-label={t('work.catalog.searchLabel')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-canvas border border-line rounded-xl pl-10 pr-4 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand"
            />
          </div>
          {departments.length > 0 && (
            <div
              className="flex items-center gap-2 w-full md:w-auto overflow-x-auto"
              role="group"
              aria-label={t('work.catalog.filterLabel')}
            >
              {['ALL', ...departments].map((d) => (
                <button
                  key={d}
                  onClick={() => setDepartment(d)}
                  aria-pressed={department === d}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap ${department === d ? 'bg-brand text-on-brand' : 'bg-canvas text-ink-muted hover:text-ink border border-line'}`}
                >
                  {d === 'ALL' ? t('work.catalog.allDepartments') : d}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          <div className="w-full md:w-1/2 border-r border-line overflow-y-auto p-5 space-y-3">
            {error && (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
            {!error && shown.length === 0 && (
              <p className="p-8 text-center text-ink-muted text-xs">
                {isLoading ? t('work.catalog.loadingCourses') : search ? t('work.catalog.noMatch') : t('work.catalog.noneYet')}
              </p>
            )}
            {shown.map((course) => {
              const mine = enrolment(course.id);
              const isSelected = selected?.id === course.id;
              return (
                <button
                  key={course.id}
                  onClick={() => setSelectedId(course.id)}
                  aria-current={isSelected}
                  className={`w-full text-left p-4 rounded-2xl border transition-all ${isSelected ? 'bg-brand/15 border-brand/60' : 'bg-canvas/80 border-line/80 hover:border-line'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-lg bg-brand/15 text-brand-fg border border-brand/50">
                      {course.code}
                    </span>
                    {mine ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-success/10 text-success border border-success/30 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {t('work.catalog.enrolled')}
                      </span>
                    ) : (
                      !course.allowSelfEnroll && (
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-surface border border-line text-ink-muted flex items-center gap-1">
                          <Lock className="h-3 w-3" />
                          {t('work.catalog.invitation')}
                        </span>
                      )
                    )}
                  </div>
                  <h4 className="font-bold text-sm text-ink mt-2 line-clamp-1">{course.title}</h4>
                  {course.description && <p className="text-xs text-ink-muted mt-1 line-clamp-2">{course.description}</p>}
                  <div className="flex items-center justify-between text-[11px] text-ink-subtle mt-3 pt-2 border-t border-line">
                    <span>{course.department?.name ?? ''}</span>
                    <span>
                      {t.plural('work.catalog.module', course.moduleCount)}
                      {course.estimatedMinutes > 0 ? ` · ${studyTime(course.estimatedMinutes)}` : ''}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="w-full md:w-1/2 p-6 overflow-y-auto bg-surface/50 flex flex-col justify-between gap-6">
              <div className="space-y-6">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-lg bg-brand/15 text-brand-fg border border-brand/50">
                      {selected.code}
                    </span>
                    {selected.department && <span className="text-xs text-ink-muted">{selected.department.name}</span>}
                  </div>
                  <h2 className="text-2xl font-extrabold text-ink tracking-tight">{selected.title}</h2>
                  {selected.instructors.length > 0 && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                      <User className="h-3.5 w-3.5" />
                      {selected.instructors.map((i) => `${i.user.firstName} ${i.user.lastName}`).join(', ')}
                    </p>
                  )}
                  <p className="text-xs text-ink mt-3 leading-relaxed whitespace-pre-line">
                    {selected.description || t('work.catalog.noDescription')}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {[
                    {
                      icon: Clock,
                      label: t('work.catalog.studyTime'),
                      value: selected.estimatedMinutes > 0 ? studyTime(selected.estimatedMinutes) : '–',
                    },
                    {
                      icon: Layers,
                      label: t('work.catalog.contentLabel'),
                      value: t('work.catalog.content', {
                        modules: t.plural('work.catalog.module', selected.moduleCount),
                        lessons: t.plural('work.catalog.lesson', selected.lessonCount),
                      }),
                    },
                    { icon: Award, label: t('work.catalog.passMark'), value: `${selected.passingGradePercent}%` },
                  ].map(({ icon: Icon, label, value }) => (
                    <div key={label} className="bg-canvas border border-line p-3 rounded-2xl text-center">
                      <Icon className="h-4 w-4 text-brand-fg mx-auto mb-1" />
                      <div className="text-[10px] text-ink-muted">{label}</div>
                      <div className="text-xs font-bold text-ink mt-0.5">{value}</div>
                    </div>
                  ))}
                </div>

                {selected.syllabus && (
                  <div className="bg-canvas border border-line rounded-2xl p-4 space-y-2">
                    <h4 className="text-xs font-bold text-ink uppercase tracking-wider">{t('work.catalog.syllabus')}</h4>
                    <p className="text-xs text-ink whitespace-pre-line leading-relaxed">{selected.syllabus}</p>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-line flex items-center justify-between gap-4">
                <p className="text-xs text-ink-muted">
                  {enrolment(selected.id)
                    ? t('work.catalog.hintEnrolled')
                    : selected.allowSelfEnroll
                      ? t('work.catalog.hintOpen')
                      : t('work.catalog.hintInvite')}
                </p>
                {enrolment(selected.id) ? (
                  <span className="px-5 py-2.5 bg-raised text-success border border-success/30 rounded-xl text-xs font-bold flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    {t('work.catalog.enrolled')}
                  </span>
                ) : (
                  selected.allowSelfEnroll && (
                    <button
                      onClick={() => enroll(selected)}
                      disabled={enrolling}
                      className="px-5 py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold shadow-lg shadow-brand/20"
                    >
                      {enrolling ? t('work.catalog.enrolling') : t('work.catalog.enrol')}
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
