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
    /** The learner's own due date: an extension replaces the course-wide one. */
    dueAt: z.string().nullable(),
    extended: z.boolean(),
    overdue: z.boolean(),
    submitted: z.boolean(),
  }),
  z.object({
    type: z.literal('QUIZ'),
    id: z.string(),
    title: z.string(),
    course: TodoCourse,
    /** When the quiz closes for this learner (extension included); null: no close. */
    dueAt: z.string().nullable(),
    extended: z.boolean(),
    /** Set while the quiz has not opened yet. */
    opensAt: z.string().nullable(),
    timeLimitMins: z.number().nullable(),
    requireProctoring: z.boolean(),
    attemptsRemaining: z.number(),
    hasOpenAttempt: z.boolean(),
  }),
]);

const AnnouncementView = z.object({
  id: z.string(),
  courseId: z.string(),
  title: z.string(),
  body: z.string(),
  pinned: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Null when the author's account was deleted. */
  author: z.object({ id: z.string(), name: z.string() }).nullable(),
});

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

export const ScormPackageView = z.object({
  id: z.string(), courseId: z.string(), title: z.string(), version: z.enum(['1.2', '2004']),
  /** The start page, relative to the package root. */
  launchPath: z.string(),
  fileCount: z.number(), sizeBytes: z.number(), createdAt: z.string(),
});

export const TermView = z.object({ id: z.string(), name: z.string(), startsOn: z.string(), endsOn: z.string(), courseCount: z.number() });

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

/**
 * A calendar entry as listed: a stored event (source EVENT), or a quiz or assignment due date worked out
 * on read (source QUIZ or ASSIGNMENT; read-only, id "quiz-<id>" or "assignment-<id>", startsAt = endsAt =
 * the caller's own due date, extension included).
 */
