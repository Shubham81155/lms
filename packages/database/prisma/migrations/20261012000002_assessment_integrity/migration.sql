-- AlterTable
ALTER TABLE "Certificate" ALTER COLUMN "pdfUrl" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "QuizSubmission_quizId_userId_attemptNumber_key" ON "QuizSubmission"("quizId", "userId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubmission_assignmentId_userId_key" ON "AssignmentSubmission"("assignmentId", "userId");

