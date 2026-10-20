#!/bin/sh
# Shared by backup.sh, restore.sh and restore-drill.sh (sourced).
: "${PGHOST:=postgres}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=enterprise_lms}"
: "${BACKUP_DIR:=/backups}"
export PGHOST PGUSER PGDATABASE
# PGPASSWORD comes from the environment (compose passes POSTGRES_PASSWORD) and is read by libpq itself.

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# Dumps are named <db>-<UTC timestamp>.dump, with .enc added when encrypted. The timestamp sorts like the time.
newest_dump() {
  ls -1 "$BACKUP_DIR"/"$PGDATABASE"-*.dump "$BACKUP_DIR"/"$PGDATABASE"-*.dump.enc 2>/dev/null | sort | tail -n 1
}

# decrypt_to <encrypted file> <plain file>
decrypt_to() {
  [ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ] || die "$1 is encrypted: set BACKUP_ENCRYPTION_PASSPHRASE"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "$1" -out "$2" \
    || die "could not decrypt $1 (wrong passphrase?)"
}

# plain_copy <dump or dump.enc> <tmp dir>: prints the path of a plain .dump (the file itself, or a decrypted copy).
plain_copy() {
  case "$1" in
    *.enc) decrypt_to "$1" "$2/restore.dump"; printf '%s' "$2/restore.dump" ;;
    *) printf '%s' "$1" ;;
  esac
}
