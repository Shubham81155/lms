import { z } from 'zod';
import { forgotSchema, loginSchema, resetSchema, verifySchema } from '../routes/auth.routes';
import { createCourseSchema, listQuery as courseListQuery, updateCourseSchema } from '../routes/courses.routes';
import {
  assignmentSubmissionSchema,
  createAssignmentSchema,
  createQuestionSchema,
  createQuizSchema,
  gradeSubmissionSchema,
  manualGradeSchema,
  submitSchema,
  updateAssignmentSchema,
  updateQuestionSchema,
  updateQuizSchema,
} from '../routes/assessments.routes';
import { listQuery as notificationListQuery, prefsSchema } from '../routes/notifications.routes';
import { enrollSchema, listQuery as enrollmentListQuery, updateProgressSchema } from '../routes/enrollments.routes';

/**
 * Hand-written detail for the endpoints the web app relies on most. Every route is listed in the
 * API description automatically (see inventory.ts); a route gets request/response schemas here as
 * it is documented. Request schemas are the very Zod schemas the handlers validate with, so they
 * cannot drift; response schemas are described here and checked by the integration tests.
 */

export const ErrorResponse = z.object({
  error: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});

export const Pagination = z.object({ page: z.number(), limit: z.number(), total: z.number(), totalPages: z.number() });

const Role = z.enum(['SUPER_ADMIN', 'TENANT_ADMIN', 'INSTRUCTOR', 'TEACHING_ASSISTANT', 'STUDENT', 'PARENT_GUARDIAN', 'AUDITOR']);

export const PublicUser = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  role: Role,
  tenantId: z.string(),
  status: z.enum(['ACTIVE', 'INVITED', 'LOCKED', 'SUSPENDED']),
  avatarUrl: z.string().nullable(),
  emailVerified: z.boolean(),
  tenant: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
});

const CourseStatus = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

export const CourseListItem = z.object({
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
  enableProctoring: z.boolean(),
  allowSelfEnroll: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  instructorCount: z.number(),
  enrollmentCount: z.number(),
  moduleCount: z.number(),
  instructors: z.array(
    z.object({
      isPrimary: z.boolean(),
      user: z.object({
        id: z.string(),
        firstName: z.string(),
        lastName: z.string(),
        avatarUrl: z.string().nullable(),
        /** Only returned to staff. */
        email: z.string().optional(),
      }),
    })
  ),
});

const EnrollmentStatus = z.enum(['ENROLLED', 'IN_PROGRESS', 'COMPLETED', 'DROPPED', 'FAILED']);

export const EnrollmentItem = z.object({
  id: z.string(),
  tenantId: z.string(),
  courseId: z.string(),
  userId: z.string(),
  status: EnrollmentStatus,
  finalGrade: z.number().nullable(),
  progressPercent: z.number(),
  enrolledAt: z.string(),
  completedAt: z.string().nullable(),
  course: z
    .object({
      id: z.string(),
      code: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      thumbnailUrl: z.string().nullable(),
      status: CourseStatus,
      passingGradePercent: z.number(),
    })
    .optional(),
  certificate: z
    .object({ id: z.string(), certificateNumber: z.string(), issuedAt: z.string(), pdfUrl: z.string().nullable(), verificationQr: z.string().nullable() })
    .nullable()
    .optional(),
});

export const QuizAttempt = z.object({
  submissionId: z.string(),
  attemptNumber: z.number(),
  startedAt: z.string(),
  /** Null for untimed quizzes. */
  expiresAt: z.string().nullable(),
  resumed: z.boolean(),
});

export const QuizResult = z.object({
  submissionId: z.string(),
  score: z.number(),
  maxScore: z.number(),
  percentage: z.number(),
  passed: z.boolean(),
  attemptNumber: z.number(),
  attemptsRemaining: z.number(),
  pendingManualGrading: z.boolean(),
});

export const NotificationItem = z.object({
  id: z.string(),
  category: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});

export const NotificationPreferences = z.object({
  inAppEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  mutedCategories: z.array(z.string()),
  quietStartHour: z.number().nullable(),
  quietEndHour: z.number().nullable(),
  timezone: z.string(),
});

export const NotificationPreferencesDetail = NotificationPreferences.extend({
  /** Categories that can be e-mailed when e-mail is on; the rest stay in-app. */
  emailedCategories: z.array(z.string()),
  quietNow: z.boolean(),
});

export interface OperationDoc {
  summary: string;
  query?: z.ZodObject<any>;
  body?: z.ZodTypeAny;
  /** Success status and JSON body. Omit for endpoints whose response is not yet described. */
  response?: { status: number; schema?: z.ZodTypeAny; description?: string };
  /** Extra statuses this endpoint answers with, e.g. 409. */
  errors?: number[];
}

const ok = (schema: z.ZodTypeAny, status = 200) => ({ status, schema });
const message = z.object({ message: z.string() });

