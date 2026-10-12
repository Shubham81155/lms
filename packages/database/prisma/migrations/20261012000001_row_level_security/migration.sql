-- Row-Level Security: tenant isolation enforced by PostgreSQL itself.
--
-- The API sets the tenant for each query with
--   SELECT set_config('app.current_tenant_id', '<tenant id>', true)
-- inside the same transaction. When it is unset or empty, app_current_tenant() is NULL, every
-- comparison is NULL, and NO rows are visible or writable (fail closed).
--
-- RLS does not apply to superusers or roles with BYPASSRLS. The runtime role (lms_app, see
-- docs/architecture/multi_tenancy.md) must be neither. FORCE makes it apply to table owners too.
--
-- Deliberately not covered by RLS:
--   "Tenant"                  needed to resolve a tenant (slug / domain) before one is known.
--   "PasswordResetToken",
--   "EmailVerificationToken"  looked up by the SHA-256 hash of a 256-bit secret emailed to the user.

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS text
LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.current_tenant_id', true), '') $$;

-- 1. Tables that carry "tenantId" directly
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'User', 'Campus', 'Course', 'Enrollment', 'Quiz', 'Assignment', 'AuditLog', 'LtiDeployment'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant())',
      t
    );
  END LOOP;
END $$;

-- 2. Child tables: a row is visible only if its parent is. The parent lookup is itself subject
--    to the parent's policy, so isolation chains down to the tenant-scoped root.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('Department',           'Campus',         'campusId'),
    ('CourseInstructor',     'Course',         'courseId'),
    ('Module',               'Course',         'courseId'),
    ('Lesson',               'Module',         'moduleId'),
    ('Certificate',          'Enrollment',     'enrollmentId'),
    ('QuizQuestion',         'Quiz',           'quizId'),
    ('QuizSubmission',       'Quiz',           'quizId'),
    ('ProctoringLog',        'QuizSubmission', 'submissionId'),
    ('AssignmentSubmission', 'Assignment',     'assignmentId'),
    ('UserGuardian',         'User',           'studentId')
  ) AS v(child, parent, fk)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.child);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.child);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %1$I USING (EXISTS (SELECT 1 FROM %2$I p WHERE p."id" = %1$I.%3$I)) WITH CHECK (EXISTS (SELECT 1 FROM %2$I p WHERE p."id" = %1$I.%3$I))',
      r.child, r.parent, r.fk
    );
  END LOOP;
END $$;

-- 3. Privileges for the runtime role, if it exists (create it before running migrations; see docs).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT USAGE ON SCHEMA public TO lms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lms_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lms_app;
    GRANT EXECUTE ON FUNCTION app_current_tenant() TO lms_app;
    REVOKE ALL ON TABLE "_prisma_migrations" FROM lms_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lms_app;
  END IF;
END $$;
