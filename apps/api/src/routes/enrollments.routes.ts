import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';
import { EnrollmentStatus } from '@enterprise-lms/database';

const router = Router();

const enrollSchema = z.object({
  courseId: z.string().uuid(),
  userId: z.string().uuid().optional(),
});

const updateProgressSchema = z.object({
  progressPercent: z.number().min(0).max(100),
  finalGrade: z.number().min(0).max(100).optional(),
});

/**
 * GET /api/v1/enrollments/stats
 * Aggregates enrollment statistics for the user (or specified user for admins)
 */
router.get('/stats', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const tenantId = tenantIdOf(req);
    const currentUserId = req.user!.id;
    const currentUserRole = req.user!.role;

    // Admins can query stats for another user if provided in query params
    let targetUserId = currentUserId;
    if (
      (currentUserRole === 'TENANT_ADMIN' || currentUserRole === 'SUPER_ADMIN') &&
      typeof req.query.userId === 'string'
    ) {
      targetUserId = req.query.userId;
    }

    const enrollments = await prisma.enrollment.findMany({
      where: {
        tenantId,
        userId: targetUserId,
      },
      select: {
        status: true,
        progressPercent: true,
      },
    });

    const total = enrollments.length;
    let completed = 0;
    let inProgress = 0;
    let dropped = 0;
    let failed = 0;
    let enrolled = 0;
    let totalProgress = 0;

    for (const e of enrollments) {
      totalProgress += e.progressPercent;
      switch (e.status) {
        case EnrollmentStatus.COMPLETED:
          completed++;
          break;
        case EnrollmentStatus.IN_PROGRESS:
          inProgress++;
          break;
        case EnrollmentStatus.DROPPED:
          dropped++;
          break;
        case EnrollmentStatus.FAILED:
          failed++;
          break;
        case EnrollmentStatus.ENROLLED:
          enrolled++;
          break;
      }
    }

    const averageProgress = total > 0 ? parseFloat((totalProgress / total).toFixed(2)) : 0;

    return res.status(200).json({
      data: {
        total,
        completed,
        inProgress,
        enrolled,
        dropped,
        failed,
        averageProgress,
      },
    });
  } catch (error: any) {
    console.error('Error in GET /api/v1/enrollments/stats:', error);
    return res.status(500).json({ error: 'Failed to retrieve enrollment statistics' });
  }
});

/**
 * GET /api/v1/enrollments
 * List user's enrollments with course details and pagination
 */
router.get('/', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const tenantId = tenantIdOf(req);
    const currentUserId = req.user!.id;
    const currentUserRole = req.user!.role;

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    // Standard learners only view their own enrollments
    if (currentUserRole === 'STUDENT' || currentUserRole === 'PARENT_GUARDIAN') {
      where.userId = currentUserId;
    } else if (typeof req.query.userId === 'string') {
      where.userId = req.query.userId;
    } else {
      where.userId = currentUserId;
    }

    if (req.query.courseId) {
      where.courseId = req.query.courseId as string;
    }

    if (req.query.status) {
      where.status = req.query.status as EnrollmentStatus;
    }

    const [total, enrollments] = await Promise.all([
      prisma.enrollment.count({ where }),
      prisma.enrollment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { enrolledAt: 'desc' },
        include: {
          course: {
            select: {
              id: true,
              code: true,
              title: true,
              description: true,
              thumbnailUrl: true,
              status: true,
              passingGradePercent: true,
            },
          },
          certificate: {
            select: {
              id: true,
              certificateNumber: true,
              issuedAt: true,
              pdfUrl: true,
              verificationQr: true,
            },
          },
        },
      }),
    ]);

    return res.status(200).json({
      data: enrollments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error('Error in GET /api/v1/enrollments:', error);
    return res.status(500).json({ error: 'Failed to retrieve enrollments' });
  }
});

/**
 * POST /api/v1/enrollments
 * Enroll in a course (with self-enrollment permission checks)
 */
