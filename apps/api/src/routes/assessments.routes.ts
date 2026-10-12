import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, requireRole } from '../middleware/auth';

const router = Router();

const quizSubmissionSchema = z.object({
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
});

const assignmentSubmissionSchema = z
  .object({
    fileUrl: z.string().url().optional().or(z.literal('')),
    submissionText: z.string().optional(),
  })
  .refine((data) => data.fileUrl || data.submissionText, {
    message: 'Either fileUrl or submissionText must be provided',
  });

const gradeSubmissionSchema = z.object({
  grade: z.number().min(0),
  feedback: z.string().optional(),
});

/**
 * GET /api/v1/courses/:courseId/quizzes
 * List quizzes available for a course
 */
router.get('/courses/:courseId/quizzes', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const tenantId = String(req.tenantId || req.user?.tenantId || 'default-tenant');
    const courseId = String(req.params.courseId);

    const course = await prisma.course.findFirst({
      where: { id: courseId, tenantId },
      select: { id: true },
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const quizzes = await prisma.quiz.findMany({
      where: { courseId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: {
          select: {
            questions: true,
            submissions: true,
          },
        },
      },
    });

    const formattedQuizzes = quizzes.map((q) => ({
      id: q.id,
      courseId: q.courseId,
      title: q.title,
      timeLimitMins: q.timeLimitMins,
      maxAttempts: q.maxAttempts,
      passingPercent: q.passingPercent,
      requireProctoring: q.requireProctoring,
      questionCount: q._count.questions,
      submissionCount: q._count.submissions,
      createdAt: q.createdAt,
    }));

    return res.status(200).json({ data: formattedQuizzes });
  } catch (error: any) {
    console.error(`Error in GET /courses/${req.params.courseId}/quizzes:`, error);
    return res.status(500).json({ error: 'Failed to retrieve course quizzes' });
  }
});

/**
 * GET /api/v1/quizzes/:id
 * Retrieve single quiz with questions (hiding answers for students)
 */
router.get('/quizzes/:id', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const tenantId = String(req.tenantId || req.user?.tenantId || 'default-tenant');
    const id = String(req.params.id);
    const currentUserRole = req.user!.role;

    const quiz = await prisma.quiz.findFirst({
      where: {
        id,
        course: { tenantId },
      },
      include: {
        course: {
          select: { id: true, title: true, code: true },
        },
        questions: {
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    if (!quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    const isStudent = currentUserRole === 'STUDENT' || currentUserRole === 'PARENT_GUARDIAN';

    // Mask sensitive answer keys for learners
    const questions = quiz.questions.map((q) => {
      if (isStudent) {
        let sanitizedOptions = q.optionsJson;
        if (Array.isArray(q.optionsJson)) {
          sanitizedOptions = q.optionsJson.map((opt: any) => ({
            id: opt.id,
            text: opt.text,
          }));
        }
        return {
          id: q.id,
          questionText: q.questionText,
          questionType: q.questionType,
          points: q.points,
          orderIndex: q.orderIndex,
          options: sanitizedOptions,
        };
      }

      return q;
    });

    return res.status(200).json({
      data: {
        ...quiz,
        questions,
      },
    });
  } catch (error: any) {
    console.error(`Error in GET /quizzes/${req.params.id}:`, error);
    return res.status(500).json({ error: 'Failed to retrieve quiz' });
  }
});

/**
 * POST /api/v1/quizzes/:id/submit
 * Submit quiz answers, automatically grade objective questions, and return score
 */
router.post('/quizzes/:id/submit', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const tenantId = String(req.tenantId || req.user?.tenantId || 'default-tenant');
    const id = String(req.params.id);
    const userId = req.user!.id;

    const parseResult = quizSubmissionSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.format(),
      });
    }

    const quiz = await prisma.quiz.findFirst({
      where: {
        id,
        course: { tenantId },
      },
      include: {
        questions: true,
      },
    });

    if (!quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    // Verify submission attempt count
    const previousAttempts = await prisma.quizSubmission.count({
      where: { quizId: id, userId },
    });

    if (quiz.maxAttempts && previousAttempts >= quiz.maxAttempts) {
      return res.status(400).json({
        error: `Maximum attempts (${quiz.maxAttempts}) reached for this quiz`,
      });
    }

    const attemptNumber = previousAttempts + 1;
    const submittedAnswers = parseResult.data.answers;

    let totalScore = 0;
    let maxScore = 0;
    const questionGradingResults: Record<string, any> = {};

    for (const question of quiz.questions) {
      const qPoints = question.points || 1.0;
      maxScore += qPoints;

      const studentAns = submittedAnswers[question.id];
      let isCorrect = false;

      if (studentAns !== undefined && studentAns !== null) {
        // Evaluate based on optionsJson or direct correctAnswer
        if (Array.isArray(question.optionsJson)) {
          const optionsList = question.optionsJson as any[];
          const correctOption = optionsList.find((opt: any) => opt && opt.isCorrect === true);
          if (correctOption) {
            const optId = String(correctOption.id || '');
            const optText = String(correctOption.text || '');
            const studentStr = String(studentAns).trim().toLowerCase();
            if (
              (optId && studentStr === optId.toLowerCase()) ||
              (optText && studentStr === optText.toLowerCase())
            ) {
              isCorrect = true;
            }
          }
        }

        if (!isCorrect && question.correctAnswer) {
          if (String(studentAns).trim().toLowerCase() === String(question.correctAnswer).trim().toLowerCase()) {
            isCorrect = true;
          }
        }
      }

      const awardedPoints = isCorrect ? qPoints : 0;
      totalScore += awardedPoints;

      questionGradingResults[question.id] = {
        awardedPoints,
        maxPoints: qPoints,
        isCorrect,
      };
    }

    const scorePercentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
    const passed = scorePercentage >= quiz.passingPercent;

    const submission = await prisma.quizSubmission.create({
      data: {
        quizId: id,
        userId,
        score: totalScore,
        maxScore,
        passed,
        attemptNumber,
        submittedAt: new Date(),
        answersJson: {
          submittedAnswers,
          grading: questionGradingResults,
        },
      },
    });

    await logAuditEvent({
      tenantId,
      userId,
      action: 'QUIZ_SUBMITTED',
      resourceType: 'QUIZ_SUBMISSION',
      resourceId: submission.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: {
        quizId: id,
        score: totalScore,
        maxScore,
        scorePercentage,
        passed,
        attemptNumber,
      },
    });

    return res.status(201).json({
      data: {
        submissionId: submission.id,
        score: totalScore,
        maxScore,
        percentage: parseFloat(scorePercentage.toFixed(2)),
        passed,
        attemptNumber,
      },
    });
  } catch (error: any) {
    console.error(`Error in POST /quizzes/${req.params.id}/submit:`, error);
    return res.status(500).json({ error: 'Failed to submit and grade quiz' });
  }
});

