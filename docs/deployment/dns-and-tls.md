# Production deployment: DNS, TLS and first start

The production stack is `docker-compose.prod.yml` at the repository root:

| Service | What it does | Reachable from |
|---|---|---|
| `caddy` | TLS termination and routing (`deploy/Caddyfile`, image `deploy/caddy/Dockerfile`) | the internet: 80, 443, 443/udp |
| `web` | Next.js pages (`deploy/Dockerfile.web`) | Caddy |
| `api` | Express API (`deploy/Dockerfile.api`), connects as `lms_app` so row-level security applies | Caddy, web |
| `migrate` | one-shot `prisma migrate deploy` as the database owner; `api` starts only after it exits 0 | - |
| `postgres` | PostgreSQL 16, volume `pgdata`; `deploy/init-db-prod.sh` creates `lms_app` on first start | internal network only |
| `redis` | shared rate-limit counters (no persistence) | internal network only |
| `clamav` | optional virus scanning (`COMPOSE_PROFILES=scan`) | internal network only (+ egress for signature updates) |

Configuration lives in one `.env` file next to the compose file, copied from `.env.production.example`.
Compose hands each container only the variables it needs: the database superuser password and the Cloudflare
token never reach the API or web containers.

`lms.example.com`, `lms-content.example.net` and `tenants.lms.example.com` below are placeholders for the product
domain, which is not decided yet. Nothing in the repository hardcodes them; they all come from `.env`.

## Addresses

| Name | Example | Serves |
|---|---|---|
| `TENANT_BASE_DOMAIN` | `lms.example.com` | the platform itself (registration, find my organisation, the default organisation) |
| `<slug>.TENANT_BASE_DOMAIN` | `harvard.lms.example.com` | one organisation each |
| `CUSTOM_DOMAIN_TARGET` | `tenants.lms.example.com` | nothing (redirects to the platform); customers CNAME their domains to it |
| `SCORM_CONTENT_HOST` | `lms-content.example.net` | SCORM packages only, on a separate registrable domain |
| customer domains | `learn.university.edu` | one organisation each, once verified |

On every host except the SCORM one, Caddy routes `/api/*` straight to the API (so the API is exactly one proxy hop
away: `TRUST_PROXY=1`), answers `/internal/*` with 404, and sends everything else to Next.js. Caddy replaces any
client-sent `X-Forwarded-For/-Host/-Proto` with its own values, and the API reads the organisation from
`X-Forwarded-Host` (`apps/api/src/server.ts`, tenant hint resolver). Session cookies are `__Host-` cookies in
production, which browsers accept only over HTTPS: every address above must be HTTPS, and Caddy redirects HTTP.

## DNS records

In the zone of the base domain (Cloudflare, since Caddy's wildcard certificate uses Cloudflare's API):

| Type | Name | Value | Proxy status |
|---|---|---|---|
| A | `lms.example.com` | server IPv4 | **DNS only** (grey cloud) |
| AAAA | `lms.example.com` | server IPv6 (if it has one) | DNS only |
| A / AAAA | `*.lms.example.com` | server IPv4 / IPv6 | DNS only |
| (covered by the wildcard) | `tenants.lms.example.com` | - | - |

`CUSTOM_DOMAIN_TARGET` is covered by the wildcard record if it sits under the base domain. If you choose a host
elsewhere, add an A/AAAA (or CNAME) record for it pointing at the server.

In the zone of the SCORM content domain (any DNS provider):

| Type | Name | Value |
|---|---|---|
| A / AAAA | `lms-content.example.net` | server IPv4 / IPv6 |

Keep the records **DNS only**. With Cloudflare's proxy (orange cloud) in front, Cloudflare terminates TLS, clients'
IP addresses become Cloudflare's (per-IP rate limits and the audit trail would see Cloudflare), and customers'
CNAMEs to `CUSTOM_DOMAIN_TARGET` would point at Cloudflare rather than at Caddy. Putting a CDN or load balancer in
front is possible but needs `trusted_proxies` in the Caddyfile and `TRUST_PROXY=2`.

Also add CAA records if your zone uses them: `0 issue "letsencrypt.org"` on the base and content domains.

## Cloudflare API token (wildcard certificate)

