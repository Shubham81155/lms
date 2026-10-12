export type UserRole =
  | 'SUPER_ADMIN'
  | 'TENANT_ADMIN'
  | 'INSTRUCTOR'
  | 'TEACHING_ASSISTANT'
  | 'STUDENT'
  | 'PARENT_GUARDIAN'
  | 'AUDITOR';

export type UserStatus = 'ACTIVE' | 'INVITED' | 'LOCKED' | 'SUSPENDED';

export type CourseStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export type EnrollmentStatus =
  | 'ENROLLED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'DROPPED'
  | 'FAILED';

export type ContentType =
  | 'RICHTEXT'
  | 'VIDEO'
  | 'SCORM_PACKAGE'
  | 'PDF_DOCUMENT'
  | 'INTERACTIVE_CODE'
  | 'EXTERNAL_LTI_TOOL';

export type QuestionType =
  | 'MULTIPLE_CHOICE'
  | 'MULTI_SELECT'
  | 'TRUE_FALSE'
  | 'SHORT_ANSWER'
  | 'ESSAY'
  | 'CODE_SANDBOX'
  | 'FORMULA_CALCULATED';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole | string;
  avatarUrl?: string | null;
  status: UserStatus | string;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CourseInstructor {
  id?: string;
  courseId?: string;
  userId?: string;
  isPrimary?: boolean;
  user?: Partial<User>;
  name?: string;
}

export interface Lesson {
  id: string;
  title: string;
  orderIndex: number;
  contentType: ContentType | string;
  bodyContent?: string | null;
  mediaUrl?: string | null;
  estimatedMinutes: number;
  moduleId?: string;
  scormPackageId?: string | null;
  ltiToolLaunchUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Module {
  id: string;
  title: string;
  orderIndex: number;
  isLocked: boolean;
  lessons?: Lesson[];
  courseId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  status: CourseStatus | string;
  passingGradePercent: number;
  thumbnailUrl?: string | null;
  enrolledCount?: number;
  instructors?: CourseInstructor[] | string[];
  modules?: Module[];
  tenantId?: string;
  departmentId?: string | null;
  syllabus?: string | null;
  enableProctoring?: boolean;
  allowSelfEnroll?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Enrollment {
  id: string;
  courseId: string;
  course?: Course;
  userId?: string;
  user?: Partial<User>;
  status: EnrollmentStatus | string;
  progressPercent: number;
  finalGrade?: number | null;
  enrolledAt: string;
  completedAt?: string | null;
}

export interface QuizQuestionOption {
  id: string;
  text: string;
}

export interface QuizQuestion {
  id: string;
  questionText: string;
  questionType: QuestionType | string;
  points: number;
  options?: QuizQuestionOption[] | string[];
  quizId?: string;
  orderIndex?: number;
}

export interface Quiz {
  id: string;
  title: string;
  timeLimitMins?: number | null;
  maxAttempts: number;
  questions?: QuizQuestion[];
  courseId?: string;
  randomizeQuestions?: boolean;
  requireProctoring?: boolean;
  passingPercent?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AssignmentSubmission {
  id: string;
  fileUrl?: string | null;
  submissionText?: string | null;
  grade?: number | null;
  feedback?: string | null;
  plagiarismScore?: number | null;
  assignmentId?: string;
  userId?: string;
  user?: Partial<User>;
  submittedAt?: string;
  gradedAt?: string | null;
}

export interface Assignment {
  id: string;
  title: string;
  instructions: string;
  maxPoints: number;
  dueDate?: string | null;
  courseId?: string;
  submissions?: AssignmentSubmission[];
  createdAt?: string;
  updatedAt?: string;
}

export interface AuditLog {
  id: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  userId?: string | null;
  createdAt: string;
  tenantId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  user?: Partial<User> | null;
  diffJson?: any;
}

export interface TenantConfig {
  id: string;
  name: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  features?: Record<string, boolean>;
  tenantId?: string;
  slug?: string;
  theme?: {
    primaryColor?: string;
    secondaryColor?: string;
    logoUrl?: string;
  };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface DashboardStats {
  totalUsers: number;
  totalCourses: number;
  totalEnrollments: number;
  completionRate: number;
  activeToday: number;
}

export interface EnrollmentStats {
  totalCourses: number;
  inProgress: number;
  completed: number;
  averageGrade: number;
}
