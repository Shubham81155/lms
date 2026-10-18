-- Virus scanning of uploads. Files stored before a scanner was configured stay NOT_SCANNED until the
-- background sweep (apps/api/src/lib/virus-scan.ts) has looked at them.

ALTER TABLE "StoredFile" ADD COLUMN "scanStatus" TEXT NOT NULL DEFAULT 'NOT_SCANNED',
ADD COLUMN "scannedAt" TIMESTAMP(3);

CREATE INDEX "StoredFile_scanStatus_idx" ON "StoredFile"("scanStatus");
