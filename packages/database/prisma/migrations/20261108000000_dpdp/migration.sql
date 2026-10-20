-- DPDP Act readiness: consent purposes and the append-only consent history, the breach register, the grievance
-- officer, and a minor's guardian consent (apps/api/src/lib/consent.ts, breaches.ts, guardian.ts).

ALTER TABLE "Tenant" ADD COLUMN "grievanceName" TEXT,
  ADD COLUMN "grievanceEmail" TEXT,
  ADD COLUMN "grievancePhone" TEXT,
  ADD COLUMN "grievanceAddress" TEXT,
  ADD COLUMN "grievanceSlaDays" INTEGER;

ALTER TABLE "User" ADD COLUMN "isMinor" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "guardianEmail" TEXT,
  ADD COLUMN "guardianConsentAt" TIMESTAMP(3);

CREATE TABLE "ConsentPurpose" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "lawfulBasis" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentPurpose_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConsentPurpose_tenantId_key_key" ON "ConsentPurpose"("tenantId", "key");

CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purposeId" TEXT NOT NULL,
    "purposeKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "textSnapshot" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ConsentRecord_tenantId_userId_purposeKey_createdAt_idx" ON "ConsentRecord"("tenantId", "userId", "purposeKey", "createdAt");
CREATE INDEX "ConsentRecord_tenantId_purposeKey_createdAt_idx" ON "ConsentRecord"("tenantId", "purposeKey", "createdAt");
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DataBreach" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "affectedEstimate" INTEGER,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DETECTED',
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "containment" TEXT,
    "ownerId" TEXT,
    "boardNotifiedAt" TIMESTAMP(3),
    "peopleNotifiedAt" TIMESTAMP(3),
    "noNotificationReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3) NOT NULL,
    "reminderStage" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataBreach_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DataBreach_tenantId_status_dueAt_idx" ON "DataBreach"("tenantId", "status", "dueAt");

CREATE TABLE "GuardianConsentRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "guardianEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardianConsentRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GuardianConsentRequest_tokenHash_key" ON "GuardianConsentRequest"("tokenHash");
CREATE INDEX "GuardianConsentRequest_tenantId_userId_idx" ON "GuardianConsentRequest"("tenantId", "userId");

-- Row-level security on the organisation's own records.
ALTER TABLE "ConsentPurpose" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsentPurpose" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ConsentPurpose" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
ALTER TABLE "ConsentRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsentRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ConsentRecord" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
ALTER TABLE "DataBreach" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataBreach" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DataBreach" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
ALTER TABLE "GuardianConsentRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuardianConsentRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "GuardianConsentRequest" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- Named tables only (AuditLog keeps its revoked UPDATE/DELETE). The consent history is append-only for the runtime
-- role, like the audit trail: it may read and insert, and the rows go with the organisation through the cascade
-- (foreign-key actions run with the owner's rights). The default privileges of 20261012000001_row_level_security
-- grant everything on new tables, so UPDATE and DELETE are revoked explicitly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ConsentPurpose", "DataBreach", "GuardianConsentRequest" TO lms_app;
    GRANT SELECT, INSERT ON TABLE "ConsentRecord" TO lms_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "ConsentRecord" FROM lms_app;
  END IF;
END $$;
