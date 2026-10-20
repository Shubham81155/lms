#!/bin/sh
# Backs up the application database with pg_dump -Fc.
#   backup.sh once   one backup now, then exit (exit code 0 on success)
#   backup.sh loop   (default) a backup every day at BACKUP_AT (UTC), and one at start-up if the last is >24h old;
#                    meanwhile serves the freshness metrics on :9199/backup.txt for Prometheus.
# Settings (environment): PGHOST/PGUSER/PGPASSWORD/PGDATABASE (the owner or a superuser), BACKUP_DIR (/backups),
# BACKUP_KEEP_DAYS (14), BACKUP_AT (02:30), BACKUP_ENCRYPTION_PASSPHRASE (optional: AES-256, file gets ".enc"),
# BACKUP_S3_BUCKET (+ BACKUP_S3_PREFIX, BACKUP_S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
# AWS_DEFAULT_REGION) for an off-server copy. A failed upload makes the whole backup count as failed.
. /usr/local/bin/common.sh

KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
AT="${BACKUP_AT:-02:30}"
METRICS_DIR="$BACKUP_DIR/metrics"
METRICS="$METRICS_DIR/backup.txt"

# The timestamp of the last good backup, kept across failures and restarts.
last_success() {
  [ -f "$METRICS" ] && sed -n 's/^backup_last_success_timestamp_seconds \([0-9][0-9]*\).*/\1/p' "$METRICS" | head -n 1
}

# write_metrics <ok 0|1> <success ts> <size bytes> <duration s>
write_metrics() {
  mkdir -p "$METRICS_DIR"
  tmp="$METRICS.tmp"
  {
    echo '# HELP backup_last_success_timestamp_seconds Unix time of the last successful database backup (0: never).'
    echo '# TYPE backup_last_success_timestamp_seconds gauge'
    echo "backup_last_success_timestamp_seconds $2"
    echo '# HELP backup_last_run_success 1 if the most recent backup run succeeded, 0 if it failed.'
    echo '# TYPE backup_last_run_success gauge'
    echo "backup_last_run_success $1"
    echo '# HELP backup_last_size_bytes Size of the most recent successful backup file.'
    echo '# TYPE backup_last_size_bytes gauge'
    echo "backup_last_size_bytes $3"
    echo '# HELP backup_last_duration_seconds How long the most recent backup run took.'
    echo '# TYPE backup_last_duration_seconds gauge'
    echo "backup_last_duration_seconds $4"
    echo '# HELP backup_files Number of backup files kept locally.'
    echo '# TYPE backup_files gauge'
    echo "backup_files $(ls -1 "$BACKUP_DIR"/"$PGDATABASE"-*.dump* 2>/dev/null | wc -l)"
  } > "$tmp" && mv "$tmp" "$METRICS"
}

fail() {
  write_metrics 0 "$prev" 0 "$(( $(date +%s) - start ))"
  log "ERROR: $1" >&2
  return 1
}

run_backup() {
  start=$(date +%s)
  ok=1
  prev="$(last_success)"; prev="${prev:-0}"
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  base="$BACKUP_DIR/$PGDATABASE-$stamp.dump"
  mkdir -p "$BACKUP_DIR"
  log "backup of $PGDATABASE on $PGHOST started"

  pg_dump -Fc -f "$base.partial" || { rm -f "$base.partial"; fail "pg_dump failed"; return 1; }
  # A dump that cannot be listed is not a backup.
  pg_restore --list "$base.partial" > /dev/null || { rm -f "$base.partial"; fail "the dump is unreadable (pg_restore --list failed)"; return 1; }

  file="$base"
  if [ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
    file="$base.enc"
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "$base.partial" -out "$file.partial" \
      || { rm -f "$base.partial" "$file.partial"; fail "encryption failed"; return 1; }
    rm -f "$base.partial"
    mv "$file.partial" "$file"
  else
    mv "$base.partial" "$file"
  fi
  size=$(wc -c < "$file")
  log "wrote $file ($size bytes)"

  if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
    dest="s3://$BACKUP_S3_BUCKET/${BACKUP_S3_PREFIX:-lms-backups}/$(basename "$file")"
    if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
      aws s3 cp "$file" "$dest" --only-show-errors --endpoint-url "$BACKUP_S3_ENDPOINT" || ok=0
    else
      aws s3 cp "$file" "$dest" --only-show-errors || ok=0
    fi
    # The local file stays, but without the off-server copy this is not a successful backup.
    [ "${ok:-1}" = 1 ] || { fail "upload to $dest failed"; return 1; }
    log "uploaded to $dest"
  fi

  # Retention applies to local files only (keep the bucket's with a lifecycle rule); the newest file is never pruned.
  find "$BACKUP_DIR" -maxdepth 1 -name "$PGDATABASE-*.dump*" -mtime +"$KEEP_DAYS" ! -newer "$file" ! -name "$(basename "$file")" -exec rm -f {} \;
  write_metrics 1 "$(date +%s)" "$size" "$(( $(date +%s) - start ))"
  log "backup finished"
}

# Seconds until the next HH:MM UTC (plain arithmetic: busybox date has no relative formats).
seconds_until() {
  h=${AT%%:*}; m=${AT##*:}
  now=$(date -u +%s)
  target=$(( now - now % 86400 + ${h#0} * 3600 + ${m#0} * 60 ))
  [ "$target" -le "$now" ] && target=$(( target + 86400 ))
  echo $(( target - now ))
}

case "${1:-loop}" in
  once) run_backup ;;
  loop)
    mkdir -p "$METRICS_DIR"
    [ -f "$METRICS" ] || write_metrics 1 0 0 0 # nothing yet; the start-up run below replaces it
    # Served as text/plain (busybox httpd takes the type from the .txt extension).
    httpd -f -p 9199 -h "$METRICS_DIR" &
    last="$(last_success)"; last="${last:-0}"
    if [ $(( $(date +%s) - last )) -gt 86400 ]; then run_backup || log "the start-up backup failed; the next attempt is at $AT UTC"; fi
    while true; do
      wait_s=$(seconds_until)
      log "next backup in ${wait_s}s (at $AT UTC)"
      sleep "$wait_s"
      run_backup || log "backup failed; the next attempt is tomorrow at $AT UTC (alert: BackupFailed)"
    done
    ;;
  *) echo "usage: backup.sh [once|loop]" >&2; exit 2 ;;
esac
