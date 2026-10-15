ALTER TABLE "AssignmentSubmission" ADD COLUMN "plagiarismStatus" TEXT;
ALTER TABLE "AssignmentSubmission" ADD COLUMN "plagiarismAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AssignmentSubmission" ADD COLUMN "plagiarismNextAttemptAt" TIMESTAMP(3);

CREATE INDEX "AssignmentSubmission_plagiarismStatus_plagiarismNextAttemptAt_idx" ON "AssignmentSubmission"("plagiarismStatus", "plagiarismNextAttemptAt");
