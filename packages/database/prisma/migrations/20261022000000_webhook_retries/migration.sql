ALTER TABLE "WebhookDelivery" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WebhookDelivery" ADD COLUMN "payload" TEXT;
ALTER TABLE "WebhookDelivery" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX "WebhookDelivery_tenantId_nextAttemptAt_idx" ON "WebhookDelivery"("tenantId", "nextAttemptAt");
