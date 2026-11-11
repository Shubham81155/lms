import { Router } from 'express';
import { registerQuizzesRoutes } from './assessments/quizzes.routes';
import { registerQuizSubmissionsRoutes } from './assessments/quiz-submissions.routes';
import { registerAssignmentsRoutes } from './assessments/assignments.routes';
import { registerAssignmentSubmissionsRoutes } from './assessments/assignment-submissions.routes';

export { submissionListQuery } from './assessments/shared';
export { createQuizSchema, updateQuizSchema, createQuestionSchema, updateQuestionSchema } from './assessments/quizzes.routes';
export { submitSchema, manualGradeSchema } from './assessments/quiz-submissions.routes';
export { createAssignmentSchema, updateAssignmentSchema } from './assessments/assignments.routes';
export { assignmentSubmissionSchema, gradeSubmissionSchema } from './assessments/assignment-submissions.routes';

const router = Router();

registerQuizzesRoutes(router);
registerQuizSubmissionsRoutes(router);
registerAssignmentsRoutes(router);
registerAssignmentSubmissionsRoutes(router);

export default router;
