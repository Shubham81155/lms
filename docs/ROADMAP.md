# Roadmap (merged)

Merges the two planning documents: the 18-month enterprise plan (`enterprise_lms_roadmap.md`, six
phases) and the feature audit (`lms-feature-roadmap.md`, priorities P0-P4 and five delivery
phases). Where both describe the same thing it appears once. Status is what the code does today,
verified by the test suites (`npm test`), not what the UI mock-ups show.

Legend: **Done** = implemented and tested. **Partial** = backend done, web screen still sample data.
**Open** = not started.

## Phase 0 - Foundations

| Item | Status | Notes |
|---|---|---|
| Multi-tenant data isolation (PostgreSQL RLS, fail-closed) | Done | `multi_tenancy.md`; tested with an unprivileged role |
| Prisma migrations, seed, test database | Done | embedded PostgreSQL in tests |
| Secrets/config validation at start-up | Done | weak or placeholder secrets refuse to boot |
| OpenAPI description generated from the mounted routes, generated web types, typed GET client, route-authentication coverage test | Done | every route has a summary, auth/roles, request schema (from the handler's Zod schema) and a described response; response schemas are checked against real responses by contract tests (`test/contract-*.test.ts` and the per-area tests) |
| Server-side session revocation (token version, live status/role check), `/ready` probe, global API rate limits | Done | shared across instances when `REDIS_URL` is set (not exercised against a live Redis here), per process otherwise |
| ESLint, Docker/compose for local stack | Done | Dockerfiles/compose not yet exercised; API runs via ts-node. CI intentionally not set up |
| Infrastructure as code (Terraform), GitOps CI/CD | Open | |
| mTLS service mesh, Vault/KMS secret rotation | Open | |

## Phase 1 - Core platform, users, content

| Item | Status | Notes |
|---|---|---|
| Auth: cookie/JWT sessions, lockout, password reset, e-mail verification | Done | |
| RBAC + per-course access rules | Done | `api_authorization.md` |
| Tenant branding, feature flags by plan, seat quota, usage metering | Done | |
| SCIM 2.0 provisioning | Done | |
| MFA (TOTP + recovery codes) | Done | login page asks for the code |
| **OIDC single sign-on** (PKCE, per-tenant provider, custom-domain aware, no auto-provisioning) + login button | Done | works with SCIM-provisioned users |
| **SAML 2.0 single sign-on** (pinned signing certificate, per-tenant audience, request-bound responses, custom-domain aware) | Done | SP-initiated; no single logout or encrypted assertions |
| WebAuthn / passkeys | Open | |
| Course / module / lesson CRUD, catalogue, enrolment, certificates | Done | |
| Course cloning, versioning, CSV / Common Cartridge import | Open | |
| S3/CDN asset pipeline, virus scanning | Open | |

## Phase 2 - Delivery standards and the LRS

| Item | Status | Notes |
|---|---|---|
| xAPI statements stored and queryable | Done | automatic statements for quizzes and completions |
| LTI 1.3 launch (signature-verified, no auto-provisioning) | Done | |
| SCORM 1.2 / 2004 runtime adapters | Partial | library code; no package upload/player route |
| HLS/DASH video pipeline, DRM | Open | watermark overlay exists in the player |
| Offline / PWA access | Open | |

## Phase 3 - Assessment, grading, proctoring, engagement

| Item | Status | Notes |
|---|---|---|
| Quiz engine: timing, attempts, auto-grading, manual grading | Done | |
| **Question bank** (reusable, tagged, Bloom level, copy-into-quiz) | Done | screen included |
| **Gradebook**: weighted categories, curve, draft -> submit -> two-person approval | Done | teacher screen included; approved grade becomes `Enrollment.finalGrade` |
| Bloom's-taxonomy mastery analytics | Done | from tagged questions |
| Proctoring telemetry and flagging | Done | the quiz screen reports tab switches, leaving full screen and copy/paste; no webcam capture |
| **Plagiarism provider callbacks** (HMAC-signed, replay-limited) | Done | new; outbound submission to Turnitin/Copyleaks is not built |
| **Rubrics** (per-criterion scoring, learner-visible breakdown) | Done | teacher editor and grading screen included |
| **Grade appeals** (14-day window, instructor decision, reopens an approved course grade) | Done | assignments only; learner and teacher screens included |
| Peer review | Open | |
| Notifications (bell + unread badge), forums (+moderation, faculty-verified answers), calendar + real iCal download, XP / streaks / cohort leaderboard / Bloom profile | Done | backend and web screens on live data; moderation actions (hide, lock, pin) have API only |
| **E-mail delivery of notifications** (SMTP, quiet hours in the user's time zone, retries, de-duplicated) + settings panel | Done | SMS and push remain open |
| Live-class attendance | Done | from the media server's webhooks |
| Waitlists, competency-based progression | Open | |

## Phase 4 - Live, mobile, AI, intelligence

| Item | Status | Notes |
|---|---|---|
| Early-warning (at-risk) analytics, nudges | Done | |
| Webhooks (signed, logged, retried with backoff: 30 s, 2 min, 10 min, 1 h; 4xx not retried) | Done | retries are driven by a database-backed sweeper, safe on several instances |
| **Live classes** (LiveKit: scheduling, calendar, notifications, signed join tokens, role-limited publishing, webhook-driven attendance) + room, teacher panel and student banner | Done | needs a LiveKit server; room UI not exercised against one |
| Breakout rooms, whiteboard, recording, hand-raising | Open | |
| Native mobile apps | Open | |
| AI tutor, quiz generation, essay grading hints | Partial | templated responses, no model behind them |

## Phase 5 - Enterprise integrations, hardening, launch

| Item | Status | Notes |
|---|---|---|
| Tenant data export (portability) | Done | |
| **Campus / department hierarchy**, white-label branding, compliance posture report (measured facts, declarations) | Done | admin screens included |
| **Append-only audit trail** (database role cannot update or delete audit rows) | Done | enforced and tested at the database |
| OneRoster / SIS-ERP connectors (Banner, PowerSchool, Workday, SAP, Salesforce) | Open | adapter library only |
| Open Badges 3.0 issuance, PDF certificates | Partial | credential engine exists; certificate PDF not rendered |
| GDPR erasure / DSAR, FERPA directory controls | Partial | library code; no self-serve endpoints |
| Penetration test, SOC 2 / FERPA audit | Open | process, not code |
| Load test (100k exam takers), multi-region HA / DR | Open | targets in `load_testing_sla.md` |
| Redis cache, read replicas, PgBouncer | Open | |

## Suggested next steps (highest value first)

1. Webcam/audio proctoring; outbound plagiarism submission.
2. Daily digest e-mails and SMS/push channels.
