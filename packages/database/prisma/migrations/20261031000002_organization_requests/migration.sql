-- Requests from institutions to get an organisation on the platform. Platform-level: no tenant yet, so no
-- row-level security; only the platform operator's routes read them. A slug can be pending for one request
-- at a time.

CREATE TABLE "OrganizationRequest" (
    "id" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "institutionType" TEXT NOT NULL,
    "country" TEXT,
    "website" TEXT,
    "expectedLearners" INTEGER,
    "contactFirstName" TEXT NOT NULL,
    "contactLastName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByEmail" TEXT,
    "createdTenantId" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrganizationRequest_status_createdAt_idx" ON "OrganizationRequest"("status", "createdAt");
CREATE UNIQUE INDEX "OrganizationRequest_pending_slug_key" ON "OrganizationRequest"("slug") WHERE "status" = 'PENDING';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "OrganizationRequest" TO lms_app;
  END IF;
END $$;
