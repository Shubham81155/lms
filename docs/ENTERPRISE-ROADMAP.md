# Enterprise-readiness roadmap

Written 2026-11-11 against HEAD `3eb158a`. It complements `docs/ROADMAP.md` (what is built). This file is about what stands between
the product today and what an enterprise or university procurement team expects. Items marked **[you]** need your decision, money,
accounts or infrastructure; everything else is code or documentation that can be done in the repo.

## Where the product stands

Built and tested locally: multi-tenant isolation with row-level security, SSO (OIDC, SAML), SCIM, MFA, audit trail, DPDP/GDPR tooling,
SCORM and xAPI, quizzes with proctoring, billing, custom domains, backups, monitoring, WCAG 2.2 AA, Hindi UI. Typecheck, lint
(0 warnings), prettier and 1,500+ tests pass.

The gap to "enterprise" is mostly **proof and operations** (nothing has run on a live server with real services), then **scale and
resilience**, then **integrations and assurance**, and only then more features.

## Tier 0 - Prove what exists (weeks 1-4)

An enterprise buyer asks "is it running in production, for someone, today?". Until this tier is done, every other claim is unverified.

| #   | Work                                                                                                                                                                                          | Who            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 0.1 | Choose the product domain and deploy `docker-compose.prod.yml` with real DNS and wildcard TLS; add one verified custom domain                                                                 | **[you]**      |
| 0.2 | Razorpay test-mode run end to end: checkout, webhook, failed payment, grace period, suspension; set seller GSTIN, legal name, address, plan prices; decide trial vs paid                      | **[you]**      |
| 0.3 | Turn on the `backup` and `monitoring` profiles on the live server (S3 bucket, alert webhook/SMTP, `METRICS_TOKEN`); send a test alert; run the first restore drill from an off-site dump      | **[you]**      |
| 0.4 | Verify against real services: S3 driver, ClamAV daemon, SCORM packages from Articulate/Captivate/iSpring, Copyleaks sandbox, real webcams, a real SSO IdP (Entra ID, Okta, Google), real SMTP | **[you]** + me |
| 0.5 | Merge the CI image build and a staging environment so every merge to `main` deploys to staging automatically and runs the e2e suite (`apps/web/e2e`) against it                               | me             |
| 0.6 | Native Hindi review of consent, erasure, retention and breach wording                                                                                                                         | **[you]**      |

**Exit criteria:** a real tenant can sign up, pay, run a course with a quiz and a SCORM package, and be restored from backup, on your own domain.

## Tier 1 - Security and compliance assurance (weeks 3-10)

Enterprise security questionnaires (SIG, CAIQ, HECVAT) are the usual gate. Most answers are already "yes" in code; the evidence is missing.

| #   | Work                                                                                                                                                       | Who                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1.1 | Independent penetration test, then fix findings and publish a summary letter                                                                               | **[you]** (vendor)                          |
| 1.2 | SOC 2 Type I, then Type II (or ISO 27001): policies, access reviews, vendor list, change management, evidence collection (Vanta/Drata style tooling)       | **[you]** + me (policies, controls mapping) |
| 1.3 | Secrets management: move from env files to a secrets manager (cloud KMS, Vault) with rotation for JWT keys, webhook secrets and encryption keys            | me + **[you]** (cloud choice)               |
| 1.4 | Per-tenant encryption keys or customer-managed keys (BYOK) for the data enterprise customers ask about; field-level encryption already exists for webhooks | me                                          |
| 1.5 | Dependency and image supply chain in CI: `npm audit`/Dependabot, container image scan, SBOM, signed images, secret scanning                                | me                                          |
| 1.6 | Security headers and CSP audit, rate-limit and abuse tests, upload hardening review, SSRF review of every outbound fetch (webhooks, SSO, plagiarism)       | me                                          |
| 1.7 | WebAuthn / passkeys; enforce MFA per tenant; session and device management screen; IP allow-lists per tenant                                               | me                                          |
| 1.8 | Trust page: sub-processors, data locations, retention, DPA template, security whitepaper                                                                   | me (drafts) + **[you]** (legal review)      |
| 1.9 | Legal review of the DPDP flows (consent, minors, breach notice); privacy policy and terms                                                                  | **[you]**                                   |

## Tier 2 - Scale, resilience and operations (weeks 6-14)

