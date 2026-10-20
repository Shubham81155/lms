-- A live custom domain is re-checked periodically: its TXT record must stay. A definite failure (no record, or a
-- different value) starts a grace period; the administrators are warned once, and after the grace period the
-- domain is removed (the organisation keeps its subdomain). A success clears the failure.
ALTER TABLE "Tenant" ADD COLUMN "customDomainLiveToken" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "customDomainRecheckedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "customDomainRecheckError" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "customDomainFailingSince" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "customDomainWarnedAt" TIMESTAMP(3);

-- Live domains proved before this migration lost their token on verification, and domains the platform operator
-- set directly never had one: those have no "customDomainLiveToken" and are not re-checked.
