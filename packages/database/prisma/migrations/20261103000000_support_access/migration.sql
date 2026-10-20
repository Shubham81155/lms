-- Consented support access (apps/api/src/lib/support-access.ts). An organisation's administrator grants the
-- platform operator a time-limited support pass; the operator enters the organisation through a one-time
-- handoff link and works there as the organisation's "Platform support" account until the pass ends.

-- Passes belong to the organisation that granted them: row-level security like every tenant table. Without a
-- foreign key to "Tenant", like "TenantExport": the schema keeps tenant relations off these platform records.
CREATE TABLE "SupportPass" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'READ_ONLY',
    "reason" TEXT NOT NULL,
    "grantedById" TEXT,
    "grantedByEmail" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByEmail" TEXT,
    "lastEnteredAt" TIMESTAMP(3),
    "lastEnteredByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportPass_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportPass_tenantId_createdAt_idx" ON "SupportPass"("tenantId", "createdAt");
CREATE INDEX "SupportPass_expiresAt_idx" ON "SupportPass"("expiresAt");

ALTER TABLE "SupportPass" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportPass" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupportPass" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- One-time handoff tokens. Like "PasswordResetToken", not covered by row-level security: consumed before the
-- organisation is otherwise known, and looked up only by the SHA-256 hash of a 256-bit secret.
CREATE TABLE "SupportHandoff" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "passId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "operatorUserId" TEXT,
    "operatorEmail" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportHandoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupportHandoff_tokenHash_key" ON "SupportHandoff"("tokenHash");
CREATE INDEX "SupportHandoff_passId_idx" ON "SupportHandoff"("passId");

-- The platform operator's list of passes in force, across organisations. The runtime role (lms_app) only sees
-- one organisation's rows, so this function reads them, as find_tenants_for_email (20261103000004) does:
--   * SECURITY DEFINER, owned by the role running migrations, with a fixed search_path;
--   * EXECUTE only for lms_app (not PUBLIC);
--   * "SupportPass" has FORCE ROW LEVEL SECURITY, so the owner gets one extra policy: it may read passes only
--     while app.list_support_passes is 'on', which only this function sets (its SET clause, undone on return).
CREATE OR REPLACE FUNCTION active_support_passes() RETURNS TABLE(
    id text, tenant_id text, tenant_slug text, tenant_name text, tenant_status text, scope text, reason text,
    granted_by_email text, created_at timestamp(3), expires_at timestamp(3), last_entered_at timestamp(3), last_entered_by_email text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
SET app.list_support_passes = 'on'
AS $$
  SELECT p."id", p."tenantId", t."slug", t."name", t."status"::text, p."scope", p."reason",
         p."grantedByEmail", p."createdAt", p."expiresAt", p."lastEnteredAt", p."lastEnteredByEmail"
  FROM public."SupportPass" p
  JOIN public."Tenant" t ON t."id" = p."tenantId"
  WHERE p."revokedAt" IS NULL AND p."expiresAt" > (now() AT TIME ZONE 'UTC')
  ORDER BY p."expiresAt"
$$;

REVOKE ALL ON FUNCTION active_support_passes() FROM PUBLIC;

-- Named tables only: AuditLog must keep its revoked UPDATE/DELETE (see 20261018000000_audit_append_only).
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY list_support_passes ON "SupportPass" FOR SELECT TO %I USING (current_setting(''app.list_support_passes'', true) = ''on'')',
    current_user
  );
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "SupportPass" TO lms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "SupportHandoff" TO lms_app;
    GRANT EXECUTE ON FUNCTION active_support_passes() TO lms_app;
  END IF;
END $$;
