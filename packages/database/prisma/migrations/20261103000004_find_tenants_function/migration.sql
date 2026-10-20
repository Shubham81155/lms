-- "Find my organisation": which organisations an e-mail address has an active or invited account with. Users are
-- tenant-scoped under row-level security, so the runtime role (lms_app) cannot look across organisations. This
-- function can, and returns nothing but organisation ids:
--   * SECURITY DEFINER, owned by the role running migrations, with a fixed search_path;
--   * EXECUTE only for lms_app (not PUBLIC);
--   * "User" has FORCE ROW LEVEL SECURITY, which applies to its owner too, so the owner gets one extra policy:
--     it may read users only while app.find_tenants_for_email is 'on', which only this function sets (its SET
--     clause, undone when the function returns). The policy is for the owner only; setting the variable as
--     lms_app changes nothing. A superuser running migrations bypasses RLS anyway, and the policy is then unused.

CREATE INDEX "User_email_idx" ON "User"("email");

CREATE OR REPLACE FUNCTION find_tenants_for_email(lookup_email text) RETURNS TABLE(tenant_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
SET app.find_tenants_for_email = 'on'
AS $$
  SELECT DISTINCT u."tenantId"
  FROM public."User" u
  WHERE u."email" = lower(lookup_email)
    AND u."status" IN ('ACTIVE'::public."UserStatus", 'INVITED'::public."UserStatus")
$$;

REVOKE ALL ON FUNCTION find_tenants_for_email(text) FROM PUBLIC;

DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY find_tenants_for_email ON "User" FOR SELECT TO %I USING (current_setting(''app.find_tenants_for_email'', true) = ''on'')',
    current_user
  );
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT EXECUTE ON FUNCTION find_tenants_for_email(text) TO lms_app;
  END IF;
END $$;
