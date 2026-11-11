export interface TodoItem {
  type: 'ASSIGNMENT' | 'QUIZ';
  id: string;
  title: string;
  course: { id: string; code: string; title: string };
  dueAt: string | null;
  overdue?: boolean;
  submitted?: boolean;
  requireProctoring?: boolean;
  attemptsRemaining?: number;
  hasOpenAttempt?: boolean;
  extended?: boolean;
  opensAt?: string | null;
}

export interface DisplayCourse {
  id: string;
  enrollmentId: string;
  open: boolean;
  code: string;
  title: string;
  progress: number;
  status: string;
  finalGrade: number | null;
  lessons: { total: number; completed: number };
  nextLesson: { id: string; title: string; moduleTitle: string } | null;
  certificateNumber?: string;
}

export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  course: { id: string; code: string; title: string };
}
