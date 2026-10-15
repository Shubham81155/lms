-- SAML 2.0 single sign-on: one provider per tenant (public material only).

-- CreateTable
CREATE TABLE "SamlConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entryPoint" TEXT NOT NULL,
    "idpIssuer" TEXT NOT NULL,
    "idpCert" TEXT NOT NULL,
    "emailAttribute" TEXT NOT NULL DEFAULT 'email',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "allowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SamlConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SamlConnection_tenantId_key" ON "SamlConnection"("tenantId");

-- AddForeignKey
ALTER TABLE "SamlConnection" ADD CONSTRAINT "SamlConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SamlConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SamlConnection" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SamlConnection"
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- Grant by name: a blanket GRANT ... ON ALL TABLES would hand UPDATE/DELETE on "AuditLog" back to
-- the application role (see 20261018000000_audit_append_only).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "SamlConnection" TO lms_app;
  END IF;
END $$;
