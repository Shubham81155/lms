-- The audit trail is append-only for the application. The runtime role may read and insert audit
-- rows but can no longer update or delete them, so a compromised API process cannot rewrite history.
--
-- Foreign-key actions (e.g. ON DELETE SET NULL when a user is removed) run with the table owner's
-- rights and are unaffected. Later migrations must not re-grant UPDATE or DELETE on "AuditLog":
-- when granting to lms_app, name the new tables instead of using ON ALL TABLES.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "AuditLog" FROM lms_app;
  END IF;
END $$;
