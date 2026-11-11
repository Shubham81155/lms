'use client';

import React, { useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { QuizTaker } from '@/components/QuizTaker';
import { LiveNow } from '@/components/LiveNow';
import { CertificateVerification } from '@/components/CertificateVerification';
import { CodeSandbox } from '@/components/CodeSandbox';
import { CourseCatalog } from '@/components/CourseCatalog';
import { LessonPlayer } from '@/components/LessonPlayer';
import { AcademicCalendar } from '@/components/AcademicCalendar';
import { DiscussionForum } from '@/components/DiscussionForum';
import { MyAssignments } from '@/components/MyAssignments';
import { MyGrades } from '@/components/MyGrades';
import { CourseAnnouncements } from '@/components/CourseAnnouncements';
import { AiTutorModal } from '@/components/AiTutorModal';
import { StudentWelcomeBanner } from '@/components/student/StudentWelcomeBanner';
import { StudentCourseCard } from '@/components/student/StudentCourseCard';
import { StudentTodoSidebar } from '@/components/student/StudentTodoSidebar';
import type { AnnouncementItem, DisplayCourse, TodoItem } from '@/components/student/types';
import { useAuth } from '@/context/AuthContext';
import { useAiStatus } from '@/hooks/useAi';
import { useMyEnrollments, useEnrollmentStats } from '@/hooks/useEnrollments';
import { useOpenIntent } from '@/hooks/useOpenIntent';
import { useApiData } from '@/hooks/useApiData';
import { api } from '@/lib/api';
import { RichText, useT } from '@/lib/i18n';
import type { Enrollment } from '@/lib/types';

type EnrollmentWithCert = Enrollment & { certificate?: { certificateNumber?: string } | null };

export default function StudentDashboard() {
  const [activeQuizId, setActiveQuizId] = useState<string | null>(null);
  const [assignmentsCourse, setAssignmentsCourse] = useState<string | undefined>(undefined);
  const [activeCodingLab, setActiveCodingLab] = useState<{ title: string; instructions: string } | null>(null);
  const [certificate, setCertificate] = useState<string | null>(null);
  const [showCourseCatalog, setShowCourseCatalog] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [showCalendar, setShowCalendar] = useState(false);
  const [showForum, setShowForum] = useState(false);
  const [forumCourseId, setForumCourseId] = useState<string | null>(null);
  const [showAssignments, setShowAssignments] = useState(false);
  const { user } = useAuth();
  const t = useT();
  const [showAiTutor, setShowAiTutor] = useState(false);
  const [activeLessonCourse, setActiveLessonCourse] = useState<{
    id: string;
    code: string;
    title: string;
    startOn?: 'home' | 'lesson';
  } | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [announcementsCourse, setAnnouncementsCourse] = useState<{ id: string; label: string } | null>(null);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [activeNavTab, setActiveNavTab] = useState<string>('courses');

  // Sync tab with URL hash if provided
  React.useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash === '#grades') {
        setActiveNavTab('grades');
      } else if (hash === '#exams') {
        setActiveNavTab('exams');
        const el = document.getElementById('exams-section');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      } else {
        setActiveNavTab('courses');
      }
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const openCatalog = (query: string) => {
    setCatalogQuery(query);
    setShowCourseCatalog(true);
  };

  const handleNavigateTab = (tabKey: string) => {
    setActiveNavTab(tabKey);
    if (tabKey === 'courses' || tabKey === 'grades') {
      window.history.replaceState(null, '', tabKey === 'grades' ? '#grades' : window.location.pathname);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (tabKey === 'exams') {
      const el = document.getElementById('exams-section');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      } else {
        const first = todo.data?.data.find((i) => i.type === 'QUIZ');
        if (first) setActiveQuizId(first.id);
      }
    }
  };

  const { enrollments, isLoading: isLoadingEnrollments, refetch: refetchEnrollments } = useMyEnrollments();
  const { stats } = useEnrollmentStats();
  const ai = useAiStatus();

  const todo = useApiData<{ data: TodoItem[] }>('/api/v1/enrollments/todo');
  const announcements = useApiData<{ data: AnnouncementItem[] }>('/api/v1/announcements/recent', { limit: 5 });

  /** The next quiz this learner can take in a course, if any (from the to-do list). */
  const nextQuizIn = (courseId: string) => todo.data?.data.find((i) => i.type === 'QUIZ' && i.course.id === courseId) ?? null;

  const leaveCourse = async (enrollmentId: string, title: string) => {
    setLeaveBusy(true);
    try {
      await api.delete(`/api/v1/enrollments/${enrollmentId}`);
      setNotification(t('work.student.left', { title }));
      setLeaving(null);
      await refetchEnrollments();
    } catch (e) {
      setNotification(e instanceof Error ? e.message : t('student.leaveError'));
    } finally {
      setLeaveBusy(false);
      setTimeout(() => setNotification(null), 6000);
    }
  };

  const displayCourses: DisplayCourse[] = (enrollments ?? [])
    .filter((e) => e.status !== 'DROPPED')
    .map((e: EnrollmentWithCert) => ({
      id: e.courseId,
      enrollmentId: e.id,
      open: e.status === 'ENROLLED' || e.status === 'IN_PROGRESS',
      code: e.course?.code ?? '',
      title: e.course?.title ?? t('work.student.courseFallback'),
      progress: Math.round(e.progressPercent || 0),
      status: String(e.status).replace(/_/g, ' ').toLowerCase(),
      finalGrade: e.finalGrade ?? null,
      lessons: e.lessons ?? { total: 0, completed: 0 },
      nextLesson: e.nextLesson ?? null,
      certificateNumber: e.certificate?.certificateNumber,
    }));

  // A link from a notification or email can ask for a panel (see lib/deeplink).
  useOpenIntent(!isLoadingEnrollments, {
    course: (id) => {
      const c = displayCourses.find((x) => x.id === id && x.open);
      if (c) setActiveLessonCourse({ id: c.id, code: c.code, title: c.title, startOn: 'home' });
    },
    forum: (id) => {
      setForumCourseId(id);
      setShowForum(true);
    },
    announcements: (id) => {
      const c = displayCourses.find((x) => x.id === id);
      if (c) setAnnouncementsCourse({ id: c.id, label: c.code });
    },
    assignments: (id) => {
      if (id && displayCourses.some((x) => x.id === id)) setAssignmentsCourse(id);
      else setShowAssignments(true);
    },
  });

  return (
    <AppShell
      area="student"
      activeKey={activeNavTab}
      onNavigate={handleNavigateTab}
      search={{ placeholder: t('student.searchCourses'), onSubmit: (q) => openCatalog(q) }}
      actions={{
        catalog: () => openCatalog(''),
        forum: () => setShowForum(true),
        calendar: () => setShowCalendar(true),
        ...(ai.enabled ? { tutor: () => setShowAiTutor(true) } : {}),
      }}
    >
      {notification && (
        <div role="status" className="bg-brand/10 border-b border-brand/30 text-ink px-6 py-2 text-xs text-center">
          {notification}
        </div>
      )}

      {activeNavTab === 'grades' ? (
        <main className="flex-1 max-w-5xl w-full mx-auto p-6 md:p-8">
          <MyGrades onOpenAssignments={(id) => setAssignmentsCourse(id)} />
        </main>
      ) : (
        <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-8">
          <StudentWelcomeBanner
            userName={user?.name}
            tenantName={user?.tenantName}
            stats={stats}
            todoRemainingCount={todo.data ? todo.data.data.filter((i) => !i.submitted).length : null}
            onOpenAssignments={() => setShowAssignments(true)}
          />

          <LiveNow />

          {/* Courses & Schedule Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-brand-fg" />
                  <h2 className="text-lg font-bold text-ink">{t('student.myCourses')}</h2>
                </div>
                <button
                  onClick={() => openCatalog('')}
                  className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-brand/20"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span>{t('student.browse')}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {isLoadingEnrollments && <p className="text-xs text-ink-subtle">{t('student.loadingCourses')}</p>}
                {!isLoadingEnrollments && displayCourses.length === 0 && (
                  <div className="md:col-span-2 text-center text-xs text-ink-muted bg-surface border border-line rounded-2xl p-10">
                    <RichText text={t('student.noCourses')} />
                  </div>
                )}
                {displayCourses.map((course) => (
                  <StudentCourseCard
                    key={course.id}
                    course={course}
                    isLeaving={leaving === course.enrollmentId}
                    leaveBusy={leaveBusy}
                    onOpenHome={() => setActiveLessonCourse({ id: course.id, code: course.code, title: course.title, startOn: 'home' })}
                    onOpenLesson={() => setActiveLessonCourse({ id: course.id, code: course.code, title: course.title })}
                    onOpenForum={() => {
                      setForumCourseId(course.id);
                      setShowForum(true);
                    }}
                    onOpenAssignments={() => setAssignmentsCourse(course.id)}
                    onStartLeave={() => setLeaving(course.enrollmentId)}
                    onConfirmLeave={() => leaveCourse(course.enrollmentId, course.title)}
                    onCancelLeave={() => setLeaving(null)}
                    onOpenCertificate={setCertificate}
                  />
                ))}
              </div>
            </div>

            <StudentTodoSidebar
              todoItems={todo.data?.data ?? null}
              todoLoading={todo.isLoading}
              todoError={todo.error}
              announcements={announcements.data?.data ?? []}
              aiEnabled={ai.enabled}
              onOpenQuiz={setActiveQuizId}
              onOpenAssignments={setAssignmentsCourse}
              onOpenAnnouncements={setAnnouncementsCourse}
              onOpenAiTutor={() => setShowAiTutor(true)}
            />
          </div>
        </main>
      )}

      {/* Modals */}
      {activeQuizId && (
        <QuizTaker
          quizId={activeQuizId}
          onClose={() => {
            setActiveQuizId(null);
            todo.reload();
          }}
        />
      )}

      {certificate && <CertificateVerification certificateNumber={certificate} onClose={() => setCertificate(null)} />}

      {activeCodingLab && (
        <CodeSandbox title={activeCodingLab.title} instructions={activeCodingLab.instructions} onClose={() => setActiveCodingLab(null)} />
      )}

      {showCourseCatalog && (
        <CourseCatalog
          initialQuery={catalogQuery}
          onClose={() => setShowCourseCatalog(false)}
          onEnrolled={() => {
            refetchEnrollments();
            todo.reload();
          }}
        />
      )}

      {activeLessonCourse && (
        <LessonPlayer
          courseId={activeLessonCourse.id}
          courseCode={activeLessonCourse.code}
          courseTitle={activeLessonCourse.title}
          startOn={activeLessonCourse.startOn}
          upcoming={(todo.data?.data ?? []).filter((i) => i.course.id === activeLessonCourse.id && !i.submitted)}
          onOpenWork={(item) => {
            if (item.type === 'QUIZ') setActiveQuizId(item.id);
            else setAssignmentsCourse(activeLessonCourse.id);
            setActiveLessonCourse(null);
          }}
          onClose={() => {
            setActiveLessonCourse(null);
            refetchEnrollments();
          }}
          onOpenExam={
            nextQuizIn(activeLessonCourse.id)
              ? () => {
                  setActiveQuizId(nextQuizIn(activeLessonCourse.id)!.id);
                  setActiveLessonCourse(null);
                }
              : undefined
          }
          onOpenCodeLab={(lab) => {
            setActiveCodingLab({ title: `${activeLessonCourse.code}: ${lab.title}`, instructions: lab.instructions });
            setActiveLessonCourse(null);
          }}
        />
      )}

      {showCalendar && <AcademicCalendar onClose={() => setShowCalendar(false)} />}

      {showForum && (
        <DiscussionForum
          courseCode={displayCourses[0]?.code}
          courseId={forumCourseId}
          onClose={() => {
            setShowForum(false);
            setForumCourseId(null);
          }}
        />
      )}

      {showAssignments && <MyAssignments onClose={() => setShowAssignments(false)} />}
      {assignmentsCourse && (
        <MyAssignments
          courseId={assignmentsCourse}
          onClose={() => {
            setAssignmentsCourse(undefined);
            todo.reload();
          }}
        />
      )}

      {announcementsCourse && (
        <CourseAnnouncements
          courseId={announcementsCourse.id}
          courseLabel={announcementsCourse.label}
          canPost={false}
          onClose={() => setAnnouncementsCourse(null)}
        />
      )}

      {showAiTutor && (
        <AiTutorModal
          courses={displayCourses
            .filter((c) => c.open || c.status === 'completed')
            .map((c) => ({ id: c.id, code: c.code, title: c.title }))}
          onClose={() => setShowAiTutor(false)}
        />
      )}
    </AppShell>
  );
}
