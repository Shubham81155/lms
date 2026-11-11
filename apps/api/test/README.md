# API Test Suite Index (`apps/api/test`)

This directory contains **64 test suites** (plus shared harness utilities [`helpers.ts`](./helpers.ts) and [`setup-env.ts`](./setup-env.ts)) powered by Vitest and Supertest.

## How the Suites Run

- **Database isolation**: Integration suites start an ephemeral PostgreSQL instance via `packages/database/test-utils/embedded.ts`, apply all real Prisma migrations, and run queries as the unprivileged `lms_app` role so PostgreSQL Row-Level Security (RLS) policies are enforced for real.
- **Environment bootstrap**: [`setup-env.ts`](./setup-env.ts) supplies all secrets and configuration required by `apps/api/src/config.ts` (`JWT_SECRET`, `PII_ENCRYPTION_KEY`, rate limits, etc.).
- **Optional services**: Redis (`REDIS_TEST_URL`) and ClamAV are optional; [`redis-rate-limit.test.ts`](./redis-rate-limit.test.ts) runs against Redis when `REDIS_TEST_URL` is set and skips otherwise, while [`virus-scan.integration.test.ts`](./virus-scan.integration.test.ts) uses an in-process TCP `clamd` stub.
- **Commands**:
  ```bash
  npm test -w @enterprise-lms/api
  npx vitest run apps/api/test/<suite-file>.test.ts
  ```

---

## Legacy Phase Suites (`phase3` – `phase11`) Mapping

Historically named `phase*.integration.test.ts` files are preserved to keep existing CI and documentation references intact. Use this table to locate features inside the phase suites:

| Suite File                                                     | Domains & Features Covered                                                                                                                                                                                                                                                                                                             |
| :------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`phase3.integration.test.ts`](./phase3.integration.test.ts)   | Core LMS workflows: course visibility & content access, modules & lessons, enrolment rules, progress/completion/certificates, user administration, quizzes, assignments, validation/error logging, and quiz OpenAPI schema conformance                                                                                                 |
| [`phase4.integration.test.ts`](./phase4.integration.test.ts)   | Engagement, intelligence & enterprise scale: in-app notifications, discussion forums & paged replies, calendar events, quiz xAPI statements & LRS, proctoring telemetry, early-warning risk analytics, MFA (TOTP), feature flags/usage/tenant export, SCIM 2.0 provisioning, outbound webhooks, LTI 1.3 launches, and RLS verification |
| [`phase5.integration.test.ts`](./phase5.integration.test.ts)   | Grading & academic integrity: gradebook arithmetic, weighted categories/curves/two-person grade approval, question bank, learner Bloom mastery analytics, signed plagiarism provider callbacks, pending submissions feed, course instructor assignment, and gradebook RLS                                                              |
| [`phase6.integration.test.ts`](./phase6.integration.test.ts)   | OpenID Connect (OIDC) SSO: admin SSO configuration, PKCE-verified OIDC login flow against a mock IdP, JIT account creation, custom domains, and SSO disable/removal                                                                                                                                                                    |
| [`phase7.integration.test.ts`](./phase7.integration.test.ts)   | Rubrics & grade appeals: rubric arithmetic, criteria-based assignment grading, learner grade appeals, course-grade reopening on appeal resolution, and appeal RLS                                                                                                                                                                      |
| [`phase8.integration.test.ts`](./phase8.integration.test.ts)   | Notification email delivery & student to-do feed: email template rendering/escaping, queuing rules, retry & concurrency handling, quiet hours, post-queue mutations, and student to-do aggregation                                                                                                                                     |
| [`phase9.integration.test.ts`](./phase9.integration.test.ts)   | Governance & compliance: campuses and departments (org hierarchy), compliance reporting, role access checks, and append-only audit trail enforcement (`lms_app` immutability)                                                                                                                                                          |
| [`phase10.integration.test.ts`](./phase10.integration.test.ts) | SAML 2.0 SSO: admin SAML configuration, SP-initiated sign-in against a mock IdP signing real SAML assertions, invalid response rejection, custom domains, and tenant isolation                                                                                                                                                         |
| [`phase11.integration.test.ts`](./phase11.integration.test.ts) | Live classes: session scheduling, authorization, LiveKit join token minting, signed media-server webhooks, attendance tracking, and live-class RLS                                                                                                                                                                                     |

---

## Domain Index (All 64 Test Files)

### 1. Authentication, Sessions, Passwords & Tenant Scoping

- [`auth.test.ts`](./auth.test.ts) — Core authentication guards and bypass prevention.
- [`integration.test.ts`](./integration.test.ts) — End-to-end tenant-scoped sign-in and RLS smoke checks with no mocks.
- [`login-tenant-scope.integration.test.ts`](./login-tenant-scope.integration.test.ts) — Ensures `POST /api/v1/auth/login` never looks up or leaks accounts across tenants.
- [`cookie-name.test.ts`](./cookie-name.test.ts) — Production (`__Host-`) vs non-production session cookie naming and path rules.
- [`password-change.integration.test.ts`](./password-change.integration.test.ts) — Password changes revoking existing sessions, admin reset permissions, and SSO-only password rules.
- [`profile-password.test.ts`](./profile-password.test.ts) — Profile updates, file purposes (`FILE_PURPOSES`), and password validation helpers.
- [`find-organization.integration.test.ts`](./find-organization.integration.test.ts) — "Find my organisation" email lookup without enumerating account existence.
- [`invitations.integration.test.ts`](./invitations.integration.test.ts) — Bulk/individual user invitations, `INVITED` activation via emailed link, and seat-quota enforcement.