| #   | Work                                                                                                                                                                                         | Who                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 2.1 | Load test (the `deploy/loadtest` folder is the start): 10k then 100k concurrent exam takers, with the quiz start/submit path, autosave and the gradebook as the hot spots; publish results   | me                            |
| 2.2 | Database scaling: PgBouncer, read replicas for analytics and exports, indexes from real query plans, partition the audit and xAPI tables by time                                             | me                            |
| 2.3 | Redis for sessions, rate limits and caching in production (the API already runs without it); queue for background jobs with retry and dead-letter handling (the new `worker.ts` is the base) | me                            |
| 2.4 | Infrastructure as code (Terraform) for one cloud, GitOps deploys, blue-green or rolling releases with automatic rollback and zero-downtime migrations                                        | me + **[you]** (cloud choice) |
| 2.5 | High availability and disaster recovery: multi-AZ database with automated failover, documented RPO/RTO, a cross-region backup copy, a rehearsed DR exercise                                  | me + **[you]** (budget)       |
| 2.6 | Observability: structured logs shipped to a store, tracing (OpenTelemetry), Grafana dashboards, SLOs and error budgets, on-call runbooks, status page                                        | me                            |
| 2.7 | Video: HLS/DASH transcoding pipeline and CDN for media; large-file upload with resumable chunks                                                                                              | me + **[you]** (CDN)          |
| 2.8 | Published SLA (uptime, support response), support process, incident communication template                                                                                                   | **[you]**                     |

## Tier 3 - Integrations enterprises expect (weeks 8-20)

| #   | Work                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 3.1 | SIS/HR sync: OneRoster 1.2 (rostering, grades) first, then Workday, SAP SuccessFactors, Banner, PowerSchool via adapters; scheduled sync with conflict reports     |
| 3.2 | LTI 1.3 Advantage depth: deep linking, grade services and names/roles services both as platform and as tool (the routes exist; certify against the IMS test suite) |
| 3.3 | Public API maturity: API keys with scopes and per-key rate limits, versioning and deprecation policy, webhooks with replay, OpenAPI published with SDKs            |
| 3.4 | Data warehouse export (scheduled to S3/BigQuery/Snowflake), BI-friendly schemas, xAPI LRS forwarding                                                               |
| 3.5 | Collaboration: Microsoft Teams, Zoom, Google Meet scheduling that works end to end; calendar sync (ICS exists)                                                     |
| 3.6 | Notifications: daily digests, SMS and push (the digest job exists), per-user channel preferences, deliverability monitoring (SPF/DKIM/DMARC)                       |
| 3.7 | Credentials: Open Badges 3.0 issuance, verifiable certificates, LinkedIn add-to-profile                                                                            |
| 3.8 | Content: Common Cartridge and CSV import, course versioning, content library with reuse across courses and tenants                                                 |
| 3.9 | Single-sign-on onboarding: self-service SSO setup wizard with test button, domain claiming and just-in-time provisioning reports                                   |

## Tier 4 - Product depth (ongoing)

- **Learning features:** peer review, competency-based progression, waitlists, learning paths and prerequisites, adaptive practice, discussion moderation tools, rubric libraries, proctoring review queue with human adjudication.
- **Live classes:** recording, breakout rooms, whiteboard, hand-raising, attendance reports.
- **Mobile:** installable PWA with offline lesson access first, then native apps if usage justifies them; push notifications.
- **Analytics:** at-risk learner alerts, cohort and program reporting, scheduled report delivery, admin dashboards with drill-down.
- **Administration at scale:** bulk user and enrolment operations with dry-run and undo, delegated admin roles, custom roles and permissions, tenant templates, sandbox/test tenants.
- **Localization:** more Indian languages (Tamil, Telugu, Bengali, Marathi), right-to-left support, API-sent text moved to translation keys, consistent date formats, screen-reader and keyboard pass by a person.
- **Quality of the code base:** keep the refactor going (split the remaining large files), add contract tests for the web client, visual regression tests, a performance budget in CI, and component documentation.

## Tier 5 - Go-to-market operations

| Work                                                                                                                 | Who            |
| -------------------------------------------------------------------------------------------------------------------- | -------------- |
| Pricing, plans and enterprise contract template (annual invoicing, purchase orders, GST invoices exist for card/UPI) | **[you]**      |
| Customer support tooling: help centre, in-app help, ticket system, status page, escalation path                      | **[you]** + me |
| Onboarding kit: migration guides from Moodle, Canvas and Blackboard, admin training material, sample content         | me             |
| Reference customers and a pilot programme with two or three institutions, with feedback fed back into Tier 4         | **[you]**      |

## Suggested order

1. **Tier 0** all of it. Nothing else matters if it is not running live.
2. In parallel, start **1.1/1.2** (pen test and SOC 2 take calendar time, not effort) and the code-only items **1.3-1.7, 2.1-2.3, 2.6**.
3. **Tier 2.4/2.5** once you pick a cloud.
4. **Tier 3** driven by what the first pilot customers ask for (usually SSO, OneRoster, LTI, then data export).
5. **Tier 4** is the backlog that pilots re-order.

## What I can start immediately without anything from you

Load test and the performance fixes it finds (2.1, 2.2), supply-chain checks in CI (1.5), the security and SSRF review (1.6), passkeys and
per-tenant MFA/IP rules (1.7), observability and runbooks (2.6), the OneRoster connector (3.1), API keys and scopes (3.3), the
trust-page and policy drafts (1.8, 1.2), CI image build and staging pipeline (0.5).
