# Operations: backups, restores, monitoring and alerts

Day-two runbook for the production stack (`docker-compose.prod.yml`). First deploy, DNS and certificates are in
[dns-and-tls.md](dns-and-tls.md). All commands run on the server in the repository directory; `dc` below stands for

```sh
alias dc='docker compose -f docker-compose.prod.yml'
```

## What runs

| Service                                               | Profile      | Purpose                                                                                                    |
| ----------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| `caddy`, `web`, `api`, `migrate`, `postgres`, `redis` | (always)     | the application, see dns-and-tls.md                                                                        |
| `clamav`                                              | `scan`       | virus scanning of uploads                                                                                  |
| `backup`                                              | `backup`     | nightly `pg_dump`, retention, optional encryption and S3 copy; serves backup freshness on an internal port |
| `prometheus`, `alertmanager`                          | `monitoring` | metrics, alert rules (`deploy/monitoring/alerts.yml`), notifications                                       |

Profiles are switched on in `.env` (`COMPOSE_PROFILES=backup,monitoring`, comma separated, add `scan` if used) or per
command (`dc --profile backup ...`). Everything else about them is in the "Backups" and "monitoring" sections of
`.env.production.example`.

Enable both on a live server:

```sh
# .env: COMPOSE_PROFILES=backup,monitoring   METRICS_TOKEN=<32+ random chars>   BACKUP_S3_*   ALERT_*
dc up -d            # recreates api (METRICS_TOKEN), starts backup, prometheus, alertmanager
dc ps               # backup and prometheus healthy
dc logs backup      # "wrote /backups/lms_preview-<stamp>.dump": the first backup runs at start-up
```

## Backups

- **What:** a custom-format dump (`pg_dump -Fc`) of the application database, every day at `BACKUP_AT` (02:30 UTC), plus
  one at start-up when the last is older than 24 hours. Each dump is checked with `pg_restore --list` before it counts.
- **Where:** the `backups` volume (`/backups` in the container), named `lms_preview-<UTC timestamp>.dump`
  (`.dump.enc` when `BACKUP_ENCRYPTION_PASSPHRASE` is set: AES-256-CBC with PBKDF2, readable with the `openssl` line
  under "Restore" below). Local files older than `BACKUP_KEEP_DAYS` (14) are removed; the newest is never removed.
- **Off the server:** set `BACKUP_S3_BUCKET` (and endpoint/keys for R2, Wasabi, MinIO...). A backup whose upload fails counts as
  failed (`BackupFailed`). Give the key write-only access to that bucket and keep the bucket's own retention/lifecycle
  rules: the script never deletes remote files. A backup that only exists on the server it protects is not a backup.
- **Not covered here:** uploaded files (volume `uploads` or your S3 bucket: enable bucket versioning), `caddy-data`, and your
  `.env` (`PII_ENCRYPTION_KEY`, `JWT_SECRET`, `BACKUP_ENCRYPTION_PASSPHRASE`): keep those in a password manager, **separately** from
  the dumps. See the table in dns-and-tls.md. For point-in-time recovery use a managed PostgreSQL or WAL archiving
  instead of, or on top of, these dumps: a nightly dump loses up to a day of data.
- **Run one now:** `dc --profile backup run --rm backup backup.sh once`
- **List them:** `dc --profile backup run --rm backup ls -lh /backups`
- **Copy one out:** `dc cp backup:/backups/<file> .` (the service must be running)

## Restore

Always restore into a _new_ database first (the default) unless the live one is truly gone.

1. **Pick the dump** (`ls` above, or download it from the bucket into the volume: `dc --profile backup run --rm backup aws s3 cp s3://<bucket>/<prefix>/<file> /backups/`).
2. **Into a new database, to inspect it** (nothing is overwritten):
   ```sh
   dc --profile backup run --rm backup restore.sh /backups/<file> [new_database_name]   # default <db>_restored
   dc exec postgres psql -U postgres -d lms_preview_restored -c 'SELECT count(*) FROM "User"'
   ```
3. **Replacing the live database** (disaster recovery, or undoing a bad change; everything since the dump is lost):
   ```sh
   dc stop caddy web api                       # nobody may write meanwhile
   dc --profile backup run --rm -e RESTORE_CONFIRM=lms_preview backup \
       restore.sh /backups/<file> lms_preview
   dc up -d                                    # migrate runs first and applies any newer migrations
   ```
   `restore.sh` refuses to touch the live database unless `RESTORE_CONFIRM` names it. It drops it, creates it
   anew and loads the dump with owners and grants (so `lms_app` keeps its privileges). The role `lms_app` must exist in the
   cluster: on a brand-new server start `postgres` once with an empty volume first (the init script creates it from
   `LMS_APP_DB_PASSWORD`), then restore.