A wildcard certificate (`*.lms.example.com`) can only be issued with the DNS-01 challenge, so Caddy creates a TXT
record `_acme-challenge.lms.example.com` through Cloudflare's API.

Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token:

- Permissions: **Zone → Zone → Read** and **Zone → DNS → Edit**
- Zone resources: **Include → Specific zone →** the base domain's zone
- Optionally restrict client IP filtering to the server's address, and set an expiry you will track.

Put it in `.env` as `CLOUDFLARE_API_TOKEN`. Another DNS provider: build Caddy with that provider's module
(`DNS_MODULE` build argument in `deploy/caddy/Dockerfile`) and change the `dns` line in the Caddyfile.

## Certificates

| Hosts | Certificate | Challenge |
|---|---|---|
| `lms.example.com`, `*.lms.example.com` (all organisations, `www`, `CUSTOM_DOMAIN_TARGET`) | two certificates: the apex and the wildcard | DNS-01 via Cloudflare |
| `lms-content.example.net` | ordinary | HTTP-01 / TLS-ALPN-01 (ports 80/443 must be open) |
| verified customer domains | one each, **on demand** at the first visit | HTTP-01 / TLS-ALPN-01 |

New organisations need no certificate work: the wildcard covers them. Certificates and the ACME account are kept in
the `caddy-data` volume; Caddy renews them about 30 days before expiry.

## Customer custom domains

The organisation's administrator (or the platform operator) enters the domain in the admin screens; the full
flow is in `docs/custom-domains.md`. On the customer's side:

| Type | Name | Value | Purpose |
|---|---|---|---|
| TXT | `_lms-verify.learn.university.edu` | `lms-verify=<token>` (shown in the admin screen) | proves control; the domain goes live once found |
| CNAME | `learn.university.edu` | `tenants.lms.example.com` (`CUSTOM_DOMAIN_TARGET`) | sends visitors to this server |