/**
 * GET /api/v1/courses/:courseId/assignments
 * List assignments for a course
 */
router.get('/courses/:courseId/assignments', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const tenantId = String(req.tenantId || req.user?.tenantId || 'default-tenant');
    const courseId = String(req.params.courseId);

    const course = await prisma.course.findFirst({
      where: { id: courseId, tenantId },
      select: { id: true },
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const assignments = await prisma.assignment.findMany({
      where: { courseId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: {
          select: { submissions: true },
        },
      },
    });

    return res.status(200).json({ data: assignments });
  } catch (error: any) {
    console.error(`Error in GET /courses/${req.params.courseId}/assignments:`, error);
    return res.status(500).json({ error: 'Failed to retrieve course assignments' });
  }
});

/**
 * POST /api/v1/assignments/:id/submit
 * Submit assignment text response or asset URL
 */
router.post('/assignments/:id/submit', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const tenantId = String(req.tenantId || req.user?.tenantId || 'default-tenant');
    const id = String(req.params.id);
    const userId = req.user!.id;

    const parseResult = assignmentSubmissionSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.format(),
      });
    }

    const assignment = await prisma.assignment.findFirst({
      where: {
        id,
        course: { tenantId },
      },
    });

    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const { fileUrl, submissionText } = parseResult.data;

    // Check if previous submission exists
    const existingSubmission = await prisma.assignmentSubmission.findFirst({
      where: { assignmentId: id, userId },
    });

    let submission;
    if (existingSubmission) {
      submission = await prisma.assignmentSubmission.update({
        where: { id: existingSubmission.id },
        data: {
          fileUrl: fileUrl || null,
          submissionText: submissionText || null,
          submittedAt: new Date(),
        },
      });
    } else {
      submission = await prisma.assignmentSubmission.create({
        data: {
          assignmentId: id,
          userId,
          fileUrl: fileUrl || null,
          submissionText: submissionText || null,
        },
      });
    }

    await logAuditEvent({
      tenantId,
      userId,
      action: 'ASSIGNMENT_SUBMITTED',
      resourceType: 'ASSIGNMENT_SUBMISSION',
      resourceId: submission.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { assignmentId: id },
    });

    return res.status(201).json({ data: submission });
  } catch (error: any) {
    console.error(`Error in POST /assignments/${req.params.id}/submit:`, error);
    return res.status(500).json({ error: 'Failed to submit assignment' });
  }
});

/**
 * PATCH /api/v1/assignments/:id/submissions/:subId/grade
 * Grade an assignment submission (INSTRUCTOR, TEACHING_ASSISTANT, TENANT_ADMIN, SUPER_ADMIN)
 */
router.patch(
  '/assignments/:id/submissions/:subId/grade',
  authenticateJWT,
  requireRole('INSTRUCTOR', 'TEACHING_ASSISTANT', 'TENANT_ADMIN', 'SUPER_ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const tenantId = String(req.tenantId || req.user?.tenantId || 'default-tenant');
      const id = String(req.params.id);
      const subId = String(req.params.subId);
      const graderId = req.user!.id;

      const parseResult = gradeSubmissionSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: parseResult.error.format(),
        });
      }

      const submission = await prisma.assignmentSubmission.findFirst({
        where: {
          id: subId,
          assignmentId: id,
          assignment: {
            course: { tenantId },
          },
        },
        include: {
          assignment: true,
        },
      });

      if (!submission) {
        return res.status(404).json({ error: 'Assignment submission not found' });
      }

      const { grade, feedback } = parseResult.data;

      if (grade > submission.assignment.maxPoints) {
        return res.status(400).json({
          error: `Grade (${grade}) cannot exceed max points (${submission.assignment.maxPoints})`,
        });
      }

      const updated = await prisma.assignmentSubmission.update({
        where: { id: subId },
        data: {
          grade,
          feedback: feedback || null,
          gradedAt: new Date(),
        },
      });

      await logAuditEvent({
        tenantId,
        userId: graderId,
        action: 'GRADE_MODIFIED',
        resourceType: 'GRADE',
        resourceId: subId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        diffJson: {
          submissionId: subId,
          previousGrade: submission.grade,
          newGrade: grade,
          feedback,
        },
      });

      return res.status(200).json({ data: updated });
    } catch (error: any) {
      console.error(
        `Error in PATCH /assignments/${req.params.id}/submissions/${req.params.subId}/grade:`,
        error
      );
      return res.status(500).json({ error: 'Failed to grade assignment submission' });
    }
  }
);

export default router;
