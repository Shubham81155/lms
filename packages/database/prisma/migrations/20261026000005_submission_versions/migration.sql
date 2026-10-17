-- Assignment submission history: every submit and resubmit keeps an immutable copy. AssignmentSubmission
-- stays the current version (grading, plagiarism and appeals keep using it).

CREATE TABLE "AssignmentSubmissionVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileUrl" TEXT,
    "submissionText" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "isLate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AssignmentSubmissionVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssignmentSubmissionVersion_tenantId_idx" ON "AssignmentSubmissionVersion"("tenantId");
CREATE UNIQUE INDEX "AssignmentSubmissionVersion_submissionId_version_key" ON "AssignmentSubmissionVersion"("submissionId", "version");

ALTER TABLE "AssignmentSubmissionVersion" ADD CONSTRAINT "AssignmentSubmissionVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentSubmissionVersion" ADD CONSTRAINT "AssignmentSubmissionVersion_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing submissions become version 1 (only their latest text is known).
INSERT INTO "AssignmentSubmissionVersion" ("id", "tenantId", "submissionId", "version", "fileUrl", "submissionText", "submittedAt", "isLate")
SELECT gen_random_uuid()::text, a."tenantId", s."id", 1, s."fileUrl", s."submissionText", s."submittedAt", s."isLate"
FROM "AssignmentSubmission" s JOIN "Assignment" a ON a."id" = s."assignmentId";

ALTER TABLE "AssignmentSubmissionVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssignmentSubmissionVersion" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AssignmentSubmissionVersion" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- Grant by name: a blanket GRANT ... ON ALL TABLES would hand UPDATE/DELETE on "AuditLog" back to
-- the application role (see 20261018000000_audit_append_only).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "AssignmentSubmissionVersion" TO lms_app;
  END IF;
END $$;