### 2. SSO (OIDC & SAML), Custom Domains & Tenant Addressing

- [`phase6.integration.test.ts`](./phase6.integration.test.ts) — OIDC configuration, PKCE sign-in, JIT provisioning, and custom domains.
- [`phase10.integration.test.ts`](./phase10.integration.test.ts) — SAML 2.0 SP-initiated login, XML signature validation, and tenant isolation.
- [`sso-origin.test.ts`](./sso-origin.test.ts) — Pure origin selection rules for SSO round trips.
- [`tenant-addressing.integration.test.ts`](./tenant-addressing.integration.test.ts) — Subdomain & host resolution under `TENANT_BASE_DOMAIN`, reserved/punycode slug blocking.
- [`custom-domain.integration.test.ts`](./custom-domain.integration.test.ts) — Custom domain DNS TXT verification and live domain switching.
- [`custom-domain-recheck.integration.test.ts`](./custom-domain-recheck.integration.test.ts) — Periodic TXT re-verification, grace periods, admin warnings, and domain removal.

### 3. Organisations, Onboarding, Billing & Support Access

- [`organizations.integration.test.ts`](./organizations.integration.test.ts) — Public organisation registration requests, email confirmation, operator approval, and suspension.
- [`captcha.integration.test.ts`](./captcha.integration.test.ts) — Cloudflare Turnstile verification on public registration requests.
- [`trial.integration.test.ts`](./trial.integration.test.ts) — Free trial lifecycle, reminders, read-only expiry (`402 TRIAL_ENDED`), and post-grace suspension.
- [`billing.integration.test.ts`](./billing.integration.test.ts) — GST calculation, invoice numbering, Razorpay webhooks, subscriptions, overdue jobs, and plan limits.
- [`tenant-suspension.integration.test.ts`](./tenant-suspension.integration.test.ts) — Immediate revocation of existing sessions/SCIM tokens on suspension and atomic seat-quota checks.
- [`support-access.integration.test.ts`](./support-access.integration.test.ts) — Consented time-limited operator support passes, one-time handoff links, and revocation.
- [`support-access-host.integration.test.ts`](./support-access-host.integration.test.ts) — Host enforcement for support handoff links under `TENANT_BASE_DOMAIN`.
- [`phase9.integration.test.ts`](./phase9.integration.test.ts) — Organisation hierarchy (campuses/departments), compliance report, and append-only audit log.

### 4. Courses, Modules, Enrolment, SCORM & Terms

- [`phase3.integration.test.ts`](./phase3.integration.test.ts) — Course visibility, modules/lessons, enrolment rules, completion, certificates, and user administration.
- [`continue-lesson.integration.test.ts`](./continue-lesson.integration.test.ts) — "Continue: next lesson" tracking in course module/lesson order.
- [`auto-completion.integration.test.ts`](./auto-completion.integration.test.ts) — Automatic course completion on 100% lesson progress and passing/approved gradebook state.
- [`enrollment-management.integration.test.ts`](./enrollment-management.integration.test.ts) — Staff enrolment by account/email, withdrawals, and learner course leave.
- [`course-review.integration.test.ts`](./course-review.integration.test.ts) — Optional administrator publishing review workflow for draft courses.
- [`terms-copy.integration.test.ts`](./terms-copy.integration.test.ts) — Academic terms management and course material copy with date shifting.
- [`scorm.integration.test.ts`](./scorm.integration.test.ts) — SCORM package zip unpacking safety, token-guarded player/content routes, and CMI data persistence.
- [`lesson-progress.test.ts`](./lesson-progress.test.ts) — Pure unit tests for `progressFromLessons` calculation.

### 5. Assessments, Grading, Rubrics, Plagiarism & Gradebook

- [`phase3.integration.test.ts`](./phase3.integration.test.ts) — Quizzes and assignments CRUD, attempts, and submission workflows.
- [`phase5.integration.test.ts`](./phase5.integration.test.ts) — Gradebook weighted categories, curves, two-person approval, question bank, Bloom mastery, and plagiarism callbacks.
- [`phase7.integration.test.ts`](./phase7.integration.test.ts) — Assignment rubrics and learner grade appeals.
- [`grading.test.ts`](./grading.test.ts) — Pure unit tests for auto-grading single/multi-choice and numeric/short answers.
- [`deadlines.integration.test.ts`](./deadlines.integration.test.ts) — Quiz availability windows, late assignment cutoffs, per-learner extensions, and attempt review policies.
- [`submission-history.integration.test.ts`](./submission-history.integration.test.ts) — Versioned assignment submission history, RLS access, and erasure redaction.
- [`gradebook-grid.integration.test.ts`](./gradebook-grid.integration.test.ts) — Gradebook grid scoring and formula-safe, audited CSV export.
- [`course-review.integration.test.ts`](./course-review.integration.test.ts) — Course publishing approval flow (also covers schema conformance).
- [`plagiarism-submit.integration.test.ts`](./plagiarism-submit.integration.test.ts) — Outbound similarity check dispatch and retries.
- [`copyleaks.integration.test.ts`](./copyleaks.integration.test.ts) — Copyleaks provider sweeper and signed status webhook handling.

