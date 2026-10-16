-- An organisation's own AI provider, model and (encrypted) API key.

CREATE TABLE "TenantAiConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKeyEnc" TEXT,
    "keyHint" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantAiConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantAiConfig_tenantId_key" ON "TenantAiConfig"("tenantId");

ALTER TABLE "TenantAiConfig" ADD CONSTRAINT "TenantAiConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TenantAiConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantAiConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantAiConfig" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- Grant by name: a blanket GRANT ... ON ALL TABLES would hand UPDATE/DELETE on "AuditLog" back to
-- the application role (see 20261018000000_audit_append_only).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "TenantAiConfig" TO lms_app;
  END IF;
END $$;
