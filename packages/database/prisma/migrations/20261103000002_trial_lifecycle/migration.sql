-- Trials (lib/trial.ts): when a TRIAL organisation's trial ends, which reminders went out, and when it expired
-- (read-only grace before suspension). Existing organisations have no trial.
ALTER TABLE "Tenant" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "trialRemindersSent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Tenant" ADD COLUMN "trialExpiredAt" TIMESTAMP(3);
-- The background job looks for trials to remind about, expire or suspend.
CREATE INDEX "Tenant_status_trialEndsAt_idx" ON "Tenant"("status", "trialEndsAt");
