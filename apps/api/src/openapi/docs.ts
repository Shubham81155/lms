import { z } from 'zod';
import type { ResponseDoc } from './responses/types';
import { forgotSchema, loginSchema, resetSchema, verifySchema } from '../routes/auth.routes';
import { confirmRequestSchema, organizationRequestSchema, slugQuery } from '../routes/organizations.routes';
import { findOrganizationSchema } from '../routes/find-organization.routes';
import {
  approveSchema,
  createTenantSchema,
  rejectSchema as rejectRequestSchema,
  requestListQuery,
  tenantStatusSchema,
} from '../routes/operator.routes';
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
import {
  categoriesSchema,
  curveSchema,
  itemsSchema,
  rejectSchema,
  submitSchema as gradebookSubmitSchema,
} from '../routes/gradebook.routes';
import {
  flagSchema,
  listQuery as threadListQuery,
  moderatePostSchema,
  moderateThreadSchema,
  postSchema,
  postsPageQuery,
  threadSchema,
  voteSchema,
} from '../routes/forum.routes';
import { statementSchema } from '../routes/intelligence.routes';
import { aiSettingsSchema, outlineSchema, tutorSchema } from '../routes/ai.routes';
import { planSchema, trialDaysSchema } from '../routes/operator.routes';
import { removeDomainQuery, setDomainSchema } from '../lib/custom-domain';
import { tlsAskQuery } from '../routes/internal-tls.routes';
import { patchBody as scimPatchBody, userBody as scimUserBody } from '../routes/scim.routes';
import { listQuery as notificationListQuery, prefsSchema } from '../routes/notifications.routes';
import { tokenQuery as digestTokenQuery } from '../routes/digest.routes';
import { enrollSchema, listQuery as enrollmentListQuery, updateProgressSchema } from '../routes/enrollments.routes';
import { OFFBOARDING_DOCS } from './responses/offboarding';
import { BILLING_DOCS } from './responses/billing';
import { DSAR_DOCS } from './responses/privacy-requests';
import { DPDP_DOCS } from './responses/dpdp';

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
  allowSelfEnroll: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  instructorCount: z.number(),
  enrollmentCount: z.number(),
  moduleCount: z.number(),
  lessonCount: z.number(),
  /** Sum of the lessons' estimated study minutes. */
  estimatedMinutes: z.number(),
  department: z.object({ id: z.string(), name: z.string() }).nullable(),
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
    .object({
      id: z.string(),
      certificateNumber: z.string(),
      issuedAt: z.string(),
      pdfUrl: z.string().nullable(),
      verificationQr: z.string(),
    })
    .nullable()
    .optional(),
  /** On a learner's own list only: lessons in the course and how many they have finished. */
  lessons: z.object({ total: z.number(), completed: z.number() }).optional(),
  /** On a learner's own list only: the first lesson, in course order, they have not finished (null when all are done). */
  nextLesson: z.object({ id: z.string(), title: z.string(), moduleTitle: z.string() }).nullable().optional(),
  /** Present on rosters (a ?courseId= or another ?userId=), not on a learner's own list. */
  user: z.object({ id: z.string(), firstName: z.string(), lastName: z.string(), email: z.string() }).optional(),
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
  /** OFF, DAILY or WEEKLY digest e-mail (an organisation's people get WEEKLY until they change it). */
  digestFrequency: z.enum(['OFF', 'DAILY', 'WEEKLY']),
  /** Hour of day (0-23) in `timezone` the digest goes out. */
  digestHour: z.number(),
  /** Weekday (0 = Sunday) of a WEEKLY digest. */
  digestWeekday: z.number(),
  /** What the digest covers: deadlines, announcements, grades, forum, live. */
  digestSections: z.array(z.string()),
  lastDigestAt: z.string().nullable(),
});

export const NotificationPreferencesDetail = NotificationPreferences.extend({
  /** Categories that can be e-mailed when e-mail is on; the rest stay in-app. */
  emailedCategories: z.array(z.string()),
  quietNow: z.boolean(),
});

export const GradebookCategory = z.object({
  id: z.string(),
  tenantId: z.string(),
  courseId: z.string(),
  name: z.string(),
  weightPercent: z.number(),
  orderIndex: z.number(),
});

