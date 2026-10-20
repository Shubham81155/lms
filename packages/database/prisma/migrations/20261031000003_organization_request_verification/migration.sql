-- Organisation requests: the applicant confirms their e-mail before the request reaches the operator, and a
-- request holds its address only for a while (24 hours unconfirmed, 30 days waiting for a decision). The
-- hold is a flag rather than the status, so an expired hold can be released while the request stays visible.

ALTER TABLE "OrganizationRequest"
  ADD COLUMN "verificationTokenHash" TEXT,
  ADD COLUMN "verificationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "holdsSlug" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "holdExpiresAt" TIMESTAMP(3);

ALTER TABLE "OrganizationRequest" ALTER COLUMN "status" SET DEFAULT 'UNVERIFIED';

-- Requests sent before confirmation existed already reached the operator: treat them as confirmed.
UPDATE "OrganizationRequest" SET "verifiedAt" = "createdAt" WHERE "status" <> 'UNVERIFIED';
UPDATE "OrganizationRequest"
   SET "holdsSlug" = true, "holdExpiresAt" = GREATEST("createdAt", CURRENT_TIMESTAMP) + INTERVAL '30 days'
 WHERE "status" = 'PENDING';

DROP INDEX "OrganizationRequest_pending_slug_key";
CREATE UNIQUE INDEX "OrganizationRequest_held_slug_key" ON "OrganizationRequest"("slug") WHERE "holdsSlug";
CREATE UNIQUE INDEX "OrganizationRequest_verificationTokenHash_key" ON "OrganizationRequest"("verificationTokenHash");
CREATE INDEX "OrganizationRequest_contactEmail_idx" ON "OrganizationRequest"("contactEmail");
