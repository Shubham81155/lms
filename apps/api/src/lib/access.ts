import { Request } from 'express';
import { AccessControlEngine } from '@enterprise-lms/security';
import { prisma } from './prisma';
import { HttpError } from './http';
import { tenantIdOf } from '../middleware/auth';

export const ADMIN_ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN'] as const;
export const LEARNER_ROLES = ['STUDENT', 'PARENT_GUARDIAN'] as const;
/** Roles whose course access is granted by being assigned to the course. */
export const COURSE_STAFF_ROLES = ['INSTRUCTOR', 'TEACHING_ASSISTANT'] as const;

type Role = string;
export const isAdminRole = (role: Role) => (ADMIN_ROLES as readonly string[]).includes(role);
export const isLearnerRole = (role: Role) => (LEARNER_ROLES as readonly string[]).includes(role);
/** Admins and auditors can see everything in their tenant; auditors can only read. */
export const canSeeAllCourses = (role: Role) => isAdminRole(role) || role === 'AUDITOR';

const ACTIVE_ENROLLMENT = ['ENROLLED', 'IN_PROGRESS', 'COMPLETED'] as const;

export interface CourseAccess {
  course: {
    id: string;
    tenantId: string;
    status: string;
    passingGradePercent: number;
    allowSelfEnroll: boolean;
    instructorIds: string[];
  };
  /** Admin, or an instructor / TA assigned to this course. */
  isStaff: boolean;
  /** May change course content (admin or the assigned INSTRUCTOR). TAs cannot. */
  canEdit: boolean;
  /** Enrolled and not dropped or failed. */
  isEnrolled: boolean;
  /** May read lessons, quizzes and assignments. */
  canAccessContent: boolean;
}

/**
 * Resolves what the caller may do with a course. Returns null when the course does not exist for
 * them, including drafts they have no business seeing, so existence is never leaked.
 */
export async function getCourseAccess(req: Request, courseId: string): Promise<CourseAccess | null> {
  const user = req.user!;
  const tenantId = tenantIdOf(req);

  const course = await prisma.course.findFirst({
    where: { id: courseId, tenantId },
    select: {
      id: true,
      tenantId: true,
      status: true,
      passingGradePercent: true,
      allowSelfEnroll: true,
      instructors: { select: { userId: true } },
    },
  });
  if (!course) return null;

  const instructorIds = course.instructors.map((i) => i.userId);
  const assigned = (COURSE_STAFF_ROLES as readonly string[]).includes(user.role) && instructorIds.includes(user.id);
  const isStaff = isAdminRole(user.role) || assigned;
  const seesAll = canSeeAllCourses(user.role);

  if (course.status !== 'PUBLISHED' && !isStaff && !seesAll) return null;

  const enrollment = await prisma.enrollment.findUnique({
    where: { courseId_userId: { courseId, userId: user.id } },
    select: { status: true },
  });
  const isEnrolled = !!enrollment && (ACTIVE_ENROLLMENT as readonly string[]).includes(enrollment.status);

  return {
    course: {
      id: course.id,
      tenantId: course.tenantId,
      status: course.status,
      passingGradePercent: course.passingGradePercent,
      allowSelfEnroll: course.allowSelfEnroll,
      instructorIds,
    },
    isStaff,
    canEdit: AccessControlEngine.canEditCourse(user.role, user.id, instructorIds),
    isEnrolled,
    canAccessContent: isStaff || seesAll || (course.status === 'PUBLISHED' && isEnrolled),
  };
}

export async function requireCourseAccess(req: Request, courseId: string): Promise<CourseAccess> {
  const access = await getCourseAccess(req, courseId);
  if (!access) throw new HttpError(404, 'Course not found');
  return access;
}

/** Course content (lessons, quizzes, assignments): staff, auditors, or enrolled learners. */
export async function requireContentAccess(req: Request, courseId: string): Promise<CourseAccess> {
  const access = await requireCourseAccess(req, courseId);
  if (!access.canAccessContent) throw new HttpError(403, 'Forbidden: enrol in this course to access its content');
  return access;
}

/** Create / update / delete course content: admins and the assigned instructor. */
export async function requireCourseEditor(req: Request, courseId: string): Promise<CourseAccess> {
  const access = await requireCourseAccess(req, courseId);
  if (!access.canEdit) {
    throw new HttpError(403, 'Forbidden: you must be an assigned instructor or administrator for this course');
  }
  return access;
}

/** Grade, review submissions, view rosters: admins and any staff assigned to the course (incl. TAs). */
export async function requireCourseStaff(req: Request, courseId: string): Promise<CourseAccess> {
  const access = await requireCourseAccess(req, courseId);
  if (!access.isStaff) {
    throw new HttpError(403, 'Forbidden: you must be staff assigned to this course');
  }
  return access;
}
