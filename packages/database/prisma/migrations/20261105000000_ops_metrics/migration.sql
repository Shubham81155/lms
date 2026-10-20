-- Queue depths for GET /metrics: how many e-mails wait to be sent and how many webhook deliveries wait for a retry,
-- across all organisations. Both tables are tenant-scoped under forced row-level security, so the runtime role
-- (lms_app) cannot count across organisations. This function can, and returns nothing but two numbers:
--   * SECURITY DEFINER, owned by the role running migrations, with a fixed search_path;
--   * EXECUTE only for lms_app (not PUBLIC);
--   * both tables have FORCE ROW LEVEL SECURITY, which applies to the owner too, so the owner gets one extra
--     read policy on each: it may read rows only while app.ops_queue_depths is 'on', which only this function sets
--     (its SET clause, undone when the function returns). Setting the variable as lms_app changes nothing, the
--     policies are for the owner only. A superuser running migrations bypasses RLS anyway; the policies are then unused.

CREATE OR REPLACE FUNCTION ops_queue_depths() RETURNS TABLE(email_pending bigint, webhook_retry bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
SET app.ops_queue_depths = 'on'
AS $$
  SELECT
    (SELECT count(*) FROM public."Notification" WHERE "emailStatus" = 'PENDING'),
    (SELECT count(*) FROM public."WebhookDelivery" WHERE "nextAttemptAt" IS NOT NULL)
$$;

REVOKE ALL ON FUNCTION ops_queue_depths() FROM PUBLIC;

DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY ops_queue_depths ON "Notification" FOR SELECT TO %I USING (current_setting(''app.ops_queue_depths'', true) = ''on'')',
    current_user
  );
  EXECUTE format(
    'CREATE POLICY ops_queue_depths ON "WebhookDelivery" FOR SELECT TO %I USING (current_setting(''app.ops_queue_depths'', true) = ''on'')',
    current_user
  );
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT EXECUTE ON FUNCTION ops_queue_depths() TO lms_app;
  END IF;
END $$;