- A CNAME cannot be placed on a zone apex (`university.edu` itself). Customers who want an apex need their DNS
  provider's ALIAS/ANAME/CNAME flattening, or A/AAAA records with the server's addresses (which then break if the
  server's IP changes). Recommend a subdomain such as `learn.`.
- The TXT record is re-checked every `CUSTOM_DOMAIN_RECHECK_INTERVAL_SECONDS` (default daily); when it stays missing
  for `CUSTOM_DOMAIN_RECHECK_GRACE_DAYS` (default 7) the domain is removed. Customers must keep it.
- **On-demand TLS:** the first HTTPS request to the domain makes Caddy ask the API
  `GET http://api:4000/internal/tls/allowed?secret=<TLS_ASK_SECRET>&domain=<host>` on the internal network. 200
  (a verified custom domain, or an existing organisation's subdomain) → Caddy gets a certificate, which takes a few
  seconds on that first request. Anything else (pending, unknown, archived) → no certificate, the TLS handshake
  fails. So nobody can make the server request certificates for arbitrary names. The endpoint answers 404 to
  everything when `TLS_ASK_SECRET` is unset, 403 with a wrong secret, and is never reachable from outside
  (`/internal/*` → 404 at the edge).
- The order matters only for the certificate: if the CNAME is in place before the TXT record is verified, early
  visitors get a TLS error until verification; afterwards the next visit gets a certificate.

### Let's Encrypt rate limits

- 50 certificates per registered domain per week: our base domain uses only the apex + wildcard certificates, so
  this is irrelevant; each customer domain is its own registered domain.
- 300 new orders per account per 3 hours, and 5 failed validations per host per hour. A burst of new custom
  domains, or customers whose CNAME is wrong, can hit these; Caddy backs off and retries.
- 5 identical certificates per week: do not delete the `caddy-data` volume casually. Restoring a server without it
  re-issues everything.
- For trial runs set `ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory` (untrusted certificates,
  much higher limits). Before switching to production, remove the line and delete the staging state:
  `docker compose -f docker-compose.prod.yml down` then `docker volume rm enterprise-lms_caddy-data`.

## First deploy

1. **Server.** A Linux host with Docker Engine and the compose plugin; ports 80/tcp, 443/tcp and 443/udp open;
   about 4 GB RAM (+3 GB with ClamAV). Clone the repository there (a Linux checkout, so `deploy/init-db-prod.sh`
   keeps LF line endings).
2. **DNS.** Create the records above and wait until `dig +short lms.example.com` and
   `dig +short anything.lms.example.com` return the server's address.
3. **Configuration.** `cp .env.production.example .env && chmod 600 .env`, then fill in every `[REQUIRED]` value
   (generate secrets on the server; database passwords hex only). Set `PLATFORM_OPERATOR_TENANT` (e.g. `operator`),
   `SMTP_URL`, and the Turnstile keys. Optionally `ACME_CA` = staging for the first run.
4. **Build and start.**
   ```sh
   docker compose -f docker-compose.prod.yml build
   docker compose -f docker-compose.prod.yml up -d
   docker compose -f docker-compose.prod.yml ps        # migrate "Exited (0)", others "healthy"
   docker compose -f docker-compose.prod.yml logs migrate api
   docker compose -f docker-compose.prod.yml logs -f caddy   # "certificate obtained successfully"
   ```
   The API exits at start-up if `lms_app` could bypass row-level security, or if the configuration is invalid
   (the log lists every problem).
5. **Operator organisation and first operator.**
   ```sh
   docker compose -f docker-compose.prod.yml exec -w /app api \
     npm run platform:bootstrap -w @enterprise-lms/api -- --email ops@example.com --first Ada --last Lovelace
   ```
   Without `--password` an invitation e-mail is sent (needs `SMTP_URL`); a `--password` given on the command
   line ends up in the shell history. Sign in at `https://<PLATFORM_OPERATOR_TENANT>.lms.example.com`.
6. **Checks.**
   - `curl -I https://lms.example.com` and `curl -I https://operator.lms.example.com`: 200/30x with HSTS.
   - `curl -i https://lms.example.com/internal/tls/allowed?domain=x`: 404 (not routed from outside).
   - The ask endpoint, from inside:
     `docker compose -f docker-compose.prod.yml exec caddy wget -qO- "http://api:4000/internal/tls/allowed?secret=$TLS_ASK_SECRET&domain=operator.lms.example.com"`
     → `{"allowed":true}`.
   - `curl -I http://lms.example.com` → 308 to HTTPS.
7. **Switch from staging** (if used): see the rate-limit section.

### Upgrades

```sh
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d    # migrate runs again first; the api waits for it
```

Set `LMS_IMAGE_TAG` per release to keep the previous images for a rollback (database migrations are not rolled
back automatically: take a backup before upgrading).

## Backups

What must be backed up, and how:

| What | Where | How |
|---|---|---|
| Database | volume `pgdata` | nightly logical dump, kept off the server: `docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U postgres -Fc enterprise_lms > lms-$(date +%F).dump`. Test a restore (`pg_restore`) regularly. For point-in-time recovery use a managed PostgreSQL or WAL archiving (e.g. pgBackRest/WAL-G) instead. |
| Uploaded files | volume `uploads` (`STORAGE_DRIVER=local`) or the S3 bucket | copy the volume (`docker run --rm -v enterprise-lms_uploads:/d -v $PWD:/b alpine tar czf /b/uploads.tgz -C /d .`) or enable bucket versioning/replication |
| `PII_ENCRYPTION_KEY`, `JWT_SECRET`, the rest of `.env` | the server | a password manager or secret store, **separately** from the database dumps: dumps are useless without the key, and dangerous next to it |
| Certificates | volume `caddy-data` | optional; restoring it avoids re-issuing (rate limits) |

Redis holds only rate-limit counters and needs no backup. The `lms_app` password lives in the database: after a
restore into a fresh volume the init script recreates the role from `LMS_APP_DB_PASSWORD`.

## Troubleshooting

- **Wildcard certificate not issued:** `logs caddy` shows the DNS provider's error. Check the token's scopes and
  zone, and that no stale `_acme-challenge` TXT record remains.
- **A custom domain gets a TLS error:** is it verified (admin screen)? Does it resolve to the server
  (`dig learn.university.edu`)? Caddy's log shows the ask result and any ACME failure.
- **Everyone lands on the default organisation:** `TRUST_PROXY` must be 1 (Caddy directly in front), and
  `TENANT_BASE_DOMAIN` must equal the host people use, without `https://`.
- **Login does not stick:** the site is being served over plain HTTP somewhere; `__Host-` cookies need HTTPS.
