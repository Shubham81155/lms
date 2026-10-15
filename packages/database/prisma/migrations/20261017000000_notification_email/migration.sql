-- E-mail delivery state for notifications. Existing rows stay NONE so history is never e-mailed.
ALTER TABLE "Notification"
  ADD COLUMN "emailStatus" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "emailAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "emailedAt" TIMESTAMP(3);

CREATE INDEX "Notification_tenantId_emailStatus_createdAt_idx" ON "Notification"("tenantId", "emailStatus", "createdAt");
