-- Organisation offboarding: full data exports and scheduled deletion (apps/api/src/lib/offboarding.ts).

-- A scheduled deletion: the organisation stays usable until "deletionScheduledAt", and it can be cancelled until then.
ALTER TABLE "Tenant" ADD COLUMN "deletionScheduledAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "deletionRequestedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "deletionRequestedBy" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "deletionByOperator" BOOLEAN NOT NULL DEFAULT false;

-- Export jobs. Platform-level (no row-level security) and without a foreign key to "Tenant": the background job
-- picks them up across organisations, and the final export taken before a deletion outlives the organisation.
CREATE TABLE "TenantExport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestedById" TEXT,
    "requestedByTenantId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "storageKey" TEXT,
    "sizeBytes" BIGINT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "TenantExport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantExport_storageKey_key" ON "TenantExport"("storageKey");
CREATE INDEX "TenantExport_tenantId_createdAt_idx" ON "TenantExport"("tenantId", "createdAt");
CREATE INDEX "TenantExport_status_createdAt_idx" ON "TenantExport"("status", "createdAt");

-- Tombstones of deleted organisations: the platform operator's record, and the address stays reserved for a while.
CREATE TABLE "TenantDeletion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedBy" TEXT,
    "finalExportId" TEXT,
    "finalExportKey" TEXT,
    "slugHeldUntil" TIMESTAMP(3) NOT NULL,
    "summaryJson" JSONB,

    CONSTRAINT "TenantDeletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantDeletion_tenantId_key" ON "TenantDeletion"("tenantId");
CREATE INDEX "TenantDeletion_slug_slugHeldUntil_idx" ON "TenantDeletion"("slug", "slugHeldUntil");
CREATE INDEX "TenantDeletion_deletedAt_idx" ON "TenantDeletion"("deletedAt");

-- Named tables only: AuditLog must keep its revoked UPDATE/DELETE (see 20261018000000_audit_append_only).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "TenantExport" TO lms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "TenantDeletion" TO lms_app;
  END IF;
END $$;