export const GradebookConfig = z.object({
  curve: z.object({ method: z.enum(['NONE', 'ADD_POINTS', 'SCALE_TO_MAX']).optional(), value: z.number().optional() }),
  categories: z.array(GradebookCategory),
  items: z.array(
    z.object({ type: z.enum(['QUIZ', 'ASSIGNMENT']), id: z.string(), title: z.string(), gradeCategoryId: z.string().nullable() })
  ),
});

const GradeStatus = z.enum(['DRAFT', 'SUBMITTED', 'APPROVED']);

/** Staff view of one learner's computed course grade. `breakdown` is the per-category working (JSON). */
export const GradebookRow = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  rawPercent: z.number(),
  curvedPercent: z.number(),
  letter: z.string(),
  incomplete: z.boolean(),
  status: GradeStatus,
  breakdown: z.unknown(),
  decisionNote: z.string().nullable(),
});

export const GradebookStaffView = z.object({
  data: z.array(GradebookRow),
  summary: z.object({
    total: z.number(),
    draft: z.number(),
    submitted: z.number(),
    approved: z.number(),
    incomplete: z.number(),
    /** Null when there are no grades yet. */
    average: z.number().nullable(),
  }),
});

/** What a learner sees: nothing until their grade is approved. */
export const GradebookLearnerView = z.union([
  z.object({ published: z.literal(false), data: z.null() }),
  z.object({
    published: z.literal(true),
    data: z.object({
      rawPercent: z.number(),
      curvedPercent: z.number(),
      letter: z.string(),
      breakdown: z.unknown(),
      approvedAt: z.string().nullable(),
    }),
  }),
]);

const ForumAuthor = z.object({ id: z.string(), name: z.string(), role: z.string() });

/** One thread in a course's list. Learners see classmates as "First L.". */
export const ForumThreadItem = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  category: z.string(),
  pinned: z.boolean(),
  locked: z.boolean(),
  hidden: z.boolean(),
  createdAt: z.string(),
  author: ForumAuthor,
  replyCount: z.number(),
  upvotes: z.number(),
  votedByMe: z.boolean(),
});

/** A thread or reply as stored (returned by the create endpoints). */
export const ForumThreadRecord = z.object({
  id: z.string(),
  tenantId: z.string(),
  courseId: z.string(),
  authorId: z.string(),
  title: z.string(),
  body: z.string(),
  category: z.string(),
  pinned: z.boolean(),
  locked: z.boolean(),
  hidden: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ForumPostRecord = z.object({
  id: z.string(),
  tenantId: z.string(),
  threadId: z.string(),
  authorId: z.string(),
  parentId: z.string().nullable(),
  body: z.string(),
  hidden: z.boolean(),
  endorsed: z.boolean(),
  createdAt: z.string(),
});

export const ForumReply = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  body: z.string(),
  hidden: z.boolean(),
  endorsed: z.boolean(),
  createdAt: z.string(),
  author: ForumAuthor,
  upvotes: z.number(),
  votedByMe: z.boolean(),
});

export const ForumThreadDetail = ForumThreadRecord.extend({
  author: ForumAuthor.nullable(),
  /** Pass as ?cursor= for the next page of replies; null on the last page. */
  nextCursor: z.string().nullable(),
  upvotes: z.number(),
  votedByMe: z.boolean(),
  posts: z.array(ForumReply),
});

export interface OperationDoc {
  summary: string;
  query?: z.ZodObject<any>;
  body?: z.ZodTypeAny;
  /** Success status and body. Omit for endpoints whose response is not yet described. */
  response?: ResponseDoc;
  /** Other successful statuses the endpoint can answer with (e.g. 200 when resuming, 201 when creating). */
  otherResponses?: ResponseDoc[];
  /** Extra statuses this endpoint answers with, e.g. 409. */
  errors?: number[];
}

/** What POST /enrollments returns: the bare enrollment with a short course summary and no certificate. */
export const EnrollmentCreated = EnrollmentItem.omit({ course: true, certificate: true }).extend({
  course: z.object({ id: z.string(), code: z.string(), title: z.string() }),
});

