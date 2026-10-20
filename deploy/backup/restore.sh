#!/bin/sh
# Restores a backup made by backup.sh.
#   restore.sh <dump|dump.enc> [target database]
# Without a target the dump goes into a NEW database "<db>_restored" (nothing is overwritten): inspect it, or point the
# stack at it. To replace the live database (disaster recovery), stop the api first and name it explicitly:
#   docker compose -f docker-compose.prod.yml stop api caddy web
#   docker compose -f docker-compose.prod.yml --profile backup run --rm -e RESTORE_CONFIRM=enterprise_lms \
#       backup restore.sh /backups/enterprise_lms-<stamp>.dump enterprise_lms
# which drops that database and loads the dump into a fresh one. Needs the owner/superuser (PGUSER/PGPASSWORD).
. /usr/local/bin/common.sh

SRC="${1:-}"; TARGET="${2:-${PGDATABASE}_restored}"
[ -n "$SRC" ] || die "usage: restore.sh <dump file> [target database]"
[ -f "$SRC" ] || die "no such file: $SRC"
case "$TARGET" in *[!A-Za-z0-9_]*|'') die "the target database name may only contain letters, digits and underscores" ;; esac

LIVE=0
[ "$TARGET" = "$PGDATABASE" ] && LIVE=1
if [ "$LIVE" = 1 ] && [ "${RESTORE_CONFIRM:-}" != "$PGDATABASE" ]; then
  die "this would DROP the live database $PGDATABASE. Stop the api, then run again with RESTORE_CONFIRM=$PGDATABASE"
fi

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
dump="$(plain_copy "$SRC" "$tmp")" || exit 1
pg_restore --list "$dump" > /dev/null || die "$SRC is not a readable dump"

# Connect to the maintenance database, not the one being replaced.
export PGDATABASE=postgres
if psql -Atqc "SELECT 1 FROM pg_database WHERE datname = '$TARGET'" | grep -q 1; then
  [ "$LIVE" = 1 ] || die "database $TARGET already exists: drop it first (psql -c 'DROP DATABASE $TARGET') or choose another name"
  log "dropping $TARGET (connections are terminated)"
  psql -qc "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$TARGET' AND pid <> pg_backend_pid()" > /dev/null
  dropdb "$TARGET"
fi
createdb "$TARGET"
log "restoring $SRC into $TARGET"
# Owner and grants come from the dump (objects owned by the migration role, privileges for lms_app); that role must
# exist in this cluster, which the first-start init script guarantees. Errors on single objects are reported at the end.
if ! pg_restore --dbname="$TARGET" --no-owner --exit-on-error "$dump"; then
  die "pg_restore reported errors; $TARGET may be incomplete"
fi
log "restore finished into $TARGET"
if [ "$LIVE" = 1 ]; then
  log "start the stack again: docker compose -f docker-compose.prod.yml up -d (migrate checks the schema first)"
fi
