import { z } from 'zod';
import type { ResponseTable } from './types';
import { CourseListItem, ForumPostRecord, ForumThreadRecord, Pagination } from '../docs';

// Responses of the learning-side routes: courses, enrollments, users, certificates, calendar,
// learning analytics and forum moderation. Checked against the real API by test/contract-learning.test.ts.

const body = <T extends z.ZodTypeAny>(schema: T, status = 200) => ({ status, schema });
const data = <T extends z.ZodTypeAny>(schema: T, status = 200) => ({ status, schema: z.object({ data: schema }) });

const GlobalRole = z.enum(['SUPER_ADMIN', 'TENANT_ADMIN', 'INSTRUCTOR', 'TEACHING_ASSISTANT', 'STUDENT', 'PARENT_GUARDIAN', 'AUDITOR']);
const CourseStatus = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
const EnrollmentStatus = z.enum(['ENROLLED', 'IN_PROGRESS', 'COMPLETED', 'DROPPED', 'FAILED']);

/** A course row as stored. */
export const CourseRecord = z.object({
  id: z.string(),
  tenantId: z.string(),
  departmentId: z.string().nullable(),
  code: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  syllabus: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  status: CourseStatus,
  passingGradePercent: z.number(),
  allowSelfEnroll: z.boolean(),
  /** Gradebook curve: NONE, ADD_POINTS or SCALE_TO_MAX. */
  gradeCurveMethod: z.string(),
  gradeCurveValue: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const LessonRecord = z.object({
  id: z.string(),
  moduleId: z.string(),
  title: z.string(),
  orderIndex: z.number(),
  contentType: z.enum(['RICHTEXT', 'VIDEO', 'SCORM_PACKAGE', 'PDF_DOCUMENT', 'INTERACTIVE_CODE', 'EXTERNAL_LTI_TOOL']),
  bodyContent: z.string().nullable(),
  mediaUrl: z.string().nullable(),
  scormPackageId: z.string().nullable(),
  ltiToolLaunchUrl: z.string().nullable(),
  estimatedMinutes: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ModuleRecord = z.object({
  id: z.string(),
  courseId: z.string(),
  title: z.string(),
  orderIndex: z.number(),
  isLocked: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const ModuleWithLessons = ModuleRecord.extend({ lessons: z.array(LessonRecord) });

const CourseDetailInstructor = CourseListItem.shape.instructors.element;

const CourseDetail = CourseRecord.extend({
  department: z.object({ id: z.string(), campusId: z.string(), name: z.string(), code: z.string(), createdAt: z.string(), updatedAt: z.string() }).nullable(),
  instructors: z.array(CourseDetailInstructor),
  /** Empty while `contentLocked`. */
  modules: z.array(ModuleWithLessons),
  contentLocked: z.boolean(),
  isEnrolled: z.boolean(),
  enrollmentCount: z.number(),
  quizCount: z.number(),
  assignmentCount: z.number(),
  _count: z.object({ enrollments: z.number(), quizzes: z.number(), assignments: z.number() }),
});

const CreatedCourse = CourseRecord.extend({
  /** The creating instructor, as a primary instructor; empty when an administrator creates it. */
  instructors: z.array(
    z.object({
      id: z.string(),
      courseId: z.string(),
      userId: z.string(),
      isPrimary: z.boolean(),
      user: z.object({ id: z.string(), firstName: z.string(), lastName: z.string() }),
    })
  ),
});

const CertificateRecord = z.object({
  id: z.string(),
  enrollmentId: z.string(),
  certificateNumber: z.string(),
  issuedAt: z.string(),
  expiresAt: z.string().nullable(),
  pdfUrl: z.string().nullable(),
  verificationQr: z.string(),
});

const EnrollmentRecord = z.object({
  id: z.string(),
  tenantId: z.string(),
  courseId: z.string(),
  userId: z.string(),
  status: EnrollmentStatus,
  finalGrade: z.number().nullable(),
  progressPercent: z.number(),
  enrolledAt: z.string(),
  completedAt: z.string().nullable(),
});
const CourseRef = z.object({ id: z.string(), code: z.string(), title: z.string() });

const ProgressResult = EnrollmentRecord.extend({
  course: CourseRef,
  /** Issued once the enrollment is COMPLETED; null otherwise. */
  certificate: CertificateRecord.nullable(),
});

const TodoCourse = CourseRef;
const TodoItem = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ASSIGNMENT'),
    id: z.string(),
    title: z.string(),
    course: TodoCourse,
    dueAt: z.string().nullable(),
    overdue: z.boolean(),
    submitted: z.boolean(),
  }),
  z.object({
    type: z.literal('QUIZ'),
    id: z.string(),
    title: z.string(),
    course: TodoCourse,
    dueAt: z.null(),
    timeLimitMins: z.number().nullable(),
    requireProctoring: z.boolean(),
    attemptsRemaining: z.number(),
    hasOpenAttempt: z.boolean(),
  }),
]);

const EnrollmentStats = z.object({
  total: z.number(),
  completed: z.number(),
  inProgress: z.number(),
  enrolled: z.number(),
  dropped: z.number(),
  failed: z.number(),
  averageProgress: z.number(),
});

/** An account as administrators see it. */
export const UserAccount = z.object({
  id: z.string(),
  tenantId: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  avatarUrl: z.string().nullable(),
  role: GlobalRole,
  status: z.enum(['ACTIVE', 'INVITED', 'LOCKED', 'SUSPENDED']),
  emailVerified: z.boolean(),
  idpProvider: z.string().nullable(),
  mfaEnabled: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const UserCounts = z.object({ enrollments: z.number(), teachingCourses: z.number() });
const UserDetail = UserAccount.extend({ _count: UserCounts });
const UserListItem = UserDetail.extend({ enrollmentCount: z.number(), teachingCourseCount: z.number() });

const CourseSummary = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  status: CourseStatus,
  passingGradePercent: z.number(),
});
const UserEnrollment = EnrollmentRecord.extend({
  course: CourseSummary,
  /** No verificationQr here, unlike the enrollment list. */
  certificate: z.object({ id: z.string(), certificateNumber: z.string(), issuedAt: z.string(), pdfUrl: z.string().nullable() }).nullable(),
});

const CertificateVerification = z.object({
  /** False once the certificate has expired. */
  valid: z.boolean(),
  certificateNumber: z.string(),
  issuedAt: z.string(),
  expiresAt: z.string().nullable(),
  /** "First Last"; nothing else about the learner is revealed. */
  issuedTo: z.string(),
  course: z.object({ title: z.string(), code: z.string() }),
  institution: z.string(),
});

export const CalendarEvent = z.object({
  id: z.string(),
  tenantId: z.string(),
  /** Null for tenant-wide events. */
  courseId: z.string().nullable(),
  createdById: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.enum(['EXAM', 'LAB', 'LECTURE', 'OFFICE_HOURS', 'DEADLINE']),
  startsAt: z.string(),
  endsAt: z.string(),
  timezone: z.string(),
  createdAt: z.string(),
});

const ForumFlagRecord = z.object({
  id: z.string(),
  tenantId: z.string(),
  reporterId: z.string(),
  targetType: z.enum(['THREAD', 'POST']),
  targetId: z.string(),
  reason: z.string(),
  resolved: z.boolean(),
  createdAt: z.string(),
});

/** What the moderation queue shows: the report plus the reported text and its thread. */
const ForumFlagView = ForumFlagRecord.extend({
  reporterName: z.string(),
  target: z.object({ threadId: z.string(), threadTitle: z.string(), excerpt: z.string(), hidden: z.boolean() }).nullable(),
});


export const RESPONSES: ResponseTable = {
  // ---- courses
  'POST /api/v1/courses': { response: data(CreatedCourse, 201), errors: [400, 409] },
  'GET /api/v1/courses/departments': {
    response: data(z.array(z.object({ id: z.string(), name: z.string(), code: z.string(), campus: z.string() }))),
    errors: [403],
  },
  'GET /api/v1/courses/:id': {
    response: { ...data(CourseDetail), description: 'Metadata for anyone who can see the course; modules only when content is not locked.' },
    errors: [404],
  },
  'PUT /api/v1/courses/:id': { response: data(CourseRecord), errors: [400, 404] },
  'DELETE /api/v1/courses/:id': {
    response: body(z.object({ message: z.string(), id: z.string(), status: z.literal('ARCHIVED') })),
    errors: [404],
  },
  'GET /api/v1/courses/:id/modules': { response: data(z.array(ModuleWithLessons)), errors: [403, 404] },
  'GET /api/v1/courses/:id/progress': {
    response: data(z.object({ completedLessonIds: z.array(z.string()), totalLessons: z.number(), progressPercent: z.number() })),
    errors: [403, 404],
  },
  'POST /api/v1/courses/:id/lessons/:lessonId/complete': {
    response: data(z.object({ lessonId: z.string(), completedLessons: z.number(), totalLessons: z.number(), progressPercent: z.number() }), 201),
    errors: [403, 404],
  },
  'POST /api/v1/courses/:id/modules': { response: data(ModuleWithLessons, 201), errors: [400, 403, 404] },
  'PUT /api/v1/courses/:id/modules-order': { response: data(z.array(ModuleRecord)), errors: [400, 403, 404] },
  'PATCH /api/v1/courses/:id/modules/:moduleId': { response: data(ModuleWithLessons), errors: [400, 403, 404] },
  'DELETE /api/v1/courses/:id/modules/:moduleId': { response: body(z.object({ message: z.string(), id: z.string() })), errors: [403, 404] },
  'POST /api/v1/courses/:id/modules/:moduleId/lessons': { response: data(LessonRecord, 201), errors: [400, 403, 404] },
  'PATCH /api/v1/courses/:id/lessons/:lessonId': { response: data(LessonRecord), errors: [400, 403, 404] },
  'DELETE /api/v1/courses/:id/lessons/:lessonId': { response: body(z.object({ message: z.string(), id: z.string() })), errors: [403, 404] },

  // ---- enrollments
  'DELETE /api/v1/enrollments/:id': { response: data(z.object({ id: z.string(), status: z.literal('DROPPED') })), errors: [404, 409] },
  'PATCH /api/v1/enrollments/:id/progress': { response: data(ProgressResult), errors: [400, 403, 404, 409] },
  'GET /api/v1/enrollments/stats': { response: data(EnrollmentStats), errors: [400, 403] },
  'GET /api/v1/enrollments/grades': {
    response: data(
      z.array(
        z.object({
          course: z.object({ id: z.string(), code: z.string(), title: z.string(), passingGradePercent: z.number() }),
          status: EnrollmentStatus,
          progressPercent: z.number(),
          /** Only once the course grade is approved. */
          courseGrade: z.object({ letter: z.string().nullable(), percent: z.number().nullable(), approvedAt: z.string().nullable() }).nullable(),
          assignments: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              maxPoints: z.number(),
              dueDate: z.string().nullable(),
              submittedAt: z.string().nullable(),
              late: z.boolean(),
              /** Null until graded. */
              grade: z.number().nullable(),
              feedback: z.string().nullable(),
              gradedAt: z.string().nullable(),
              appealStatus: z.string().nullable(),
            })
          ),
          quizzes: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              attemptsUsed: z.number(),
              maxAttempts: z.number(),
              passingPercent: z.number(),
              bestPercent: z.number().nullable(),
              passed: z.boolean(),
              awaitingManualGrading: z.boolean(),
            })
          ),
        })
      )
    ),
  },
  'GET /api/v1/enrollments/todo': {
    response: { ...data(z.array(TodoItem)), description: 'Up to 20 items: assignments (soonest due first), then quizzes.' },
  },

  // ---- users
  'GET /api/v1/users': { response: body(z.object({ data: z.array(UserListItem), pagination: Pagination })), errors: [400] },
  'POST /api/v1/users/import': {
    response: data(
      z.object({
        dryRun: z.boolean(),
        summary: z.object({ rows: z.number(), toCreate: z.number(), created: z.number(), existing: z.number(), enrolled: z.number(), errors: z.number() }),
        rows: z.array(
          z.object({
            /** Line in the file (the header is line 1). */
            line: z.number(),
            email: z.string(),
            status: z.enum(['CREATE', 'CREATED', 'EXISTS', 'ERROR']),
            message: z.string().nullable(),
            enrol: z.string().nullable(),
          })
        ),
      })
    ),
    errors: [400, 403, 409],
  },
  'POST /api/v1/users': { response: body(z.object({ data: UserAccount, invitationSent: z.boolean(), emailConfigured: z.boolean() }), 201), errors: [400, 403, 409] },
  'POST /api/v1/users/:id/invite': { response: data(z.object({ id: z.string(), invitationSent: z.boolean(), emailConfigured: z.boolean() })), errors: [403, 404, 409] },
  'GET /api/v1/users/:id': { response: data(UserDetail), errors: [403, 404] },
  'PATCH /api/v1/users/:id': { response: data(UserAccount), errors: [400, 403, 404] },
  'GET /api/v1/users/:id/enrollments': {
    response: body(
      z.object({
        user: z.object({ id: z.string(), firstName: z.string(), lastName: z.string(), email: z.string() }),
        data: z.array(UserEnrollment),
      })
    ),
    errors: [400, 403, 404],
  },

  // ---- certificates
  'GET /api/v1/certificates/verify/:number': {
    response: { ...body(CertificateVerification), description: 'Public. Answers 404 for an unknown number or tenant, and 429 when rate limited.' },
    errors: [400, 404, 429],
  },

  // ---- calendar
  'GET /api/v1/calendar/events': {
    response: body(
      z.object({
        data: z.array(CalendarEvent),
        /** The next non-lecture event that has not started yet. */
        nextDeadline: CalendarEvent.nullable(),
      })
    ),
    errors: [400],
  },
  'POST /api/v1/calendar/events': { response: data(CalendarEvent, 201), errors: [400, 403, 404] },
  'PATCH /api/v1/calendar/events/:id': { response: data(CalendarEvent), errors: [400, 403, 404] },
  'DELETE /api/v1/calendar/events/:id': { response: { status: 204, description: 'Deleted' }, errors: [400, 403, 404] },
  'GET /api/v1/calendar/export.ics': {
    response: { status: 200, contentType: 'text/calendar', schema: z.string(), description: 'iCalendar feed of the same events as GET /calendar/events (sent as an attachment).' },
    errors: [400],
  },

  // ---- learning analytics
  'GET /api/v1/analytics/mastery': {
    response: {
      ...data(z.array(z.object({ level: z.enum(['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYZE', 'EVALUATE', 'CREATE']), score: z.number() }))),
      description: "Average score (percent) per Bloom's level; levels without graded answers are omitted.",
    },
  },

  // ---- forum moderation
  'GET /api/v1/courses/:courseId/flags': { response: data(z.array(ForumFlagView)), errors: [400, 403, 404] },
  'POST /api/v1/flags/:id/resolve': { response: data(z.object({ id: z.string(), resolved: z.literal(true) })), errors: [400, 403, 404] },
  'POST /api/v1/posts/:id/endorse': { response: data(z.object({ id: z.string(), endorsed: z.boolean() })), errors: [400, 403, 404] },
  'PATCH /api/v1/posts/:id/moderate': { response: data(ForumPostRecord), errors: [400, 403, 404] },
  'PATCH /api/v1/threads/:id/moderate': { response: data(ForumThreadRecord), errors: [400, 403, 404] },
};

