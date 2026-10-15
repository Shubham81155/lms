-- Assignment rubrics and grade appeals.

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN "rubricJson" JSONB;
ALTER TABLE "AssignmentSubmission" ADD COLUMN "rubricScoresJson" JSONB;

-- CreateTable
CREATE TABLE "GradeAppeal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "response" TEXT,
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradeAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GradeAppeal_submissionId_key" ON "GradeAppeal"("submissionId");

-- CreateIndex
CREATE INDEX "GradeAppeal_tenantId_courseId_status_idx" ON "GradeAppeal"("tenantId", "courseId", "status");

-- CreateIndex
CREATE INDEX "GradeAppeal_userId_idx" ON "GradeAppeal"("userId");

-- AddForeignKey
ALTER TABLE "GradeAppeal" ADD CONSTRAINT "GradeAppeal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeAppeal" ADD CONSTRAINT "GradeAppeal_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GradeAppeal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GradeAppeal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "GradeAppeal"
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lms_app;
    REVOKE ALL ON TABLE "_prisma_migrations" FROM lms_app;
  END IF;
END $$;