router.post('/', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const tenantId = tenantIdOf(req);
    const currentUserId = req.user!.id;
    const currentUserRole = req.user!.role;

    const parseResult = enrollSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.format(),
      });
    }

    const { courseId, userId: targetUserId } = parseResult.data;
    const enrollmentUserId = targetUserId || currentUserId;

    // Check if target user belongs to the same tenant
    const targetUser = await prisma.user.findFirst({
      where: { id: enrollmentUserId, tenantId },
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found in tenant' });
    }

    // Verify course exists under tenant and is published
    const course = await prisma.course.findFirst({
      where: { id: courseId, tenantId },
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    if (course.status === 'ARCHIVED') {
      return res.status(400).json({ error: 'Cannot enroll in an archived course' });
    }

    // Self-enrollment check: if student enrolling themselves, course must allow self-enroll
    const isSelfEnrollment = enrollmentUserId === currentUserId;
    if (isSelfEnrollment && (currentUserRole === 'STUDENT' || currentUserRole === 'PARENT_GUARDIAN')) {
      if (!course.allowSelfEnroll) {
        return res.status(403).json({
          error: 'Self-enrollment is not permitted for this course. Please contact an instructor or administrator.',
        });
      }
    }

    // Check for existing enrollment
    const existingEnrollment = await prisma.enrollment.findUnique({
      where: {
        courseId_userId: {
          courseId,
          userId: enrollmentUserId,
        },
      },
    });

    if (existingEnrollment) {
      return res.status(409).json({ error: 'User is already enrolled in this course' });
    }

    const enrollment = await prisma.enrollment.create({
      data: {
        tenantId,
        courseId,
        userId: enrollmentUserId,
        status: EnrollmentStatus.ENROLLED,
        progressPercent: 0.0,
      },
      include: {
        course: {
          select: {
            id: true,
            code: true,
            title: true,
          },
        },
      },
    });

    await logAuditEvent({
      tenantId,
      userId: currentUserId,
      action: 'USER_ENROLLED',
      resourceType: 'ENROLLMENT',
      resourceId: enrollment.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { courseId, enrolledUserId: enrollmentUserId },
    });

    return res.status(201).json({ data: enrollment });
  } catch (error: any) {
    console.error('Error in POST /api/v1/enrollments:', error);
    return res.status(500).json({ error: 'Failed to enroll in course' });
  }
});

/**
 * PATCH /api/v1/enrollments/:id/progress
 * Update enrollment progress percentage and completion status
 */
router.patch('/:id/progress', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const tenantId = tenantIdOf(req);
    const id = String(req.params.id);
    const currentUserId = req.user!.id;
    const currentUserRole = req.user!.role;

    const parseResult = updateProgressSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.format(),
      });
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: { id, tenantId },
      include: { course: true },
    });

    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment record not found' });
    }

    // Access control: User can update their own progress, or instructors/admins
    const isOwner = enrollment.userId === currentUserId;
    const isStaff = ['INSTRUCTOR', 'TEACHING_ASSISTANT', 'TENANT_ADMIN', 'SUPER_ADMIN'].includes(
      currentUserRole
    );

    if (!isOwner && !isStaff) {
      return res.status(403).json({ error: 'Forbidden: Cannot update progress for another learner' });
    }

    const { progressPercent, finalGrade } = parseResult.data;

    let newStatus = enrollment.status;
    let completedAt = enrollment.completedAt;

    if (progressPercent >= 100) {
      newStatus = EnrollmentStatus.COMPLETED;
      completedAt = completedAt || new Date();
    } else if (progressPercent > 0 && enrollment.status === EnrollmentStatus.ENROLLED) {
      newStatus = EnrollmentStatus.IN_PROGRESS;
    }

    const updatedEnrollment = await prisma.enrollment.update({
      where: { id },
      data: {
        progressPercent,
        finalGrade: finalGrade !== undefined ? finalGrade : enrollment.finalGrade,
        status: newStatus,
        completedAt,
      },
      include: {
        course: {
          select: {
            id: true,
            code: true,
            title: true,
          },
        },
      },
    });

    await logAuditEvent({
      tenantId,
      userId: currentUserId,
      action: 'ENROLLMENT_PROGRESS_UPDATED',
      resourceType: 'ENROLLMENT',
      resourceId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: {
        previousProgress: enrollment.progressPercent,
        newProgress: progressPercent,
        status: newStatus,
      },
    });

    return res.status(200).json({ data: updatedEnrollment });
  } catch (error: any) {
    console.error(`Error in PATCH /api/v1/enrollments/${req.params.id}/progress:`, error);
    return res.status(500).json({ error: 'Failed to update enrollment progress' });
  }
});

export default router;
