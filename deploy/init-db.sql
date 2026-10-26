-- Runs once on first start of the compose database (as the superuser). Creates the unprivileged
-- application role that row-level security applies to; see packages/database/sql/create_app_role.sql.
CREATE ROLE lms_app LOGIN PASSWORD 'lms_app_dev_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE lms_preview TO lms_app;
