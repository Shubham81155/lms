import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, requireRole } from '../middleware/auth';
import { AccessControlEngine } from '@enterprise-lms/security';
import { CourseStatus } from '@enterprise-lms/database';

const router = Router();

const createCourseSchema = z.object({
  code: z.string().min(2).max(50),
  title: z.string().min(3).max(255),
  description: z.string().optional(),
  syllabus: z.string().optional(),
  thumbnailUrl: z.string().url().optional().or(z.literal('')),
  departmentId: z.string().uuid().optional(),
  passingGradePercent: z.number().min(0).max(100).optional(),
  enableProctoring: z.boolean().optional(),
  allowSelfEnroll: z.boolean().optional(),
  status: z.nativeEnum(CourseStatus).optional(),
});

const updateCourseSchema = z.object({
  code: z.string().min(2).max(50).optional(),
  title: z.string().min(3).max(255).optional(),
  description: z.string().optional(),
  syllabus: z.string().optional(),
  thumbnailUrl: z.string().url().optional().or(z.literal('')),
  departmentId: z.string().uuid().optional().nullable(),
  passingGradePercent: z.number().min(0).max(100).optional(),
  enableProctoring: z.boolean().optional(),
  allowSelfEnroll: z.boolean().optional(),
  status: z.nativeEnum(CourseStatus).optional(),
});

const createModuleSchema = z.object({
  title: z.string().min(1).max(255),
  orderIndex: z.number().int().min(0).optional(),
  isLocked: z.boolean().optional(),
});

/**
 * GET /api/v1/courses
 * List all courses for tenant with pagination, search, and enrollment/instructor counts
 */
router.get('/', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const tenantId = String(req.tenantId || req.user?.tenantId || 'default-tenant');
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
    const skip = (page - 1) * limit;

    const status = req.query.status as CourseStatus | undefined;
    const search = req.query.search as string | undefined;

    const where: any = { tenantId };

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, courses] = await Promise.all([
      prisma.course.count({ where }),
      prisma.course.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: {
              instructors: true,
              enrollments: true,
              modules: true,
            },
          },
          instructors: {
            select: {
              isPrimary: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const formattedCourses = courses.map((course) => ({
      ...course,
      instructorCount: course._count.instructors,
      enrollmentCount: course._count.enrollments,
      moduleCount: course._count.modules,
    }));

    return res.status(200).json({
      data: formattedCourses,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error('Error in GET /api/v1/courses:', error);
    return res.status(500).json({ error: 'Failed to retrieve courses' });
  }
});

/**
 * GET /api/v1/courses/:id
 * Get single course with modules, lessons, and assigned instructors
 */
router.get('/:id', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const tenantId = String(req.tenantId || req.user?.tenantId || 'default-tenant');
    const id = String(req.params.id);

    const course = await prisma.course.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        department: true,
        instructors: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
        },
        modules: {
          orderBy: { orderIndex: 'asc' },
          include: {
            lessons: {
              orderBy: { orderIndex: 'asc' },
            },
          },
        },
        _count: {
          select: {
            enrollments: true,
            quizzes: true,
            assignments: true,
          },
        },
      },
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    return res.status(200).json({
      data: {
        ...course,
        enrollmentCount: course._count.enrollments,
        quizCount: course._count.quizzes,
        assignmentCount: course._count.assignments,
      },
    });
  } catch (error: any) {
    console.error(`Error in GET /api/v1/courses/${req.params.id}:`, error);
    return res.status(500).json({ error: 'Failed to retrieve course details' });
  }
});

/**
 * POST /api/v1/courses
 * Create course (INSTRUCTOR, TENANT_ADMIN, SUPER_ADMIN)
 */
router.post(
  '/',
  authenticateJWT,
  requireRole('INSTRUCTOR', 'TENANT_ADMIN', 'SUPER_ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const tenantId = String(req.tenantId || req.user?.tenantId || 'default-tenant');
      const parseResult = createCourseSchema.safeParse(req.body);

      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: parseResult.error.format(),
        });
      }

      const input = parseResult.data;

      // Check if course code already exists in tenant
      const existing = await prisma.course.findFirst({
        where: { tenantId, code: input.code },
      });

      if (existing) {
        return res.status(409).json({ error: `Course with code '${input.code}' already exists` });
      }

      const course = await prisma.course.create({
        data: {
          tenantId,
          code: input.code,
          title: input.title,
          description: input.description,
          syllabus: input.syllabus,
          thumbnailUrl: input.thumbnailUrl || null,
          departmentId: input.departmentId,
          passingGradePercent: input.passingGradePercent ?? 70.0,
          enableProctoring: input.enableProctoring ?? false,
          allowSelfEnroll: input.allowSelfEnroll ?? false,
          status: input.status ?? CourseStatus.DRAFT,
          // If created by an instructor, automatically assign them as primary instructor
          instructors:
            req.user?.role === 'INSTRUCTOR' && req.user.id
              ? {
                  create: {
                    userId: req.user.id,
                    isPrimary: true,
                  },
                }
              : undefined,
        },
        include: {
          instructors: {
            include: {
              user: {
                select: { id: true, firstName: true, lastName: true, email: true },
              },
            },
          },
        },
      });

      await logAuditEvent({
        tenantId,
        userId: req.user?.id,
        action: 'COURSE_CREATED',
        resourceType: 'COURSE',
        resourceId: course.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        diffJson: { code: course.code, title: course.title },
      });

      return res.status(201).json({ data: course });
    } catch (error: any) {
      console.error('Error in POST /api/v1/courses:', error);
      return res.status(500).json({ error: 'Failed to create course' });
    }
  }
);

