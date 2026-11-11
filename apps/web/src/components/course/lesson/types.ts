export interface UpcomingWork {
  type: 'ASSIGNMENT' | 'QUIZ';
  id: string;
  title: string;
  dueAt: string | null;
  overdue?: boolean;
}

export interface LessonPlayerProps {
  courseId: string;
  courseCode: string;
  courseTitle: string;
  onClose: () => void;
  /** Called with the new course percentage after a lesson is recorded as finished. */
  onProgressUpdated?: (newPercent: number) => void;
  onOpenExam?: () => void;
  onOpenCodeLab?: (lesson: { title: string; instructions: string }) => void;
  /** "home" opens on the course home (overview, syllabus, upcoming work); default is the next lesson. */
  startOn?: 'home' | 'lesson';
  /** The learner's upcoming work in this course, shown on the course home. */
  upcoming?: UpcomingWork[];
  onOpenWork?: (item: UpcomingWork) => void;
}

export type Completion = 'LESSONS_REMAINING' | 'AWAITING_GRADE' | 'BELOW_PASS_MARK' | 'MANUAL' | 'COMPLETED' | 'FAILED' | 'NOT_ENROLLED';

export interface CourseDetail {
  description: string | null;
  syllabus: string | null;
  instructors: { isPrimary: boolean; user: { id: string; firstName: string; lastName: string } }[];
}

export interface Lesson {
  id: string;
  title: string;
  contentType: 'RICHTEXT' | 'VIDEO' | 'SCORM_PACKAGE' | 'PDF_DOCUMENT' | 'INTERACTIVE_CODE' | 'EXTERNAL_LTI_TOOL';
  bodyContent: string | null;
  mediaUrl: string | null;
  ltiToolLaunchUrl: string | null;
  scormPackageId: string | null;
  estimatedMinutes: number;
}

export interface CourseModule {
  id: string;
  title: string;
  lessons: Lesson[];
}

export interface ProgressResponse {
  data: { completedLessonIds: string[]; totalLessons: number; progressPercent: number };
}

export const TYPE_LABEL: Record<Lesson['contentType'], string> = {
  RICHTEXT: 'Reading',
  VIDEO: 'Video',
  SCORM_PACKAGE: 'SCORM module',
  PDF_DOCUMENT: 'Document',
  INTERACTIVE_CODE: 'Code lab',
  EXTERNAL_LTI_TOOL: 'External tool',
};
