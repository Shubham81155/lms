# Nightly PostgreSQL backups, restore and restore drills (docker-compose.prod.yml, profile "backup").
# postgres:16-alpine brings pg_dump/pg_restore of the same major version as the server, and busybox-extras (its httpd serves
# the freshness metrics). openssl encrypts, aws-cli uploads to S3-compatible storage.
FROM postgres:16-alpine
RUN apk add --no-cache openssl aws-cli tzdata busybox-extras
COPY common.sh backup.sh restore.sh restore-drill.sh /usr/local/bin/
# Windows checkouts: scripts must have LF endings (.gitattributes keeps them so; this is belt and braces).
RUN sed -i 's/\r$//' /usr/local/bin/*.sh && chmod 0755 /usr/local/bin/*.sh
ENV PGHOST=postgres BACKUP_DIR=/backups
# The postgres image's entrypoint would start a server; this container only runs the scripts.
ENTRYPOINT []
CMD ["backup.sh", "loop"]
