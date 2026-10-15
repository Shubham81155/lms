import { z } from 'zod';
import { forgotSchema, loginSchema, resetSchema, verifySchema } from '../routes/auth.routes';
import { createCourseSchema, listQuery as courseListQuery, updateCourseSchema } from '../routes/courses.routes';
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

export interface OperationDoc {
  summary: string;
  query?: z.ZodObject<any>;
  body?: z.ZodTypeAny;
  /** Success status and JSON body. Omit for endpoints whose response is not yet described. */
  response?: { status: number; schema: z.ZodTypeAny; description?: string };
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
};
