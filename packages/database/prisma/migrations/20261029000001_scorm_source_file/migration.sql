-- The zip a SCORM package was unpacked from, so a virus scan that later finds malware in the zip withdraws
-- the package too.

ALTER TABLE "ScormPackage" ADD COLUMN "sourceFileId" TEXT;

ALTER TABLE "ScormPackage" ADD CONSTRAINT "ScormPackage_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ScormPackage_sourceFileId_idx" ON "ScormPackage"("sourceFileId");

-- Existing packages: a package is created right after its zip is uploaded, so its source is the newest SCORM
-- zip the same person uploaded to the same course before it.
UPDATE "ScormPackage" p SET "sourceFileId" = (
  SELECT f."id" FROM "StoredFile" f
  WHERE f."purpose" = 'SCORM_PACKAGE' AND f."tenantId" = p."tenantId" AND f."courseId" = p."courseId"
    AND f."ownerId" IS NOT DISTINCT FROM p."uploadedById" AND f."createdAt" <= p."createdAt"
  ORDER BY f."createdAt" DESC
  LIMIT 1
);
