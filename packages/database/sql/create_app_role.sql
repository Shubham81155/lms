-- Run ONCE as a superuser, before `npm run db:deploy`. Replace the password.
--
-- lms_app is the role the API connects with (DATABASE_URL). It must NOT be a superuser, must NOT
-- have BYPASSRLS, and must NOT own the tables, otherwise row-level security is silently skipped.
-- Migrations and the seed use a privileged role (DIRECT_URL).
CREATE ROLE lms_app LOGIN PASSWORD 'CHANGE_ME' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE lms_preview TO lms_app;
