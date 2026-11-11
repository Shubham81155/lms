# Deploying a public demo on one address

This is the cheapest way to put the platform online for people to try: **one web address, one seeded organisation, no
domain name of your own**. It is meant for a portfolio or resume link, not for real customers (for those, use
`docker-compose.prod.yml`: see [dns-and-tls.md](dns-and-tls.md)).

> **Status.** The single-address mode was checked locally: with `TENANT_BASE_DOMAIN` set to the site's own host and
> `DEFAULT_TENANT_SLUG=harvard`, an unknown host resolves to the seeded organisation and sign-in works. The hosting steps
> below were **not** run on a real provider (no account was available when this was written), so expect to adjust
> names and menus. Treat the first deploy as a dry run.

## How a single address works

Normally every organisation has its own subdomain (`harvard.lms.example.com`). On one address there is only one host, so
the API falls back to a default organisation:

| Setting               | Demo value                                       | Why                                                                                           |
| --------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `TENANT_BASE_DOMAIN`  | the web app's host, e.g. `lms-demo.onrender.com` | The base host itself keeps the default organisation instead of looking for a subdomain.       |
| `DEFAULT_TENANT_SLUG` | `harvard`                                        | The organisation the seed creates (`packages/database/src/seed.ts`).                          |
| `TRUST_PROXY`         | `1`                                              | The web app forwards the original host to the API; the API only believes it behind one proxy. |

The browser talks only to the **web app**. It proxies `/api/v1/*` to the API, so the API can stay private (or public
and unused) and the session cookie is first-party.

## What you need

- A PostgreSQL 16 database (managed, or a container). It must allow two roles: an owner for migrations and the seed,
  and the unprivileged `lms_app` role the API runs as, so row-level security is actually enforced
  (`packages/database/sql/create_app_role.sql`).
- One service for the API and one for the web app, both from this repository (Node.js 22).
- Redis is optional: without `REDIS_URL` rate limits are per instance, which is fine for one instance.

## Environment

Generate the secrets once and keep them:

```bash
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('PII_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
```

**API service**

| Variable                           | Value                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `NODE_ENV`                         | `production`                                                           |
| `PORT`                             | the port the host gives you (the code reads `PORT`, default 4000)      |
| `DATABASE_URL`                     | connection string for the **`lms_app`** role                           |
| `JWT_SECRET`, `PII_ENCRYPTION_KEY` | the generated values                                                   |
| `TENANT_BASE_DOMAIN`               | the web app's host name, without `https://`                            |
| `DEFAULT_TENANT_SLUG`              | `harvard`                                                              |
| `APP_URL`, `CORS_ORIGINS`          | `https://<the web app's host>`                                         |
| `TRUST_PROXY`                      | `1`                                                                    |
| `ORG_REGISTRATION_ENABLED`         | `false` (nobody should create organisations on a public demo)          |
| `LOGIN_RATE_LIMIT_MAX`             | leave the default; raise it only if reviewers share one office address |

Build `npm ci && npm run build -w @enterprise-lms/security -w @enterprise-lms/database -w @enterprise-lms/api`, start
`npm run start -w @enterprise-lms/api`. Health check path: `/ready`.

**Web service**

| Variable  | Value                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------- |
| `API_URL` | the API's internal or public URL. It is **baked in at build time**, so set it before building. |

Build `npm ci && npm run build -w @enterprise-lms/web`, start `npm run start -w @enterprise-lms/web`.

Things that stay off in a demo, on purpose: no mail server (password-reset and invitation links are not delivered), no
ClamAV (uploads are stored unscanned and the API logs a warning), no Razorpay keys (paying for a plan is not possible), no SCORM content origin (SCORM upload and playback are off), no AI key.

## First deploy

Run these once against the database, as the owner role (set `DATABASE_URL` and `DIRECT_URL` to the owner's string for
these commands):

```bash
psql "$OWNER_URL" -f packages/database/sql/create_app_role.sql   # edit the password first
npm run db:deploy -w @enterprise-lms/database                    # applies every migration
SEED_PASSWORD='choose-a-demo-password' npm run db:seed -w @enterprise-lms/database
```

Then give the API service the `lms_app` connection string and start both services. Open the web address and sign in:

| Role          | Account                   |
| ------------- | ------------------------- |
| Student       | `alex.chen@harvard.edu`   |
| Teacher       | `david.malan@harvard.edu` |
| Administrator | `admin@harvard.edu`       |

The password is the `SEED_PASSWORD` you chose. **It will be public**: put it, with these three addresses, on the
README or the resume page, and use a password you use nowhere else.

## Keeping the demo presentable

A public demo gets edited by whoever visits. Plan for that:

- **Reset on a schedule.** Re-running `npm run db:seed` restores the seed accounts and course, but it does not delete
  what visitors added. For a clean slate, drop and recreate the database, then run the three first-deploy commands
  (a scheduled job or a small script does this).
- **Free tiers sleep.** A sleeping service takes about a minute to wake. Say so next to the link, or ping `/health`
  every ten minutes from an uptime checker.
- **Nothing real goes in.** The demo has no mail, no payments and no virus scanning; do not invite real people or upload
  real files.
- **Check it after each deploy:** sign in as each role, open a course, and run
  `curl -s https://<host>/api/v1/tenant/config` (it should name the organisation).

## Costs and where it fits

| Option                                         | Roughly                 | Notes                                                                     |
| ---------------------------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| Render or Railway (two services + Postgres)    | free to about $15/month | free tiers sleep; free databases may expire, so check the plan            |
| One small VPS running the services with Docker | about $5-10/month       | no sleeping; you manage the server and HTTPS yourself (for example Caddy) |

For a custom address later, point a domain at the host, set `TENANT_BASE_DOMAIN` and `APP_URL` to it, and you can keep
the same single-organisation setup.
