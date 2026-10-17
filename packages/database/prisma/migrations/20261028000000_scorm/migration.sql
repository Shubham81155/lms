-- SCORM packages (unpacked into storage) and each learner's run-time data.

CREATE TABLE "ScormPackage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "title" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "launchPath" TEXT NOT NULL,
    "filesJson" JSONB NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScormPackage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScormAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cmiJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not attempted',
    "scorePercent" DOUBLE PRECISION,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScormAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScormPackage_tenantId_courseId_idx" ON "ScormPackage"("tenantId", "courseId");

CREATE INDEX "ScormAttempt_tenantId_userId_idx" ON "ScormAttempt"("tenantId", "userId");

CREATE UNIQUE INDEX "ScormAttempt_packageId_userId_key" ON "ScormAttempt"("packageId", "userId");

ALTER TABLE "ScormPackage" ADD CONSTRAINT "ScormPackage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScormPackage" ADD CONSTRAINT "ScormPackage_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScormAttempt" ADD CONSTRAINT "ScormAttempt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScormAttempt" ADD CONSTRAINT "ScormAttempt_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ScormPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScormAttempt" ADD CONSTRAINT "ScormAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "ScormPackage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScormPackage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ScormPackage" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

ALTER TABLE "ScormAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScormAttempt" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ScormAttempt" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- Grant by name: a blanket GRANT ... ON ALL TABLES would hand UPDATE/DELETE on "AuditLog" back to
-- the application role (see 20261018000000_audit_append_only).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ScormPackage" TO lms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ScormAttempt" TO lms_app;
  END IF;
END $$;
