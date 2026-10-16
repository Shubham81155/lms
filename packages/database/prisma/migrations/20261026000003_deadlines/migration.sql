-- Deadlines: quiz availability windows and review policy, a late-work cutoff for assignments, a stored
-- late flag on submissions, and per-learner extensions.

ALTER TABLE "Quiz" ADD COLUMN "availableFrom" TIMESTAMP(3);
ALTER TABLE "Quiz" ADD COLUMN "dueAt" TIMESTAMP(3);
ALTER TABLE "Quiz" ADD COLUMN "reviewPolicy" TEXT NOT NULL DEFAULT 'RESPONSES';
ALTER TABLE "Assignment" ADD COLUMN "acceptLateUntil" TIMESTAMP(3);
ALTER TABLE "AssignmentSubmission" ADD COLUMN "isLate" BOOLEAN NOT NULL DEFAULT false;

-- Existing submissions: late when they arrived after the assignment's due date.
UPDATE "AssignmentSubmission" s SET "isLate" = true
FROM "Assignment" a
WHERE s."assignmentId" = a."id" AND a."dueDate" IS NOT NULL AND s."submittedAt" > a."dueDate";

CREATE TABLE "DeadlineExtension" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "quizId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeadlineExtension_pkey" PRIMARY KEY ("id"),
    -- Exactly one of assignment or quiz.
    CONSTRAINT "DeadlineExtension_one_item" CHECK (("assignmentId" IS NULL) <> ("quizId" IS NULL))
);

CREATE UNIQUE INDEX "DeadlineExtension_assignmentId_userId_key" ON "DeadlineExtension"("assignmentId", "userId");
CREATE UNIQUE INDEX "DeadlineExtension_quizId_userId_key" ON "DeadlineExtension"("quizId", "userId");
CREATE INDEX "DeadlineExtension_tenantId_userId_idx" ON "DeadlineExtension"("tenantId", "userId");

ALTER TABLE "DeadlineExtension" ADD CONSTRAINT "DeadlineExtension_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeadlineExtension" ADD CONSTRAINT "DeadlineExtension_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeadlineExtension" ADD CONSTRAINT "DeadlineExtension_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeadlineExtension" ADD CONSTRAINT "DeadlineExtension_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeadlineExtension" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeadlineExtension" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DeadlineExtension" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- Grant by name: a blanket GRANT ... ON ALL TABLES would hand UPDATE/DELETE on "AuditLog" back to
-- the application role (see 20261018000000_audit_append_only).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "DeadlineExtension" TO lms_app;
  END IF;
END $$;
