import { z } from 'zod';
import { Pagination } from '../docs';
import type { ResponseTable } from './types';

// Response shapes for quizzes, assignments, grading/appeals, the question bank and the
// intelligence/analytics endpoints. Verified against real responses in test/contract-assessment.test.ts.

const QuestionType = z.enum(['MULTIPLE_CHOICE', 'MULTI_SELECT', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY', 'CODE_SANDBOX', 'FORMULA_CALCULATED']);
const Bloom = z.enum(['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYZE', 'EVALUATE', 'CREATE']);

const wrap = (schema: z.ZodTypeAny, status = 200) => ({ status, schema: z.object({ data: schema }) });
const page = (schema: z.ZodTypeAny) => ({ status: 200, schema: z.object({ data: z.array(schema), pagination: Pagination }) });
const deleted = (what: string) => ({ status: 200, schema: z.object({ message: z.string(), id: z.string() }), description: `${what} deleted` });

// ---- quizzes ---------------------------------------------------------------

/** A quiz as stored. */
const QuizRecord = z.object({
  id: z.string(),
  tenantId: z.string(),
  courseId: z.string(),
  title: z.string(),
  /** Null for untimed quizzes. */
  timeLimitMins: z.number().nullable(),
  maxAttempts: z.number(),
  randomizeQuestions: z.boolean(),
  requireProctoring: z.boolean(),
  passingPercent: z.number(),
  gradeCategoryId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const QuizListItem = z.object({
  id: z.string(),
  courseId: z.string(),
  title: z.string(),
  timeLimitMins: z.number().nullable(),
  maxAttempts: z.number(),
  passingPercent: z.number(),
  requireProctoring: z.boolean(),
  questionCount: z.number(),
  submissionCount: z.number(),
  createdAt: z.string(),
});

/** A question as stored, including its answer key. Only staff ever receive this shape. */
const QuizQuestionRecord = z.object({
  id: z.string(),
  quizId: z.string(),
  questionText: z.string(),
  questionType: QuestionType,
  points: z.number(),
  orderIndex: z.number(),
  /** Array of {id, text, isCorrect}, or null. */
  optionsJson: z.unknown(),
  correctAnswer: z.string().nullable(),
  explanation: z.string().nullable(),
  bloomLevel: z.string().nullable(),
});

const CourseRef = z.object({ id: z.string(), title: z.string(), code: z.string() }).nullable();

/** Staff, administrators and auditors: the whole quiz with answer keys. */
const QuizStaffView = QuizRecord.extend({ questions: z.array(QuizQuestionRecord), course: CourseRef });

/** Learners: no isCorrect, correctAnswer or explanation; options carry only id and text. Order is shuffled when the quiz randomizes. */
const QuizLearnerView = z.object({
  id: z.string(),
  courseId: z.string(),
  title: z.string(),
  timeLimitMins: z.number().nullable(),
  maxAttempts: z.number(),
  passingPercent: z.number(),
  requireProctoring: z.boolean(),
  randomizeQuestions: z.boolean(),
  course: CourseRef,
  attemptsUsed: z.number(),
  attemptsRemaining: z.number(),
  questions: z.array(
    z.object({
      id: z.string(),
      questionText: z.string(),
      questionType: QuestionType,
      points: z.number(),
      orderIndex: z.number(),
      options: z.array(z.object({ id: z.string().optional(), text: z.string().optional() })).nullable(),
    })
  ),
});

/**
 * One quiz attempt. Staff get the stored answers (`answersJson`) and the learner's name; learners get
 * only their own attempts, without `answersJson`, but with `pendingManualGrading`.
 */
const QuizSubmissionItem = z.object({
  id: z.string(),
  quizId: z.string(),
  userId: z.string(),
  score: z.number().nullable(),
  maxScore: z.number(),
  passed: z.boolean(),
  attemptNumber: z.number(),
  startedAt: z.string(),
  submittedAt: z.string().nullable(),
  /** Staff view only. */
  answersJson: z.unknown().optional(),
  /** Staff view only. */
  user: z.object({ id: z.string(), firstName: z.string(), lastName: z.string(), email: z.string() }).optional(),
  /** Learner view only. */
  pendingManualGrading: z.boolean().optional(),
});

// ---- assignments -----------------------------------------------------------

const AssignmentRecord = z.object({
  id: z.string(),
  tenantId: z.string(),
  courseId: z.string(),
  title: z.string(),
  instructions: z.string(),
  maxPoints: z.number(),
  dueDate: z.string().nullable(),
  gradeCategoryId: z.string().nullable(),
  /** Array of {id, name, description?, maxPoints}, or null when there is no rubric. */
  rubricJson: z.unknown(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** `_count` (submission count) is only included for staff and auditors. */
const AssignmentListItem = AssignmentRecord.extend({ _count: z.object({ submissions: z.number() }).optional() });

const AssignmentSubmissionRecord = z.object({
  id: z.string(),
  assignmentId: z.string(),
  userId: z.string(),
  fileUrl: z.string().nullable(),
  submissionText: z.string().nullable(),
  grade: z.number().nullable(),
  feedback: z.string().nullable(),
  plagiarismScore: z.number().nullable(),
  plagiarismReportUrl: z.string().nullable(),
  /** Outbound similarity check: PENDING, SUBMITTED, COMPLETE or FAILED; null when none was requested. */
  plagiarismStatus: z.enum(['PENDING', 'SUBMITTED', 'COMPLETE', 'FAILED']).nullable(),
  plagiarismAttempts: z.number().int(),
  plagiarismNextAttemptAt: z.string().nullable(),
  /** {criterionId: points} when the assignment has a rubric. */
  rubricScoresJson: z.unknown(),
  submittedAt: z.string(),
  gradedAt: z.string().nullable(),
});

const AssignmentSubmissionItem = AssignmentSubmissionRecord.extend({
  /** Staff view only. */
  user: z.object({ id: z.string(), firstName: z.string(), lastName: z.string(), email: z.string() }).optional(),
});

// ---- grading / appeals -----------------------------------------------------

const GradeAppealRecord = z.object({
  id: z.string(),
  tenantId: z.string(),
  submissionId: z.string(),
  courseId: z.string(),
  userId: z.string(),
  reason: z.string(),
  status: z.enum(['OPEN', 'UPHELD', 'DENIED']),
  response: z.string().nullable(),
  respondedById: z.string().nullable(),
  respondedAt: z.string().nullable(),
  createdAt: z.string(),
});

const AppealListItem = z.object({
  id: z.string(),
  status: z.enum(['OPEN', 'UPHELD', 'DENIED']),
  reason: z.string(),
  response: z.string().nullable(),
  createdAt: z.string(),
  respondedAt: z.string().nullable(),
  /** Staff view only: the learner's name. */
  student: z.string().optional(),
  submission: z.object({
    id: z.string(),
    grade: z.number().nullable(),
    feedback: z.string().nullable(),
    rubricScores: z.unknown(),
    /** Staff view only. */
    text: z.string().nullable().optional(),
  }),
  assignment: z.object({ id: z.string(), title: z.string(), maxPoints: z.number(), rubricJson: z.unknown() }),
});

// ---- question bank ---------------------------------------------------------

const QuestionBankItem = z.object({
  id: z.string(),
  tenantId: z.string(),
  courseId: z.string().nullable(),
  ownerId: z.string(),
  questionText: z.string(),
  questionType: QuestionType,
  points: z.number(),
  /** Array of {id, text, isCorrect}, or null. */
  optionsJson: z.unknown(),
  correctAnswer: z.string().nullable(),
  explanation: z.string().nullable(),
  tags: z.array(z.string()),
  bloomLevel: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ---- intelligence / analytics ---------------------------------------------

const AtRiskLearner = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  courseId: z.string(),
  /** Course code. */
  course: z.string(),
  progressPercent: z.number(),
  riskFactor: z.enum(['MEDIUM', 'HIGH']),
  riskScore: z.number(),
  reasons: z.array(z.string()),
  suggestedAction: z.string(),
});

const ProctoringLogRecord = z.object({
  id: z.string(),
  submissionId: z.string(),
  eventType: z.string(),
  severity: z.string(),
  timestamp: z.string(),
  snapshotUrl: z.string().nullable(),
  metadataJson: z.unknown(),
});

const CohortAnalytics = z.object({
  tenantId: z.string(),
  metrics: z.object({
    totalEnrolled: z.number(),
    activeThisWeek: z.number(),
    averageProgress: z.number(),
    /** Whole percent. */
    completionRate: z.number(),
    averageGrade: z.number(),
    /** Kept for older clients; the LMS grades on a percentage scale. */
    averageGpa: z.number(),
  }),
  atRiskLearners: z.array(AtRiskLearner),
  /** The 20 hardest questions, hardest first. */
  itemAnalysis: z.array(
    z.object({
      questionId: z.string(),
      concept: z.string(),
      questionType: QuestionType,
      attempts: z.number(),
      averageScorePercent: z.number(),
      status: z.enum(['FLAGGED_HIGH_DIFFICULTY', 'ATTENTION_NEEDED', 'NORMAL']),
      recommendation: z.string(),
    })
  ),
  /** Average score per Bloom level; levels without data are omitted. */
  bloomsMastery: z.array(z.object({ level: Bloom, score: z.number() })),
});

const XapiRecorded = z.object({
  message: z.string(),
  statementIds: z.array(z.string()),
  /** The first statement's id. */
  statementId: z.string().optional(),
  /** Statements newly stored; re-sent identical ids are accepted but not counted. */
  stored: z.number(),
});

export const RESPONSES: ResponseTable = {
  // ---- quizzes
  'GET /api/v1/courses/:courseId/quizzes': {
    response: wrap(z.array(QuizListItem)),
    errors: [403, 404],
  },
  'POST /api/v1/courses/:courseId/quizzes': { response: wrap(QuizRecord, 201), errors: [400, 403, 404] },
  'GET /api/v1/quizzes/:id': {
    response: {
      status: 200,
      schema: z.object({ data: z.union([QuizStaffView, QuizLearnerView]) }),
      description: 'Staff, administrators and auditors get every question with its answer key; learners get questions without correct answers (options carry only id and text).',
    },
    errors: [403, 404],
  },
  'PATCH /api/v1/quizzes/:id': { response: wrap(QuizRecord), errors: [400, 403, 404] },
  'DELETE /api/v1/quizzes/:id': { response: deleted('Quiz'), errors: [403, 404, 409] },
  'POST /api/v1/quizzes/:id/questions': { response: wrap(QuizQuestionRecord, 201), errors: [400, 403, 404] },
  'PATCH /api/v1/quizzes/:id/questions/:questionId': { response: wrap(QuizQuestionRecord), errors: [400, 403, 404] },
  'DELETE /api/v1/quizzes/:id/questions/:questionId': { response: deleted('Question'), errors: [403, 404, 409] },
  'GET /api/v1/quizzes/:id/submissions': {
    response: {
      ...page(QuizSubmissionItem),
      description: 'Staff and auditors: every attempt, with stored answers and the learner. Learners: their own attempts only, without stored answers.',
    },
    errors: [400, 403, 404],
  },
  'PATCH /api/v1/quizzes/:id/submissions/:subId/grade': {
    response: wrap(z.object({ id: z.string(), score: z.number(), maxScore: z.number(), passed: z.boolean(), pendingManualGrading: z.boolean() })),
    errors: [400, 403, 404],
  },

  // ---- assignments
  'GET /api/v1/courses/:courseId/assignments': { response: wrap(z.array(AssignmentListItem)), errors: [403, 404] },
  'POST /api/v1/courses/:courseId/assignments': { response: wrap(AssignmentRecord, 201), errors: [400, 403, 404] },
  'PATCH /api/v1/assignments/:id': { response: wrap(AssignmentRecord), errors: [400, 403, 404] },
  'DELETE /api/v1/assignments/:id': { response: deleted('Assignment'), errors: [403, 404, 409] },
  'POST /api/v1/assignments/:id/submissions': {
    response: wrap(AssignmentSubmissionRecord.extend({ isLate: z.boolean() }), 201),
    errors: [400, 403, 404, 409],
  },
  'POST /api/v1/assignments/:id/submit': {
    response: wrap(AssignmentSubmissionRecord.extend({ isLate: z.boolean() }), 201),
    errors: [400, 403, 404, 409],
  },
  'GET /api/v1/assignments/:id/submissions': {
    response: { ...page(AssignmentSubmissionItem), description: 'Staff and auditors: all submissions (with the learner). Learners: their own.' },
    errors: [400, 403, 404],
  },
  'PATCH /api/v1/assignments/:id/submissions/:subId/grade': {
    response: {
      status: 200,
      schema: z.object({
        data: AssignmentSubmissionRecord,
        /** True when this changed an already-graded submission and the learner's approved course grade went back to draft. */
        courseGradeReopened: z.boolean(),
      }),
    },
    errors: [400, 403, 404],
  },

  // ---- rubrics and appeals
  'PUT /api/v1/assignments/:id/rubric': {
    response: wrap(z.object({ rubric: z.unknown(), maxPoints: z.number() })),
    errors: [400, 403, 404, 409],
  },
  'POST /api/v1/assignments/:id/submissions/:subId/appeal': { response: wrap(GradeAppealRecord, 201), errors: [400, 403, 404, 409] },
  'GET /api/v1/courses/:courseId/appeals': {
    response: { status: 200, schema: z.object({ data: z.array(AppealListItem) }), description: 'Staff, auditors and administrators: every appeal in the course. Learners: their own.' },
    errors: [400, 403, 404],
  },
  'POST /api/v1/appeals/:id/resolve': {
    response: wrap(z.object({ id: z.string(), status: z.enum(['UPHELD', 'DENIED']), courseGradeReopened: z.boolean() })),
    errors: [400, 403, 404, 409],
  },

  // ---- question bank
  'GET /api/v1/question-bank': { response: page(QuestionBankItem), errors: [400] },
  'POST /api/v1/question-bank': { response: wrap(QuestionBankItem, 201), errors: [400, 403, 404] },
  'GET /api/v1/question-bank/:id': { response: wrap(QuestionBankItem), errors: [404] },
  'PATCH /api/v1/question-bank/:id': { response: wrap(QuestionBankItem), errors: [400, 403, 404] },
  'DELETE /api/v1/question-bank/:id': { response: { status: 204, description: 'Deleted' }, errors: [403, 404] },
  'POST /api/v1/quizzes/:quizId/questions/from-bank': {
    response: { ...wrap(z.array(QuizQuestionRecord), 201), description: 'Independent copies of the chosen items, in the order requested.' },
    errors: [400, 403, 404],
  },

  // ---- intelligence
  'POST /api/v1/xapi/statements': {
    response: { status: 201, schema: XapiRecorded, description: 'A single statement was sent' },
    otherResponses: [{ status: 200, schema: XapiRecorded, description: 'A batch (array) was sent' }],
    errors: [400, 403, 409],
  },
  'GET /api/v1/analytics/xapi/stream': {
    response: {
      status: 200,
      schema: z.object({ total: z.number(), statements: z.array(z.unknown()), pagination: Pagination }),
      description: 'xAPI statements, newest first (each is the stored statement JSON). Staff, administrators and auditors see the tenant; others only their own.',
    },
    errors: [400],
  },
  'POST /api/v1/proctoring/events': {
    response: {
      status: 201,
      schema: z.object({ status: z.literal('recorded'), flagged: z.boolean(), riskScore: z.number(), eventType: z.string(), timestamp: z.string() }),
    },
    errors: [400, 404, 409],
  },
  'GET /api/v1/analytics/proctoring': {
    response: {
      status: 200,
      schema: z.object({
        /** Proctored attempts that are open right now. */
        openAttempts: z.number(),
        data: z.array(z.object({ id: z.string(), submissionId: z.string(), student: z.string(), quiz: z.string(), eventType: z.string(), severity: z.string(), timestamp: z.string() })),
      }),
    },
    errors: [403],
  },
  'GET /api/v1/analytics/pending-grading': {
    response: {
      status: 200,
      schema: z.object({
        total: z.number(),
        data: z.array(
          z.object({
            id: z.string(),
            student: z.string(),
            assignmentId: z.string(),
            assignment: z.string(),
            /** Course code. */
            course: z.string(),
            submittedAt: z.string(),
            plagiarismScore: z.number().nullable(),
          })
        ),
      }),
    },
    errors: [403],
  },
  'GET /api/v1/quizzes/:quizId/proctoring': {
    response: wrap(
      z.array(
        z.object({
          submissionId: z.string(),
          userId: z.string(),
          attemptNumber: z.number(),
          /** Number of HIGH severity events. */
          high: z.number(),
          score: z.number(),
          flagged: z.boolean(),
          events: z.array(ProctoringLogRecord),
        })
      )
    ),
    errors: [400, 403, 404],
  },
  'GET /api/v1/analytics/at-risk': {
    response: { status: 200, schema: z.object({ data: z.array(AtRiskLearner), total: z.number() }) },
    errors: [400, 403, 404],
  },
  'POST /api/v1/analytics/at-risk/nudge': {
    response: wrap(z.object({ sent: z.literal(true) }), 201),
    errors: [400, 403, 404],
  },

  // ---- analytics
  'GET /api/v1/analytics/cohort': { response: { status: 200, schema: CohortAnalytics } },
};
