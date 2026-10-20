-- Data-subject request queue and per-organisation retention policy (apps/api/src/lib/data-requests.ts, lib/retention.ts).

CREATE TABLE "DataRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "assignedToId" TEXT,
    "notes" TEXT,
    "resolution" TEXT,
    "exportAttached" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "reminderStage" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DataRequest_tenantId_status_dueAt_idx" ON "DataRequest"("tenantId", "status", "dueAt");
CREATE INDEX "DataRequest_tenantId_requesterId_receivedAt_idx" ON "DataRequest"("tenantId", "requesterId", "receivedAt");

CREATE TABLE "RetentionPolicy" (
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "notificationsDays" INTEGER,
    "tokensDays" INTEGER,
    "proctoringDays" INTEGER,
    "supportAccessDays" INTEGER,
    "infectedFilesDays" INTEGER,
    "lastRunAt" TIMESTAMP(3),
    "lastRunDryRun" BOOLEAN,
    "lastRunJson" JSONB,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("tenantId")
);

-- Row-level security on the organisation's own records (no foreign key to "Tenant", like "SupportPass").
ALTER TABLE "DataRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DataRequest" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
ALTER TABLE "RetentionPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RetentionPolicy" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RetentionPolicy" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- Named tables only: AuditLog must keep its revoked UPDATE/DELETE (see 20261018000000_audit_append_only).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "DataRequest", "RetentionPolicy" TO lms_app;
  END IF;
END $$;
