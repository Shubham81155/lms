-- Custom domains need proof of ownership (a DNS TXT record) before they resolve to an organisation. A requested
-- domain waits in "pendingCustomDomain"; "customDomain" holds only the verified, live one.
ALTER TABLE "Tenant" ADD COLUMN "pendingCustomDomain" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "customDomainToken" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "customDomainRequestedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "customDomainCheckedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "customDomainError" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "customDomainVerifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Tenant_pendingCustomDomain_key" ON "Tenant"("pendingCustomDomain");

-- Domains set before verification existed were entered by the platform operator and are already in use:
-- they stay live, counted as verified now, so no organisation loses its address.
UPDATE "Tenant" SET "customDomainVerifiedAt" = CURRENT_TIMESTAMP WHERE "customDomain" IS NOT NULL;
