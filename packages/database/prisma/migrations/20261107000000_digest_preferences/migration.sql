-- Digest e-mails (apps/api/src/lib/digest.ts): one summary per day or week instead of (or besides) single e-mails.
-- Added to NotificationPreference, which already has row-level security. A user without a row gets the defaults
-- below, so the digest job creates the row when it first looks at the user.
ALTER TABLE "NotificationPreference" ADD COLUMN "digestFrequency" TEXT NOT NULL DEFAULT 'WEEKLY';
ALTER TABLE "NotificationPreference" ADD COLUMN "digestHour" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "NotificationPreference" ADD COLUMN "digestWeekday" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "NotificationPreference" ADD COLUMN "digestSections" TEXT[] NOT NULL DEFAULT ARRAY['deadlines','announcements','grades','forum','live']::TEXT[];
ALTER TABLE "NotificationPreference" ADD COLUMN "lastDigestAt" TIMESTAMP(3);

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_digestFrequency_check" CHECK ("digestFrequency" IN ('OFF', 'DAILY', 'WEEKLY'));
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_digestHour_check" CHECK ("digestHour" BETWEEN 0 AND 23);
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_digestWeekday_check" CHECK ("digestWeekday" BETWEEN 0 AND 6);
