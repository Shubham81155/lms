-- LTI launch replay protection: the nonce of every accepted launch token is kept until the token would have expired.

CREATE TABLE "LtiNonce" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LtiNonce_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LtiNonce_tenantId_issuer_nonce_key" ON "LtiNonce"("tenantId", "issuer", "nonce");
CREATE INDEX "LtiNonce_expiresAt_idx" ON "LtiNonce"("expiresAt");
ALTER TABLE "LtiNonce" ADD CONSTRAINT "LtiNonce_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LtiNonce" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LtiNonce" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LtiNonce" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
