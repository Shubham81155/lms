-- Columns that nothing reads or writes.
--   User.ssnEncrypted / User.dateOfBirthEnc: never collected; the LMS does not need an SSN or birth date.
--   Tenant.customCss: stored but never rendered, and unsanitised CSS would be an injection risk if it were.
--   Course.enableProctoring: the setting that applies is Quiz.requireProctoring.

ALTER TABLE "User" DROP COLUMN IF EXISTS "ssnEncrypted";
ALTER TABLE "User" DROP COLUMN IF EXISTS "dateOfBirthEnc";
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "customCss";
ALTER TABLE "Course" DROP COLUMN IF EXISTS "enableProctoring";