### 6. Engagement, Notifications, Digests, Calendar & Live Classes

- [`phase4.integration.test.ts`](./phase4.integration.test.ts) — In-app notifications, discussion forums, and academic calendar events.
- [`phase8.integration.test.ts`](./phase8.integration.test.ts) — Notification email queuing, retries, quiet hours, and student to-do feed.
- [`phase11.integration.test.ts`](./phase11.integration.test.ts) — Live class scheduling, LiveKit join tokens, webhooks, and attendance.
- [`calendar-due-dates.integration.test.ts`](./calendar-due-dates.integration.test.ts) — Quiz/assignment due dates on the calendar, extensions, completion state, and iCalendar (`.ics`) feed.
- [`digest.integration.test.ts`](./digest.integration.test.ts) — Daily/weekly digest emails, timezone scheduling, signed unsubscribe links, and job locking.

### 7. Intelligence, AI Tutor, Proctoring & xAPI

- [`phase4.integration.test.ts`](./phase4.integration.test.ts) — Proctoring telemetry, early-warning risk scoring, and xAPI LRS statements.
- [`ai.integration.test.ts`](./ai.integration.test.ts) — AI study tutor and course builder integration across Claude, Gemini, and Grok provider stubs.

### 8. Privacy, DPDP, DSAR, Retention & Offboarding

- [`privacy.integration.test.ts`](./privacy.integration.test.ts) — GDPR/FERPA personal data export, directory opt-out, and account erasure.
- [`dpdp.integration.test.ts`](./dpdp.integration.test.ts) — DPDP Act consent purposes, append-only consent history, 72-hour breach register, grievance officer, and minor guardian consent.
- [`dsar-retention.integration.test.ts`](./dsar-retention.integration.test.ts) — Data-subject request queue/fulfillment/reminders and automated data retention policies.
- [`offboarding.integration.test.ts`](./offboarding.integration.test.ts) — Full organisation exports (excluding secrets) and scheduled tenant deletion.

### 9. Files, Storage, Security Guards & Platform Ops

- [`files.integration.test.ts`](./files.integration.test.ts) — File uploads, MIME/size limits, attachment access, and erasure cleanup.
- [`storage.test.ts`](./storage.test.ts) — Pure unit tests for storage helpers (`contentDisposition`, key validation).
- [`virus-scan.integration.test.ts`](./virus-scan.integration.test.ts) — `clamd` `INSTREAM` protocol client against a local TCP stub.
- [`ssrf-guard.test.ts`](./ssrf-guard.test.ts) — `assertSafeWebhookUrl` / `isBlockedIp` SSRF protections for webhooks, OIDC, and SAML URLs.
- [`hsts.test.ts`](./hsts.test.ts) — `hstsHeaderFor` host-scoped `Strict-Transport-Security` header rules.
- [`redis-rate-limit.test.ts`](./redis-rate-limit.test.ts) — Distributed Redis rate-limiter integration (runs when `REDIS_TEST_URL` is set).
- [`job-lock.integration.test.ts`](./job-lock.integration.test.ts) — PostgreSQL advisory lock (`withJobLock`) preventing duplicate background job execution.
- [`ops-metrics.integration.test.ts`](./ops-metrics.integration.test.ts) — `/metrics` Prometheus endpoint and `/ready` readiness probe under `lms_app`.

### 10. OpenAPI Contract Suites & Pure Utilities

- [`openapi.test.ts`](./openapi.test.ts) — OpenAPI spec integrity and completeness checks.
- [`contract-admin.test.ts`](./contract-admin.test.ts) — Schema contract tests for `openapi/responses/admin.ts`.
- [`contract-assessment.test.ts`](./contract-assessment.test.ts) — Schema contract tests for `openapi/responses/assessment.ts`.
- [`contract-identity.test.ts`](./contract-identity.test.ts) — Schema contract tests for `openapi/responses/identity.ts`.
- [`contract-learning.test.ts`](./contract-learning.test.ts) — Schema contract tests for `openapi/responses/learning.ts`.
- [`contract-platform.test.ts`](./contract-platform.test.ts) — Schema contract tests for `openapi/responses/support.ts` and `offboarding.ts`.
- [`config.test.ts`](./config.test.ts) — Environment configuration validation (`loadConfig`).
- [`csv.test.ts`](./csv.test.ts) — Formula-injection-safe CSV escaping (`csvCell`).
- [`json-stream.test.ts`](./json-stream.test.ts) — Streaming JSON object serialization (`JsonObjectStream`).