/** Keyed `METHOD /express/style/path`. */
export const DOCS: Record<string, OperationDoc> = {
  'POST /api/v1/auth/login': {
    summary: 'Sign in. Sets the session cookie; no token is returned to JavaScript.',
    body: loginSchema,
    response: ok(z.object({ user: PublicUser })),
    errors: [400, 401, 403, 423, 429],
  },
  'POST /api/v1/auth/logout': { summary: 'Sign out. Invalidates the session token, not just the cookie.', response: ok(message) },
  'GET /api/v1/auth/me': { summary: 'The signed-in user. Rejects sessions whose account was since locked or suspended.', response: ok(z.object({ user: PublicUser })) },
  'POST /api/v1/auth/forgot-password': { summary: 'Request a password reset e-mail. Always answers the same way, whether or not the address exists.', body: forgotSchema, response: ok(message), errors: [429] },
  'POST /api/v1/auth/reset-password': { summary: 'Set a new password with a single-use reset token. Signs out every existing session.', body: resetSchema, response: ok(message), errors: [400, 429] },
  'POST /api/v1/auth/verify-email': { summary: 'Confirm an e-mail address with a single-use token.', body: verifySchema, response: ok(message), errors: [400, 429] },

  'GET /api/v1/courses': {
    summary: 'List courses visible to the caller (learners: published; instructors: published plus their own; admins and auditors: all).',
    query: courseListQuery,
    response: ok(z.object({ data: z.array(CourseListItem), pagination: Pagination })),
  },
  'POST /api/v1/courses': { summary: 'Create a course.', body: createCourseSchema, errors: [400, 409] },
  'PUT /api/v1/courses/:id': { summary: 'Update a course.', body: updateCourseSchema, errors: [400, 404] },

  'GET /api/v1/enrollments': {
    summary: 'Own enrollments, or a roster when ?userId= or ?courseId= is given (staff only).',
    query: enrollmentListQuery,
    response: ok(z.object({ data: z.array(EnrollmentItem), pagination: Pagination })),
    errors: [403],
  },
  'GET /api/v1/enrollments/my': { summary: 'Alias of GET /api/v1/enrollments.', query: enrollmentListQuery, response: ok(z.object({ data: z.array(EnrollmentItem), pagination: Pagination })) },
  'POST /api/v1/enrollments': { summary: 'Enrol the caller (self-enrol) or, for staff, another user.', body: enrollSchema, response: ok(z.object({ data: EnrollmentItem }), 201), errors: [400, 403, 404, 409] },
  'PATCH /api/v1/enrollments/:id/progress': { summary: 'Report progress. Learners are capped below 100; staff may complete the course and set a final grade.', body: updateProgressSchema, errors: [400, 403, 404] },

  // ---- quizzes and assignments (request bodies; responses not yet described)
  'POST /api/v1/courses/:courseId/quizzes': { summary: 'Create a quiz in a course (course editors).', body: createQuizSchema, errors: [400, 403, 404] },
  'PATCH /api/v1/quizzes/:id': { summary: 'Update quiz settings.', body: updateQuizSchema, errors: [400, 403, 404] },
  'POST /api/v1/quizzes/:id/questions': { summary: 'Add a question to a quiz.', body: createQuestionSchema, errors: [400, 403, 404] },
  'PATCH /api/v1/quizzes/:id/questions/:questionId': { summary: 'Update a question.', body: updateQuestionSchema, errors: [400, 403, 404] },
  'POST /api/v1/quizzes/:id/start': {
    summary: 'Start a timed attempt, or resume the open one. 201 for a new attempt, 200 when resuming.',
    response: ok(z.object({ data: QuizAttempt }), 201),
    errors: [400, 403, 404, 409],
  },
  'POST /api/v1/quizzes/:id/submit': {
    summary: 'Submit answers. Objective questions are graded immediately; essay and code questions wait for a grader.',
    body: submitSchema,
    response: ok(z.object({ data: QuizResult }), 201),
    errors: [400, 403, 404, 409],
  },
  'POST /api/v1/quizzes/:id/submissions': { summary: 'Alias of POST /api/v1/quizzes/:id/submit.', body: submitSchema, response: ok(z.object({ data: QuizResult }), 201), errors: [400, 403, 404, 409] },
  'PATCH /api/v1/quizzes/:id/submissions/:subId/grade': { summary: 'Manually grade the essay/code questions of a submission (points per question id).', body: manualGradeSchema, errors: [400, 403, 404] },
  'POST /api/v1/courses/:courseId/assignments': { summary: 'Create an assignment in a course.', body: createAssignmentSchema, errors: [400, 403, 404] },
  'PATCH /api/v1/assignments/:id': { summary: 'Update an assignment.', body: updateAssignmentSchema, errors: [400, 403, 404] },
  'POST /api/v1/assignments/:id/submissions': { summary: 'Submit work: a file URL, text, or both.', body: assignmentSubmissionSchema, errors: [400, 403, 404, 409] },
  'POST /api/v1/assignments/:id/submit': { summary: 'Alias of POST /api/v1/assignments/:id/submissions.', body: assignmentSubmissionSchema, errors: [400, 403, 404, 409] },
  'PATCH /api/v1/assignments/:id/submissions/:subId/grade': { summary: 'Grade a submission with a total, or per rubric criterion (send one of grade / criteria).', body: gradeSubmissionSchema, errors: [400, 403, 404] },

  // ---- notifications
  'GET /api/v1/notifications': {
    summary: "The caller's own notifications, newest first. (Pagination is under `meta` here, unlike the lists above that use `pagination`.)",
    query: notificationListQuery,
    response: ok(z.object({ data: z.array(NotificationItem), unreadCount: z.number(), meta: Pagination })),
  },
  'GET /api/v1/notifications/preferences': { summary: 'Delivery channels, muted categories, quiet hours and time zone.', response: ok(z.object({ data: NotificationPreferencesDetail })) },
  'PUT /api/v1/notifications/preferences': { summary: 'Update notification preferences; quiet hours must be set together.', body: prefsSchema, response: ok(z.object({ data: NotificationPreferences })), errors: [400] },
  'POST /api/v1/notifications/read-all': { summary: 'Mark every notification read.', response: ok(z.object({ data: z.object({ updated: z.number() }) })) },
  'POST /api/v1/notifications/:id/read': { summary: 'Mark one notification read.', response: ok(z.object({ data: z.object({ id: z.string(), read: z.literal(true) }) })), errors: [404] },
  'DELETE /api/v1/notifications/:id': { summary: 'Delete a notification.', response: { status: 204, description: 'Deleted' }, errors: [404] },
};
