#!/bin/sh
# Production counterpart of init-db.sql, mounted by docker-compose.prod.yml into /docker-entrypoint-initdb.d.
# Runs once, on the first start of an EMPTY database volume (postgres entrypoint, as POSTGRES_USER). Creates the
# unprivileged role the API connects with (DATABASE_URL); row-level security only applies to a role that is not
# a superuser, has no BYPASSRLS and owns no tables. Its password comes from LMS_APP_DB_PASSWORD, never from this
# file. Migrations run as POSTGRES_USER (DIRECT_URL, the "migrate" service) and grant lms_app the rest.
#
# The entrypoint sources this file when it is not executable (a checkout on Windows, or without the x bit), so it
# avoids `set -u` and anything else that would leak into the entrypoint's shell. It must have LF line endings.
#
# Changing LMS_APP_DB_PASSWORD later does NOT re-run this: change it in the database too, e.g.
#   docker compose -f docker-compose.prod.yml exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
#     -c "ALTER ROLE lms_app PASSWORD '<new password>'"
set -e
: "${LMS_APP_DB_PASSWORD:?LMS_APP_DB_PASSWORD must be set}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
	-v app_pw="$LMS_APP_DB_PASSWORD" -v db="$POSTGRES_DB" <<'SQL'
CREATE ROLE lms_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE :"db" TO lms_app;
SQL