/**
 * PUT /api/v1/courses/:id
 * Update course with ABAC: user must be assigned instructor or tenant admin
 */
router.put('/:id', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const tenantId = String(req.tenantId || req.user?.tenantId || 'default-tenant');
    const id = String(req.params.id);

    const parseResult = updateCourseSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.format(),
      });
    }

    const course = await prisma.course.findFirst({
      where: { id, tenantId },
      include: { instructors: true },
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const instructorUserIds = course.instructors.map((ins: { userId: string }) => ins.userId);
    const canEdit = AccessControlEngine.canEditCourse(
      req.user!.role,
      req.user!.id,
      instructorUserIds
    );

    if (!canEdit) {
      return res.status(403).json({
        error: 'Forbidden: You must be an assigned instructor or administrator to update this course',
      });
    }

    const input = parseResult.data;

    const updatedCourse = await prisma.course.update({
      where: { id },
      data: {
        code: input.code,
        title: input.title,
        description: input.description,
        syllabus: input.syllabus,
        thumbnailUrl: input.thumbnailUrl !== undefined ? input.thumbnailUrl || null : undefined,
        departmentId: input.departmentId !== undefined ? input.departmentId : undefined,
        passingGradePercent: input.passingGradePercent,
        enableProctoring: input.enableProctoring,
        allowSelfEnroll: input.allowSelfEnroll,
        status: input.status,
      },
    });

    await logAuditEvent({
      tenantId,
      userId: req.user?.id,
      action: 'COURSE_UPDATED',
      resourceType: 'COURSE',
      resourceId: updatedCourse.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { before: course, after: updatedCourse },
    });

    return res.status(200).json({ data: updatedCourse });
  } catch (error: any) {
    console.error(`Error in PUT /api/v1/courses/${req.params.id}:`, error);
    return res.status(500).json({ error: 'Failed to update course' });
  }
});

/**
 * DELETE /api/v1/courses/:id
 * Soft delete (set status=ARCHIVED), admin only
 */
router.delete(
  '/:id',
  authenticateJWT,
  requireRole('SUPER_ADMIN', 'TENANT_ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const tenantId = String(req.tenantId || req.user?.tenantId || 'default-tenant');
      const id = String(req.params.id);

      const course = await prisma.course.findFirst({
        where: { id, tenantId },
      });

      if (!course) {
        return res.status(404).json({ error: 'Course not found' });
      }

      const archivedCourse = await prisma.course.update({
        where: { id },
        data: { status: CourseStatus.ARCHIVED },
      });

      await logAuditEvent({
        tenantId,
        userId: req.user?.id,
        action: 'COURSE_DELETED',
        resourceType: 'COURSE',
        resourceId: id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        diffJson: { previousStatus: course.status, newStatus: CourseStatus.ARCHIVED },
      });

      return res.status(200).json({
        message: 'Course archived successfully',
        id: archivedCourse.id,
        status: archivedCourse.status,
      });
    } catch (error: any) {
      console.error(`Error in DELETE /api/v1/courses/${req.params.id}:`, error);
      return res.status(500).json({ error: 'Failed to archive course' });
    }
  }
);

/**
 * GET /api/v1/courses/:id/modules
 * Get all modules with lessons for a course
 */
router.get('/:id/modules', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const tenantId = String(req.tenantId || req.user?.tenantId || 'default-tenant');
    const id = String(req.params.id);

    // Verify course exists under this tenant
    const course = await prisma.course.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const modules = await prisma.module.findMany({
      where: { courseId: id },
      orderBy: { orderIndex: 'asc' },
      include: {
        lessons: {
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    return res.status(200).json({ data: modules });
  } catch (error: any) {
    console.error(`Error in GET /api/v1/courses/${req.params.id}/modules:`, error);
    return res.status(500).json({ error: 'Failed to retrieve course modules' });
  }
});

/**
 * POST /api/v1/courses/:id/modules
 * Create a new module within a course (with ABAC instructor / admin validation)
 */
router.post('/:id/modules', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const tenantId = String(req.tenantId || req.user?.tenantId || 'default-tenant');
    const id = String(req.params.id);

    const course = await prisma.course.findFirst({
      where: { id, tenantId },
      include: { instructors: true },
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const instructorUserIds = course.instructors.map((ins: { userId: string }) => ins.userId);
    const canEdit = AccessControlEngine.canEditCourse(
      req.user!.role,
      req.user!.id,
      instructorUserIds
    );

    if (!canEdit) {
      return res.status(403).json({
        error: 'Forbidden: You must be an assigned instructor or administrator to create modules',
      });
    }

    const parseResult = createModuleSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.format(),
      });
    }

    const input = parseResult.data;

    // Calculate default order index if not provided
    let orderIndex = input.orderIndex;
    if (orderIndex === undefined) {
      const maxOrder = await prisma.module.aggregate({
        where: { courseId: id },
        _max: { orderIndex: true },
      });
      orderIndex = (maxOrder._max?.orderIndex ?? -1) + 1;
    }

    const moduleRecord = await prisma.module.create({
      data: {
        courseId: id,
        title: input.title,
        orderIndex,
        isLocked: input.isLocked ?? false,
      },
      include: {
        lessons: true,
      },
    });

    await logAuditEvent({
      tenantId,
      userId: req.user?.id,
      action: 'MODULE_CREATED',
      resourceType: 'MODULE',
      resourceId: moduleRecord.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { courseId: id, title: moduleRecord.title },
    });

    return res.status(201).json({ data: moduleRecord });
  } catch (error: any) {
    console.error(`Error in POST /api/v1/courses/${req.params.id}/modules:`, error);
    return res.status(500).json({ error: 'Failed to create module' });
  }
});

export default router;