const ok = (schema: z.ZodTypeAny, status = 200) => ({ status, schema });
const message = z.object({ message: z.string() });

/** Keyed `METHOD /express/style/path`. */
export const DOCS: Record<string, OperationDoc> = {
  ...OFFBOARDING_DOCS,
  ...BILLING_DOCS,
  ...DSAR_DOCS,
  ...DPDP_DOCS,
  'POST /api/v1/auth/login': {
    summary:
      'Sign in. Sets the session cookie; no token is returned to JavaScript. 403 with code TENANT_SUSPENDED when the organisation is suspended. `platformOperator` as in GET /auth/me.',
    body: loginSchema,
    response: ok(z.object({ user: PublicUser.extend({ platformOperator: z.boolean() }) })),
    errors: [400, 401, 403, 423, 429],
  },
  'POST /api/v1/auth/logout': { summary: 'Sign out. Invalidates the session token, not just the cookie.', response: ok(message) },
  'GET /api/v1/auth/me': {
    summary:
      'The signed-in user. Rejects sessions whose account was since locked or suspended. `platformOperator` is true for super administrators of the platform operator organisation.',
    response: ok(z.object({ user: PublicUser.extend({ platformOperator: z.boolean() }) })),
  },
  'POST /api/v1/auth/forgot-password': {
    summary: 'Request a password reset e-mail. Always answers the same way, whether or not the address exists.',
    body: forgotSchema,
    response: ok(message),
    errors: [429],
  },
  'POST /api/v1/auth/reset-password': {
    summary:
      'Set a new password with a single-use reset token (also accepts an invitation). Signs out every existing session. `organization` names where to sign in, and its address.',
    body: resetSchema,
    response: ok(
      z.object({ message: z.string(), organization: z.object({ slug: z.string(), name: z.string(), url: z.string() }).optional() })
    ),
    errors: [400, 429],
  },
  'POST /api/v1/auth/verify-email': {
    summary: 'Confirm an e-mail address with a single-use token.',
    body: verifySchema,
    response: ok(message),
    errors: [400, 429],
  },

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
  'GET /api/v1/enrollments/my': {
    summary: 'Alias of GET /api/v1/enrollments.',
    query: enrollmentListQuery,
    response: ok(z.object({ data: z.array(EnrollmentItem), pagination: Pagination })),
  },
  'POST /api/v1/enrollments': {
    summary: 'Enrol the caller (self-enrol) or, for staff, another user.',
    body: enrollSchema,
    response: ok(z.object({ data: EnrollmentCreated }), 201),
    errors: [400, 403, 404, 409],
  },
  'PATCH /api/v1/enrollments/:id/progress': {
    summary: 'Report progress. Learners are capped below 100; staff may complete the course and set a final grade.',
    body: updateProgressSchema,
    errors: [400, 403, 404],
  },

  // ---- quizzes and assignments (request bodies; responses not yet described)
  'POST /api/v1/courses/:courseId/quizzes': {
    summary: 'Create a quiz in a course (course editors).',
    body: createQuizSchema,
    errors: [400, 403, 404],
  },
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
  'POST /api/v1/quizzes/:id/submissions': {
    summary: 'Alias of POST /api/v1/quizzes/:id/submit.',
    body: submitSchema,
    response: ok(z.object({ data: QuizResult }), 201),
    errors: [400, 403, 404, 409],
  },
  'PATCH /api/v1/quizzes/:id/submissions/:subId/grade': {
    summary: 'Manually grade the essay/code questions of a submission (points per question id).',
    body: manualGradeSchema,
    errors: [400, 403, 404],
  },
  'POST /api/v1/courses/:courseId/assignments': {
    summary: 'Create an assignment in a course.',
    body: createAssignmentSchema,
    errors: [400, 403, 404],
  },
  'PATCH /api/v1/assignments/:id': { summary: 'Update an assignment.', body: updateAssignmentSchema, errors: [400, 403, 404] },
  'POST /api/v1/assignments/:id/submissions': {
    summary: 'Submit work: a file URL, text, or both.',
    body: assignmentSubmissionSchema,
    errors: [400, 403, 404, 409],
  },
  'POST /api/v1/assignments/:id/submit': {
    summary: 'Alias of POST /api/v1/assignments/:id/submissions.',
    body: assignmentSubmissionSchema,
    errors: [400, 403, 404, 409],
  },
  'GET /api/v1/assignments/:id/submissions/:subId/versions': {
    summary: 'Submission history: every version the learner handed in, newest first.',
    errors: [400, 403, 404],
  },
  'PATCH /api/v1/assignments/:id/submissions/:subId/grade': {
    summary: 'Grade a submission with a total, or per rubric criterion (send one of grade / criteria).',
    body: gradeSubmissionSchema,
    errors: [400, 403, 404],
  },

  // ---- notifications
  'GET /api/v1/notifications': {
    summary: "The caller's own notifications, newest first.",
    query: notificationListQuery,
    response: ok(z.object({ data: z.array(NotificationItem), unreadCount: z.number(), pagination: Pagination })),
  },
  'GET /api/v1/notifications/preferences': {
    summary:
      'Delivery channels, muted categories, quiet hours, time zone and the digest e-mail settings (sms and push are stored but nothing delivers them yet).',
    response: ok(z.object({ data: NotificationPreferencesDetail })),
  },
  'PUT /api/v1/notifications/preferences': {
    summary: 'Update notification preferences, digest frequency/hour/weekday/sections included; quiet hours must be set together.',
    body: prefsSchema,
    response: ok(z.object({ data: NotificationPreferences })),
    errors: [400],
  },
  'GET /api/v1/notifications/unsubscribe': {
    summary:
      "Public (a signed token from a digest e-mail, no session): which organisation the link belongs to and the person's digest setting. Changes nothing.",
    query: digestTokenQuery,
    response: ok(z.object({ data: z.object({ organisation: z.string(), digestFrequency: z.enum(['OFF', 'DAILY', 'WEEKLY']) }) })),
    errors: [400, 429],
  },
  'POST /api/v1/notifications/unsubscribe': {
    summary:
      "Public (a signed token from a digest e-mail, no session; also the List-Unsubscribe one-click target): turns the person's digest e-mails off.",
    query: digestTokenQuery,
    response: ok(z.object({ data: z.object({ digestFrequency: z.literal('OFF') }) })),
    errors: [400, 429],
  },
  'POST /api/v1/notifications/read-all': {
    summary: 'Mark every notification read.',
    response: ok(z.object({ data: z.object({ updated: z.number() }) })),
  },
  'POST /api/v1/notifications/:id/read': {
    summary: 'Mark one notification read.',
    response: ok(z.object({ data: z.object({ id: z.string(), read: z.literal(true) }) })),
    errors: [404],
  },
  'DELETE /api/v1/notifications/:id': {
    summary: 'Delete a notification.',
    response: { status: 204, description: 'Deleted' },
    errors: [404],
  },

  // ---- gradebook (weighted categories, curve, draft -> submitted -> approved)
  'GET /api/v1/courses/:courseId/gradebook/config': {
    summary: 'Categories, curve and which quizzes/assignments belong to which category (course staff).',
    response: ok(z.object({ data: GradebookConfig })),
    errors: [403, 404],
  },
  'PUT /api/v1/courses/:courseId/gradebook/categories': {
    summary: 'Replace the weighted categories; weights must total 100. Items keep their category when re-saved by name.',
    body: categoriesSchema,
    response: ok(z.object({ data: z.array(GradebookCategory) })),
    errors: [400, 403, 404],
  },
  'PUT /api/v1/courses/:courseId/gradebook/items': {
    summary: 'Assign quizzes and assignments of this course to categories.',
    body: itemsSchema,
    response: ok(z.object({ data: z.object({ updated: z.number() }) })),
    errors: [400, 403, 404],
  },
  'PUT /api/v1/courses/:courseId/gradebook/curve': {
    summary: 'Set the curve applied to every learner.',
    body: curveSchema,
    response: ok(z.object({ data: z.object({ method: z.string(), value: z.number() }) })),
    errors: [400, 403, 404],
  },
  'GET /api/v1/courses/:courseId/gradebook/grid': {
    summary: 'Course staff: every active learner against every quiz and assignment (percent, pending or missing), with their course grade.',
    response: ok(
      z.object({
        data: z.object({
          items: z.array(
            z.object({ id: z.string(), type: z.enum(['QUIZ', 'ASSIGNMENT']), title: z.string(), category: z.string().nullable() })
          ),
          learners: z.array(
            z.object({
              userId: z.string(),
              name: z.string(),
              email: z.string(),
              scores: z.record(z.string(), z.object({ percent: z.number().nullable(), pending: z.boolean(), missing: z.boolean() })),
              courseGrade: z
                .object({
                  rawPercent: z.number().nullable(),
                  curvedPercent: z.number().nullable(),
                  letter: z.string().nullable(),
                  status: z.string(),
                })
                .nullable(),
            })
          ),
        }),
      })
    ),
    errors: [403, 404],
  },
  'GET /api/v1/courses/:courseId/gradebook/export.csv': {
    summary: 'Course staff: the grade grid as CSV (one row per learner, a percentage column per item, then the course grade). Audited.',
    response: { status: 200, contentType: 'text/csv', schema: z.string(), description: 'CSV attachment' },
    errors: [403, 404],
  },
  'POST /api/v1/courses/:courseId/gradebook/calculate': {
    summary: 'Compute draft grades for all active learners. Approved grades are left alone.',
    response: ok(z.object({ data: z.object({ learners: z.number(), calculated: z.number(), skippedApproved: z.number() }) })),
    errors: [403, 404, 409],
  },
  'GET /api/v1/courses/:courseId/gradebook': {
    summary: 'Staff, auditors and admins get every learner; a learner gets only their own grade, and only once it is approved.',
    response: { status: 200, schema: z.union([GradebookStaffView, GradebookLearnerView]), description: 'Staff view, or the learner view' },
    errors: [403, 404],
  },
  'POST /api/v1/courses/:courseId/gradebook/submit': {
    summary: 'Submit draft grades for approval. Refused while graded work is still waiting for a grader unless allowIncomplete.',
    body: gradebookSubmitSchema,
    response: ok(z.object({ data: z.object({ submitted: z.number(), incomplete: z.number() }) })),
    errors: [403, 404, 409],
  },
  'POST /api/v1/courses/:courseId/gradebook/approve': {
    summary:
      'Approve submitted grades (administrators; not the person who submitted them). Approved grades become the final grade and are published to learners; learners who have also finished every lesson and pass complete the course, counted in `completed`.',
    response: ok(z.object({ data: z.object({ approved: z.number(), completed: z.number() }) })),
    errors: [403, 404, 409],
  },
  'POST /api/v1/courses/:courseId/gradebook/reject': {
    summary: 'Return submitted grades to draft with a note (administrators).',
    body: rejectSchema,
    response: ok(z.object({ data: z.object({ returned: z.number() }) })),
    errors: [400, 403, 404, 409],
  },
  'POST /api/v1/courses/:courseId/gradebook/reopen': {
    summary: 'Reopen approved grades for correction (administrators).',
    response: ok(z.object({ data: z.object({ reopened: z.number() }) })),
    errors: [403, 404, 409],
  },

  // ---- discussion forums
  'GET /api/v1/courses/:courseId/threads': {
    summary: "A course's discussion threads, pinned first.",
    query: threadListQuery,
    response: ok(z.object({ data: z.array(ForumThreadItem), pagination: Pagination })),
    errors: [403, 404],
  },
  'POST /api/v1/courses/:courseId/threads': {
    summary: 'Start a thread. Auditors are read-only.',
    body: threadSchema,
    response: ok(z.object({ data: ForumThreadRecord }), 201),
    errors: [400, 403, 404],
  },
  'GET /api/v1/threads/:id': {
    summary: 'A thread with its visible replies, oldest first, one page at a time (`nextCursor`).',
    query: postsPageQuery,
    response: ok(z.object({ data: ForumThreadDetail })),
    errors: [403, 404],
  },
  'POST /api/v1/threads/:id/posts': {
    summary: 'Reply to a thread, optionally to another reply (`parentId`). Locked threads accept staff replies only.',
    body: postSchema,
    response: ok(z.object({ data: ForumPostRecord }), 201),
    errors: [400, 403, 404, 409],
  },
  'POST /api/v1/votes': {
    summary: "Toggle the caller's upvote on a thread or reply.",
    body: voteSchema,
    response: ok(
      z.object({
        data: z.object({ targetType: z.enum(['THREAD', 'POST']), targetId: z.string(), voted: z.boolean(), upvotes: z.number() }),
      })
    ),
    errors: [400, 403, 404],
  },
  'POST /api/v1/flags': {
    summary: 'Report a thread or reply to the moderators.',
    body: flagSchema,
    response: ok(z.object({ data: z.object({ reported: z.literal(true) }) }), 201),
    errors: [400, 403, 404],
  },
  'PATCH /api/v1/threads/:id/moderate': {
    summary: 'Pin, lock or hide a thread (course staff).',
    body: moderateThreadSchema,
    errors: [400, 403, 404],
  },
  'PATCH /api/v1/posts/:id/moderate': {
    summary: 'Hide or restore a reply (course staff).',
    body: moderatePostSchema,
    errors: [400, 403, 404],
  },

  // ---- bodies the handlers read without parseBody
  'GET /api/v1/operator/tenants': {
    summary: 'Platform operator: every organisation with its plan tier, features, seat quota and seats in use.',
  },
  'POST /api/v1/operator/tenants': {
    summary:
      'Platform operator: create an organisation and its first administrator, who is e-mailed an invitation to choose a password. `trialDays` (default ORG_TRIAL_DAYS): a free trial of that many days (status TRIAL), 0 for an active (paid) organisation. Seats default to 100; null means unlimited. A `customDomain` starts out waiting for DNS verification (`pendingCustomDomain`), not live.',
    body: createTenantSchema,
    errors: [400, 409],
  },
  'PATCH /api/v1/operator/tenants/:id/status': {
    summary:
      "Platform operator: suspend an organisation (nobody can sign in to it) or make it active again; making it active ends any trial it had. Not the operator's own organisation. Audited in both trails.",
    body: tenantStatusSchema,
    errors: [400, 404, 409],
  },
  'GET /api/v1/operator/requests': {
    summary:
      'Platform operator: organisation registration requests with the given status (default PENDING), newest first, a page at a time (`page`, `limit`, default 25). Only requests whose applicant confirmed their e-mail are listed. `expired`: a pending request older than its 30-day hold, which no longer reserves its address.',
    query: requestListQuery,
  },
  'POST /api/v1/operator/requests/:id/approve': {
    summary:
      "Platform operator: approve a pending request. Creates the organisation with the chosen plan and seats (and a free trial of `trialDays`, default ORG_TRIAL_DAYS; 0: active, paid), and invites the request's contact as its administrator. A request is decided once.",
    body: approveSchema,
    errors: [400, 404, 409],
  },
  'GET /api/v1/operator/trial-settings': {
    summary:
      'Platform operator: the trial defaults: `defaultDays` (ORG_TRIAL_DAYS, 0 = new organisations start active) and `graceDays` (ORG_TRIAL_GRACE_DAYS, read-only days after a trial ends before suspension).',
  },
  'POST /api/v1/operator/tenants/:id/trial': {
    summary:
      "Platform operator: start a free trial of `days` for an active organisation (status TRIAL). Its administrators are e-mailed 7 days and 1 day before the end; then it is read-only (changes answer 402 TRIAL_ENDED) for ORG_TRIAL_GRACE_DAYS, then suspended. Not the operator's own organisation (409). Audited in both trails.",
    body: trialDaysSchema,
    errors: [400, 404, 409],
  },
  'PATCH /api/v1/operator/tenants/:id/trial': {
    summary:
      'Platform operator: extend a trial by `days`, from its end or from now if it already ended; an ended (read-only) or lapsed (suspended) trial runs again and reminders are sent afresh. Audited in both trails.',
    body: trialDaysSchema,
    errors: [400, 404, 409],
  },
  'POST /api/v1/operator/tenants/:id/trial/end': {
    summary:
      'Platform operator: end a running trial now; the organisation becomes read-only, then is suspended after the grace period. Audited in both trails.',
  },
  'POST /api/v1/operator/tenants/:id/trial/convert': {
    summary:
      'Platform operator: convert a trial organisation (running, ended or suspended after it lapsed) to an active, paid one. Audited in both trails.',
  },
  'GET /api/v1/trial': {
    summary:
      "The caller's organisation's free trial: NONE (no trial), TRIAL (running, with `daysLeft`) or READ_ONLY (ended: changes answer 402 with code TRIAL_ENDED until `readOnlyUntil`, when it is suspended; signing out, exports and privacy requests still work).",
  },
  'POST /api/v1/operator/requests/:id/reject': {
    summary: 'Platform operator: reject a pending request, freeing its address; the applicant is e-mailed the reason.',
    body: rejectRequestSchema,
    errors: [400, 404, 409],
  },
  'GET /api/v1/organizations/availability': {
    summary:
      'Public: whether a new organisation could use this address. `url` is the web address it would have; `reason` says why not: invalid, reserved, taken (an organisation has it) or pending (another open request holds it).',
    query: slugQuery,
  },
  'GET /api/v1/organizations/captcha': {
    summary:
      'Public: the Cloudflare Turnstile site key public forms (organisation registration) render their CAPTCHA with; null while the CAPTCHA is off and forms need no token.',
  },
  'GET /api/v1/organizations/lookup': {
    summary: "Public: an active organisation's name by its address, so the login page can confirm which organisation people sign in to.",
    query: slugQuery,
  },
  'POST /api/v1/organizations/requests': {
    summary:
      'Public: ask for an organisation. The applicant is e-mailed a link to confirm their address (valid 24 hours, during which the request holds the web address); only then does the request reach the platform operator. At most 3 open requests per e-mail address (429). 503 when the server cannot send e-mail. Off when ORG_REGISTRATION_ENABLED=false. While the CAPTCHA is on (GET /organizations/captcha names a site key), `captchaToken` must carry a Cloudflare Turnstile token from a widget with action `org-request` (or send it in the `cf-turnstile-response` header): 400 when it is missing or does not pass, 503 when it could not be checked.',
    body: organizationRequestSchema,
  },
  'POST /api/v1/organizations/find': {
    summary:
      'Public ("Find my organisation"): e-mails the address the sign-in links of the organisations where it has an active or invited account (at most 20; suspended organisations and the platform operator are left out). Always answers 202 with the same body, whether or not the address has accounts; nothing is sent when it has none, or after 3 lookups for the address within an hour.',
    body: findOrganizationSchema,
    response: ok(message, 202),
    errors: [400, 429],
  },
  'POST /api/v1/organizations/requests/confirm': {
    summary:
      "Public: confirm the applicant's e-mail with the token from the confirmation link. The request goes to the platform operator's queue (operators are notified) and holds its address for 30 days. Confirming again reports the request's current state; 410 when the link has expired, 409 when the request was closed or its address taken meanwhile.",
    body: confirmRequestSchema,
  },
  'PATCH /api/v1/operator/tenants/:id': {
    summary:
      "Platform operator: change an organisation's tier, seat quota (not below the seats in use) or feature overrides (null returns a feature to the tier's default). Audited in the operator's and the organisation's trail.",
    body: planSchema,
    errors: [400, 404, 409],
  },
  'GET /api/v1/admin/custom-domain': {
    summary:
      "Administrators: the organisation's live custom domain, the one waiting for verification with the exact TXT record to add (`_lms-verify.<domain>` = `lms-verify=<token>`), and where to point it (CNAME target).",
  },
  'PUT /api/v1/admin/custom-domain': {
    summary:
      'Administrators: ask for a custom domain. It waits for its TXT record and never resolves until verified; a live domain stays live meanwhile. Asking again for the domain waiting keeps its token; asking for the live one withdraws the one waiting. 409 when another organisation uses it, or asked for it within the last week. Audited.',
    body: setDomainSchema,
  },
  'POST /api/v1/admin/custom-domain/verify': {
    summary:
      'Administrators: look the TXT record up now. Found: the domain becomes live, replacing the previous one (audited). Not found: it keeps waiting, with the reason in `check.error` and `pending.error`. `check.routing` is only a hint about the CNAME. 409 when nothing is waiting; 20 checks per 10 minutes.',
  },
  'DELETE /api/v1/admin/custom-domain': {
    summary:
      'Administrators: withdraw the domain waiting (`scope=pending`) or both it and the live domain (`scope=all`, the default); the organisation keeps its subdomain. Audited.',
    query: removeDomainQuery,
  },
  'GET /api/v1/operator/tenants/:id/custom-domain': {
    summary: "Platform operator: an organisation's custom domain state (as GET /admin/custom-domain).",
  },
  'PUT /api/v1/operator/tenants/:id/custom-domain': {
    summary: 'Platform operator: ask for a custom domain for an organisation (as PUT /admin/custom-domain). Audited in both trails.',
    body: setDomainSchema,
  },
  'POST /api/v1/operator/tenants/:id/custom-domain/verify': {
    summary: "Platform operator: check an organisation's TXT record now (as POST /admin/custom-domain/verify).",
  },
  'DELETE /api/v1/operator/tenants/:id/custom-domain': {
    summary: "Platform operator: withdraw an organisation's custom domain (as DELETE /admin/custom-domain). Audited in both trails.",
    query: removeDomainQuery,
  },
  'GET /internal/tls/allowed': {
    summary:
      "For the reverse proxy's on-demand TLS (Caddy `ask`): 200 when a certificate may be issued for `domain` (a verified custom domain, or `<slug>.<TENANT_BASE_DOMAIN>` of an organisation that is not archived), otherwise 404. Requires TLS_ASK_SECRET as the X-TLS-Ask-Secret header or `secret` (403 otherwise); 404 for everything when it is not configured. Not for browsers: keep /internal/* unreachable from the internet.",
    query: tlsAskQuery,
  },
  'GET /api/v1/ai/status': {
    summary:
      "Whether AI assistance can be used here: it is on the plan, not switched off, and a provider key applies (the organisation's own or the platform default).",
  },
  'GET /api/v1/ai/settings': {
    summary: "Administrators: this organisation's AI provider, model and whether a key is saved. The key is never returned.",
  },
  'PUT /api/v1/ai/settings': {
    summary:
      'Administrators: choose the AI provider (Claude, Gemini or Grok) and model, and save, keep or remove the API key. The key is stored encrypted. Audited without the key.',
    body: aiSettingsSchema,
    errors: [400],
  },
  'POST /api/v1/ai/settings/test': {
    summary: 'Administrators: send a tiny request with the settings that apply and report whether it worked.',
    errors: [429],
  },
  'POST /api/v1/ai/tutor': {
    summary:
      "One turn of a study-tutor conversation. With courseId, the answer is grounded in that course's outline and lesson text; the caller must be able to open the course. The conversation is kept by the client, not stored. 503 when no provider key applies or AI is switched off, 403 when it is not on the plan, 429 over the hourly budget, 502 when the model fails.",
    body: tutorSchema,
    errors: [400, 403, 404, 422, 429, 502, 503],
  },
  'POST /api/v1/ai/course-outline': {
    summary:
      'Draft a course outline (modules, lessons, objectives) from a topic, for the instructor to review in the course builder. Nothing is saved.',
    body: outlineSchema,
    errors: [400, 403, 422, 429, 502, 503],
  },
  'POST /api/v1/xapi/statements': {
    summary: 'Record one xAPI statement, or a batch of up to 50 (send an array). 201 for a single statement, 200 for a batch.',
    body: z.union([statementSchema, z.array(statementSchema).min(1).max(50)]),
    errors: [400],
  },
  'POST /api/v1/scim/v2/Users': {
    summary: 'SCIM 2.0: provision a user (learner role; promote in the admin UI).',
    body: scimUserBody,
    errors: [400, 401, 409],
  },
  'PUT /api/v1/scim/v2/Users/:id': {
    summary: 'SCIM 2.0: replace a user (userName cannot change).',
    body: scimUserBody,
    errors: [400, 401, 404],
  },
  'PATCH /api/v1/scim/v2/Users/:id': {
    summary: 'SCIM 2.0 PatchOp: name, externalId, active (activating or suspending signs the user out).',
    body: scimPatchBody,
    errors: [400, 401, 404],
  },
};
