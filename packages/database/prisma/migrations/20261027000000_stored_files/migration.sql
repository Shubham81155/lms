-- Uploaded files. The bytes live in the storage driver (local folder or S3); this is the record of each one.

CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerId" TEXT,
    "courseId" TEXT,
    "purpose" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoredFile_storageKey_key" ON "StoredFile"("storageKey");
CREATE INDEX "StoredFile_tenantId_ownerId_idx" ON "StoredFile"("tenantId", "ownerId");
CREATE INDEX "StoredFile_courseId_idx" ON "StoredFile"("courseId");

ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StoredFile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoredFile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StoredFile" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- Grant by name: a blanket GRANT ... ON ALL TABLES would hand UPDATE/DELETE on "AuditLog" back to
-- the application role (see 20261018000000_audit_append_only).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "StoredFile" TO lms_app;
  END IF;
END $$;
