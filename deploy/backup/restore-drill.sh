#!/bin/sh
# Restore drill: proves the newest backup can really be restored. Loads it into a scratch database next to the live
# one, checks it, drops the scratch database, and exits 0 only if everything held. Never touches the live database.
#   docker compose -f docker-compose.prod.yml --profile backup run --rm backup restore-drill.sh [dump file]
# Checks: the dump is readable; the restore completes; each table in DRILL_REQUIRED_TABLES (default "Tenant User")
# has rows; the migration history matches the live database's (same count and same latest migration, unless the live
# database moved on since the backup, which is reported as a note, not a failure); the age of the backup is shown.
. /usr/local/bin/common.sh

REQUIRED="${DRILL_REQUIRED_TABLES:-Tenant User}"
SRC="${1:-$(newest_dump)}"
[ -n "$SRC" ] && [ -f "$SRC" ] || die "no backup found in $BACKUP_DIR"
LIVE_DB="$PGDATABASE"
SCRATCH="drill_$(date -u +%Y%m%d%H%M%S)"

tmp="$(mktemp -d)"
cleanup() {
  PGDATABASE=postgres psql -qc "DROP DATABASE IF EXISTS \"$SCRATCH\"" > /dev/null 2>&1
  rm -rf "$tmp"
}
trap cleanup EXIT

age_h=$(( ( $(date +%s) - $(stat -c %Y "$SRC") ) / 3600 ))
log "drill: $SRC (written ${age_h}h ago), scratch database $SCRATCH"
dump="$(plain_copy "$SRC" "$tmp")" || exit 1
pg_restore --list "$dump" > /dev/null || die "the dump is not readable"

PGDATABASE=postgres createdb "$SCRATCH" || die "cannot create the scratch database (needs a superuser/owner role)"
pg_restore --dbname="$SCRATCH" --no-owner --no-privileges --exit-on-error "$dump" || die "pg_restore failed"
log "restored; checking"

fails=0
q() { psql -At -d "$1" -c "$2"; }

for t in $REQUIRED; do
  n="$(q "$SCRATCH" "SELECT count(*) FROM \"$t\"" 2>/dev/null)" || n=""
  if [ -z "$n" ]; then log "FAIL  table \"$t\" is missing"; fails=$((fails + 1))
  elif [ "$n" -gt 0 ]; then log "ok    \"$t\": $n rows"
  else log "FAIL  table \"$t\" is empty"; fails=$((fails + 1)); fi
done

# Informational counts of other core tables.
for t in Course Enrollment; do
  n="$(q "$SCRATCH" "SELECT count(*) FROM \"$t\"" 2>/dev/null)" && log "info  \"$t\": $n rows"
done

mig() { q "$1" "SELECT count(*) || ' ' || coalesce(max(migration_name), '-') FROM _prisma_migrations WHERE finished_at IS NOT NULL" 2>/dev/null; }
m_scratch="$(mig "$SCRATCH")"; m_live="$(mig "$LIVE_DB")"
if [ -z "$m_scratch" ]; then
  log "FAIL  no _prisma_migrations table in the restored copy"; fails=$((fails + 1))
elif [ -z "$m_live" ]; then
  log "note  could not read the live migration history; restored copy has: $m_scratch"
elif [ "$m_scratch" = "$m_live" ]; then
  log "ok    migrations match the live database ($m_scratch)"
else
  log "note  migrations differ (backup: $m_scratch, live: $m_live): expected if the app was upgraded after the backup"
fi

if [ "$fails" -gt 0 ]; then log "DRILL FAILED ($fails problem(s))" >&2; exit 1; fi
log "DRILL PASSED"