export const CalendarEntry = CalendarEvent.extend({
  /** Null for due-date entries. */
  createdById: z.string().nullable(),
  source: z.enum(['EVENT', 'QUIZ', 'ASSIGNMENT']),
  /** The quiz or assignment id; null for stored events. */
  itemId: z.string().nullable(),
  /** The caller has an extension that moves this due date. */
  extended: z.boolean(),
  /** The caller has submitted the assignment or used every quiz attempt. */
  completed: z.boolean(),
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
    response: data(
      z.object({
        lessonId: z.string(),
        completedLessons: z.number(),
        totalLessons: z.number(),
        progressPercent: z.number(),
        /**
         * Where the course stands: AWAITING_GRADE means every lesson is done and the final grade is not approved
         * yet; BELOW_PASS_MARK that the approved grade is below the pass mark; MANUAL that the course has no
         * lessons, so staff record completion.
         */
        completion: z.enum(['LESSONS_REMAINING', 'AWAITING_GRADE', 'BELOW_PASS_MARK', 'MANUAL', 'COMPLETED', 'FAILED', 'NOT_ENROLLED']),
      }),
      201
    ),
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
  'GET /api/v1/courses/:courseId/announcements': { response: body(z.object({ data: z.array(AnnouncementView), pagination: Pagination })), errors: [400, 403, 404] },
  'GET /scorm-content/:token/__launch': {
    response: { status: 200, contentType: 'text/html', schema: z.string(), description: 'The player page.' },
    errors: [403, 404],
  },
  'GET /scorm-content/:token/__state': { response: body(z.object({ cmi: z.record(z.string()) })), errors: [403, 404] },
  'POST /scorm-content/:token/__commit': {
    response: body(z.object({ status: z.string(), scorePercent: z.number().nullable(), completed: z.boolean() })),
    errors: [400, 403, 404],
  },
  'GET /scorm-content/:token/*': {
    response: { status: 200, contentType: 'application/octet-stream', schema: z.string(), description: 'The file, with its own Content-Type.' },
    errors: [403, 404],
  },
  'POST /api/v1/courses/:id/scorm-packages': { response: data(ScormPackageView, 201), errors: [400, 403, 404, 409] },
  'GET /api/v1/courses/:id/scorm-packages': { response: data(z.array(ScormPackageView)), errors: [403, 404] },
  'GET /api/v1/scorm-packages/:id/launch': {
    response: data(z.object({ url: z.string(), origin: z.string(), version: z.enum(['1.2', '2004']) })),
    errors: [400, 403, 404, 409],
  },
  'GET /api/v1/scorm-packages/:id/attempts': {
    response: data(
      z.array(
        z.object({
          userId: z.string(), name: z.string(), email: z.string(),
          /** not attempted | incomplete | completed | passed | failed | unknown */
          status: z.string(),
          scorePercent: z.number().nullable(), completedAt: z.string().nullable(),
          /** Null for an enrolled learner who has not opened the package. */
          updatedAt: z.string().nullable(),
        })
      )
    ),
    errors: [400, 403, 404],
  },
  'GET /api/v1/admin/course-approval': { response: data(z.object({ required: z.boolean() })) },
  'PUT /api/v1/admin/course-approval': { response: data(z.object({ required: z.boolean() })), errors: [400] },
  'GET /api/v1/course-reviews': {
    response: data(
      z.array(
        z.object({
          id: z.string(), code: z.string(), title: z.string(), term: z.string().nullable(),
          /** The submitter's message, if any. */
          message: z.string().nullable(),
          submittedAt: z.string().nullable(), submittedBy: z.string().nullable(),
          counts: z.object({ modules: z.number(), quizzes: z.number(), assignments: z.number() }),
        })
      )
    ),
  },
  'POST /api/v1/courses/:id/review/submit': { response: data(z.object({ id: z.string(), reviewStatus: z.literal('PENDING'), submittedAt: z.string() })), errors: [400, 403, 404, 409] },
  'POST /api/v1/courses/:id/review/approve': { response: data(z.object({ id: z.string(), status: z.literal('PUBLISHED'), reviewedAt: z.string() })), errors: [400, 404, 409] },
  'POST /api/v1/courses/:id/review/request-changes': {
    response: data(z.object({ id: z.string(), reviewStatus: z.literal('CHANGES_REQUESTED'), note: z.string(), reviewedAt: z.string() })),
    errors: [400, 404, 409],
  },
  'GET /api/v1/terms': { response: data(z.array(TermView)) },
  'POST /api/v1/terms': { response: data(TermView, 201), errors: [400, 409] },
  'PATCH /api/v1/terms/:id': { response: data(TermView), errors: [400, 404, 409] },
  'DELETE /api/v1/terms/:id': { response: { status: 204, description: 'Deleted' }, errors: [400, 404, 409] },
  'POST /api/v1/courses/:id/copy': {
    response: data(
      z.object({
        course: z.object({ id: z.string(), code: z.string(), title: z.string(), status: z.literal('DRAFT'), termId: z.string().nullable() }),
        /** How many days due dates and quiz windows moved. */
        shiftDays: z.number(),
        copied: z.object({
          modules: z.number(), lessons: z.number(), quizzes: z.number(), questions: z.number(), assignments: z.number(),
          gradeCategories: z.number(), questionBankItems: z.number(), files: z.number(),
        }),
      }),
      201
    ),
    errors: [400, 403, 404, 409],
  },
  'POST /api/v1/files': {
    response: data(
      z.object({ id: z.string(), url: z.string(), filename: z.string(), contentType: z.string(), sizeBytes: z.number(), sha256: z.string(), createdAt: z.string() }),
      201
    ),
    errors: [400, 403, 404, 413, 415],
  },
  'GET /api/v1/files/:id': {
    response: { status: 200, contentType: 'application/octet-stream', schema: z.string(), description: 'The file, with its own Content-Type (local storage).' },
    otherResponses: [{ status: 302, description: 'Redirect to a signed link valid for five minutes (S3 storage).' }],
    errors: [400, 403, 404],
  },
  'GET /api/v1/announcements/recent': {
    response: data(z.array(AnnouncementView.extend({ course: z.object({ id: z.string(), code: z.string(), title: z.string() }) }))),
    errors: [400],
  },
  'POST /api/v1/courses/:courseId/announcements': {
    response: body(z.object({ data: AnnouncementView, notified: z.number().describe('Learners who were notified') }), 201),
    errors: [400, 403, 404],
  },
  'PATCH /api/v1/announcements/:id': { response: data(AnnouncementView), errors: [400, 403, 404] },
  'DELETE /api/v1/announcements/:id': { response: { status: 204, description: 'Deleted' }, errors: [403, 404] },
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
        data: z.array(CalendarEntry),
        /** The next non-lecture entry that has not started yet and that the caller has not completed. */
        nextDeadline: CalendarEntry.nullable(),
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