4. **On a new server:** deploy the stack as in dns-and-tls.md (same `.env` secrets, notably `PII_ENCRYPTION_KEY`: without it
   encrypted personal data in the dump is unreadable), start `postgres` and run step 3 against `lms_preview`, then `dc up -d`.
5. **Encrypted dumps:** `restore.sh` and the drill decrypt automatically when `BACKUP_ENCRYPTION_PASSPHRASE` is in the
   environment. By hand: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in x.dump.enc -out x.dump`.
6. **Check:** sign in as an administrator, open a course and a file, look at Billing, and read `dc logs api`.

## Restore drill (monthly)

A backup you have never restored is a hope. On the first working day of each month:

```sh
dc --profile backup run --rm backup restore-drill.sh            # the newest dump, or pass a path
```

It restores the dump into a scratch database next to the live one, requires rows in every table of
`DRILL_REQUIRED_TABLES` (default `Tenant User`), compares the migration history with the live database, prints row counts,
drops the scratch database and exits 0 only if all held (`DRILL PASSED`). It never touches the live database; it needs
a few hundred megabytes of free disk for the scratch copy of a large database. A newer migration on the live side is reported as a note, not a failure.
Also run it after changing `BACKUP_ENCRYPTION_PASSPHRASE`, the S3 settings or PostgreSQL's major version, and once
from a dump _downloaded from the bucket_, to prove the off-server copy is whole. Write the date and result in your
ops log.

## Monitoring and alerts

Prometheus scrapes the API's `/metrics` (bearer `METRICS_TOKEN`; Caddy does not route `/metrics`, so it is not
reachable from outside) and the backup service every 30 seconds and keeps 30 days. The UI is on `127.0.0.1:9090`:
`ssh -L 9090:127.0.0.1:9090 <server>`, then http://localhost:9090/alerts. Alertmanager sends to `ALERT_WEBHOOK_URL` and/or e-mail
(`ALERT_SMTP_*`, `ALERT_EMAIL_*`); with neither set it warns at start-up and alerts stay visible only in Prometheus.
Test the route once: stop the api for 3 minutes (`dc stop api`, then `dc start api`) and check that `ApiDown` arrives.

| Alert                  | Severity | Means                                                                                      | First response                                                                                                                               |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `ApiDown`              | critical | `api:4000/metrics` unreachable for 2 min                                                   | `dc ps`, `dc logs --tail 100 api`; if the api is up, `METRICS_TOKEN` differs between api and prometheus (restart both after changing `.env`) |
| `DatabaseDown`         | critical | the API cannot query PostgreSQL                                                            | `dc logs postgres`; disk full? (`df -h`, `docker system df`); too many connections? Restart postgres only after reading the log              |
| `HighServerErrorRate`  | critical | over 5% of requests answered 5xx for 5 min                                                 | API log; the `route` label on `http_request_duration_seconds{status=~"5.."}` names the routes; recent deploy? roll back with `LMS_IMAGE_TAG` |
| `HighLatencyP95`       | warning  | p95 over 2 s for 10 min                                                                    | database load (`pg_stat_activity`), one slow route, memory pressure on the host                                                              |
| `BackgroundJobStale`   | warning  | a job (billing-overdue, trial-lifecycle, recheck-custom-domains) has not succeeded for 3 h | `dc logs api                                                                                                                                 | grep "background job failed"`. The threshold assumes the hourly defaults: if you raise a job's `*_INTERVAL_SECONDS`, raise it in `alerts.yml` |
| `OffboardingJobStale`  | warning  | the offboarding job (exports, deletions) silent for 30 min                                 | same; exports and organisation deletions are stuck meanwhile                                                                                 |
| `BackgroundJobFailing` | warning  | a job failed 3+ times in an hour                                                           | the API log has the error                                                                                                                    |
| `EmailQueueBacklog`    | warning  | over 500 e-mails waiting for 15 min                                                        | `SMTP_URL` reachable and accepting? provider limits? the queue drains once delivery works                                                    |
| `WebhookRetryBacklog`  | warning  | over 200 webhook deliveries waiting for 15 min                                             | customer endpoints failing; the organisation's integrations screen shows which                                                               |
| `ApiHighMemory`        | warning  | API above 1.5 GiB for 10 min                                                               | steady climb: leak, restart in a quiet hour and report it; sudden: a large export or upload                                                  |
| `ApiEventLoopLag`      | warning  | event loop blocked for over 1 s (p99)                                                      | CPU-bound work or a starved host; check `docker stats`                                                                                       |
| `BackupTargetDown`     | warning  | the backup service is not scraped                                                          | `dc --profile backup up -d backup`; without it there are no backups                                                                          |
| `BackupStale`          | critical | no successful backup for 26 h (or never)                                                   | `dc logs backup`; run `backup.sh once` by hand to see the error                                                                              |
| `BackupFailed`         | critical | the last run failed (dump, encryption or upload)                                           | `dc logs backup` has the error (wrong password, bucket permissions, full disk)                                                               |

`ApiDown` silences the API-related alerts below it while it fires. Rules live in `deploy/monitoring/alerts.yml`; after editing:
`dc --profile monitoring restart prometheus`. Validate before restarting:
`docker run --rm -v "$PWD/deploy/monitoring:/m:ro" --entrypoint promtool prom/prometheus:v2.55.1 check rules /m/alerts.yml`.
With several API replicas the job alerts use `max by (job)`, so a replica that never gets the lock does not raise them.
TLS certificate expiry is not monitored here: Caddy renews on its own; watch `dc logs caddy` after DNS changes.

## Upgrading with a backup

```sh
dc --profile backup run --rm backup backup.sh once      # 1. a fresh dump (must end with "backup finished")
git pull
export LMS_IMAGE_TAG=$(date +%F)                        # 2. keep the previous images for a rollback (set it in .env too)
dc build
dc up -d                                                # 3. migrate runs first; the api waits for it
dc ps && dc logs --tail 50 api
```

If it goes wrong: put the old `LMS_IMAGE_TAG` back and `dc up -d`. Migrations are not rolled back, and old code against
a migrated schema may not work: if the migration was the problem, restore the dump from step 1 (see "Restore", step 3)
and start the old images.

## Logs

Every service logs to the Docker json-file driver with rotation (20 MB x 5 files each): `dc logs --since 1h api`,
`dc logs -f caddy`. The API logs JSON lines (pino, `LOG_LEVEL`); request bodies are not logged unless `LOG_REQUEST_BODIES`
is set (it should not be: it can capture personal data). Logs rotate away in hours on a busy server: to keep them, ship them
(Docker's `fluentd`/`gelf`/`syslog` drivers, or Promtail/Vector reading `/var/lib/docker/containers`) rather than relying on the server's disk.

## Capacity notes

- **Disk:** the dump is much smaller than the database (compressed, no indexes), roughly 15-30% of `pgdata`; budget
  `BACKUP_KEEP_DAYS x dump size` locally, plus scratch space equal to the database for a drill. Prometheus uses a few hundred MB for 30
  days at this scrape load. Docker's own logs: 100 MB per service at most.
- **Backup window:** `pg_dump` takes a consistent snapshot without blocking writers, but reads every table: expect it to add load for
  minutes on a small database and longer on a large one. The default 02:30 UTC is night time in India; move it with `BACKUP_AT`.
- **Memory:** postgres 1-2 GB to start, the API 300-700 MB at rest (alert at 1.5 GiB), Prometheus + Alertmanager about 250 MB, the
  backup service is idle except during a run, ClamAV needs 2-3 GB when enabled.
- **ClamAV and large uploads:** `deploy/clamd.conf` sets `StreamMaxLength 128M`, `MaxFileSize 128M`, `MaxScanSize 256M` and `MaxThreads 4`, which cover the default 100 MB `UPLOAD_MAX_MB`. clamd's own default (25M) would reject big uploads with `INSTREAM size limit exceeded`; the API then refuses the upload with 503 (never treats it as clean) and logs that StreamMaxLength is too low. If you raise `UPLOAD_MAX_MB`, raise these limits with it (StreamMaxLength <= MaxFileSize <= MaxScanSize) and the memory for the `clamav` service.
- **When this stops being enough:** several hundred GB of data (dumps take hours: move to WAL archiving with
  pgBackRest/WAL-G or a managed PostgreSQL with point-in-time recovery), or more than one API replica (needs the shared
  Redis already present, and a scrape target per replica: switch `lms-api` in `prometheus.yml` from `static_configs` to `dns_sd_configs` with `names: [api]`, `type: A`, `port: 4000`).
