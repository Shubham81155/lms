# API Authorization and Behaviour Rules

What each role may do, as enforced and tested in `apps/api`. Row-level security
(`multi_tenancy.md`) is a second, independent layer underneath all of this.

## Roles at a glance

| Role | Courses | Content (lessons, quizzes, assignments) | Can change |
|---|---|---|---|
| `STUDENT` | published courses | only courses they are **enrolled** in | own progress (not to 100%), own submissions |
| `PARENT_GUARDIAN` | published courses | enrolled courses (none by default) | nothing |
| `TEACHING_ASSISTANT` | published + courses they are assigned to | assigned courses | grade submissions in assigned courses |
| `INSTRUCTOR` | published + their own drafts | assigned courses | content and enrolments of **assigned** courses, grades, completion |
| `AUDITOR` | everything in the tenant | everything, read-only | nothing; reads audit logs |
| `TENANT_ADMIN` | everything in the tenant | everything | everything in the tenant; not the `SUPER_ADMIN` role |
| `SUPER_ADMIN` | everything in the tenant | everything | everything in the tenant, including `SUPER_ADMIN` grants |

"Assigned" means a `CourseInstructor` row. An instructor who is not assigned to a course has the
same access to it as a student who is not enrolled. Drafts are invisible (404, not 403) to anyone
who is not assigned, an admin or an auditor.

## Enrolment

* `GET /enrollments/todo` is the caller's own upcoming work from courses they are actively enrolled in
  (published courses only): assignments not yet submitted or still ungraded, and quizzes with attempts
  left or an attempt in progress. Dated assignments come first, soonest due first.
* **Yourself:** students only, in a *published* course with `allowSelfEnroll`. Admins may always.
* **Someone else:** administrators and the course's assigned instructor. Not TAs, not other instructors.
* Only `ACTIVE` users can be enrolled; a dropped enrolment can be re-opened.
* Rosters (`GET /enrollments?courseId=` / `?userId=`): learners get 403; instructors see only
  courses they teach; admins and auditors see all. `GET /enrollments/my` is always your own.

## Progress and completion (`PATCH /enrollments/:id/progress`)

* A learner may move their own progress **forward**, up to 99%. They cannot set a grade or a
  status (a client-supplied `status` is ignored).
* Staff (admin or assigned instructor/TA) may set progress and `finalGrade` for **other** people.
  Nobody grades themselves.
* Reaching 100% completes the enrolment, or fails it when `finalGrade` is below the course's
  `passingGradePercent`. Completion issues the certificate (idempotent, one per enrolment).
* `GET /certificates/verify/:number?tenant=<slug>` is public and returns only the holder's name,
  course and dates. PDF rendering is not implemented (`pdfUrl` is null).

## Quizzes

* Build/edit/delete: course editors (admin, assigned instructor). Questions are validated so they
  can be graded (e.g. a multiple-choice question needs exactly one correct option). A quiz or
  question with submissions cannot be deleted.
* Taking: enrolled learners only, in a published course. Staff and auditors cannot take quizzes.
* Learners never receive `isCorrect`, `correctAnswer` or `explanation`.
* **Attempts:** `(quizId, userId, attemptNumber)` is unique, so concurrent submits cannot exceed
  `maxAttempts`. Timed quizzes (`timeLimitMins`) require `POST /quizzes/:id/start`; submitting after
  the limit (plus 30 s grace) closes the attempt with a score of 0 and it still counts as used.
* **Grading:** single/multi choice, true/false, short answer (alternatives with `||`) and numeric
  formula questions are graded automatically. Multi-select is all-or-nothing. **Essay and code
  questions are left pending**; staff award points with
  `PATCH /quizzes/:id/submissions/:subId/grade`. A submission has no pass/fail verdict until
  nothing is pending (`pendingManualGrading`).
* The web client's paths `POST /quizzes/:id/submissions` and `POST /assignments/:id/submissions`
  are accepted as aliases of `/submit`, and answers may be a map or a `[{questionId, answer}]` list.

## Assignments

* One submission per learner, replaceable until graded, then frozen (409).
* Grading and listing submissions: staff of that course only, not any instructor in the tenant.
* `isLate` is reported but not enforced; there is no late policy yet.

## Users

* Only a `SUPER_ADMIN` may grant `SUPER_ADMIN` or change a `SUPER_ADMIN`'s role/status.
* Nobody can change their own role or status.
* Avatar and lesson/media links must be `http(s)`.

## Errors, validation and logging

* Query parameters are validated (`400` for malformed pagination, enums, dates).
* Every response carries `x-request-id`; every error body has `requestId`:
  `{ "error": "...", "details"?: ..., "requestId": "..." }`.
* Unexpected errors return a generic 500 and are logged with the request id. Stack traces and
  database messages are never sent to clients (a `detail` field appears only with `NODE_ENV=development`).
* Logs are structured JSON (pino). Request bodies are not logged unless `LOG_REQUEST_BODIES=true`.
* The audit trail (`AuditLog`) stores whitelisted fields, never whole records. `AuditSanitizer`
  masks secrets in nested objects and arrays and keeps dates.

## Engagement (notifications, forums, calendar)

* **Notifications** are private to their owner (another user gets 404). Users choose channels,
  muted categories, quiet hours and a time zone; a muted category or a disabled in-app channel
  suppresses creation. Events that notify: grading (quiz/assignment), course completion, forum
  replies, reports, proctoring flags, instructor nudges.
* **E-mail delivery**: a notification in the categories GRADE, EXAM, COURSE, SYSTEM and LIVE is also
  queued for e-mail unless the user turned e-mail off (forum replies stay in-app). A background sender
  (every `EMAIL_DISPATCH_INTERVAL_SECONDS`, default 60; 0 turns it off) works through each active
  tenant's queue. Quiet hours are applied in the recipient's own time zone when the queue is processed,
  so a night-time grade is held and sent in the morning. A queued mail is dropped if the recipient was
  deactivated or opted out in the meantime, or if it has waited more than 48 hours. Each attempt is
  claimed with a conditional update, so overlapping runs or several API instances never send the same
  mail twice; a failure is retried on the next run, up to 5 attempts, then marked FAILED. E-mails carry
  an escaped HTML part, and only same-app paths and https links become clickable. An e-mail needs the
  in-app record, so a user who switches off in-app notifications is not e-mailed either. Mail goes
  through SMTP when `SMTP_URL` is set (sender `MAIL_FROM`); without it, mail is printed in development
  and dropped in production. SMS and push are not built (their preference fields are stored only).
* **Forums** are per course and visible to whoever can see the course content (enrolled learners,
  assigned staff, admins, auditors). Auditors are read-only. Learners see classmates as "First L.".
  Course staff pin, lock, hide and endorse; locked threads accept replies from staff only; hidden
  threads and replies are invisible to learners (404). Any participant can report; one report per
  user per item. Moderation actions are audited.
* **Calendar**: course events are created by the course's editors (admin / assigned instructor);
  tenant-wide events by admins. Learners see events of courses they are enrolled in plus tenant-wide
  ones. `GET /calendar/export.ics` returns the same set as RFC 5545 (UTC instants).
* **Mastery**: `GET /analytics/mastery` returns the caller's own Bloom's-taxonomy profile, computed
  from their graded answers to tagged quiz questions.

## Intelligence (xAPI LRS, proctoring, early warning)

* `POST /xapi/statements` stores statements in PostgreSQL (one, or an array of up to 50). Learners
  may only record statements whose `actor.mbox` is their own address; staff and admins may record
  for others. Re-sending an id is idempotent; reusing an id for different content is 409. Quiz
  attempts and course completions emit statements automatically.
* `GET /analytics/xapi/stream`: staff, admins and auditors browse the tenant; everyone else sees only
  their own statements.
* `POST /proctoring/events`: only the test taker, only for their own still-open attempt of a quiz
  with `requireProctoring`. Three HIGH events (or a weighted score of 12) flag the attempt and notify
  the course staff once. `GET /quizzes/:id/proctoring` is for course staff.
* `GET /analytics/proctoring` (recent integrity events and open proctored attempts) and
  `GET /analytics/pending-grading` (ungraded assignment submissions, oldest first, with plagiarism
  score) feed the teacher dashboard. Both are for course staff: instructors and TAs see their own
  courses, administrators the whole tenant, learners get 403.
* `GET /analytics/at-risk?courseId=` (course staff) and `GET /analytics/cohort` are computed from live
  data: inactivity, quiz performance, failed attempts, proctoring flags, plagiarism score.
  Instructors see only their courses. Bloom's-taxonomy mastery is empty until questions are tagged.
* `POST /lti/launch` verifies the RS256 `id_token` against the registered deployment's JWKS (issuer,
  audience, deployment id, nonce, expiry). It signs in an *existing* active user matched by email and
  never creates accounts. Requires the `lti13` feature.

## Scale and enterprise

* **MFA (TOTP, RFC 6238)**: `/auth/mfa/setup` then `/enable` (proves the authenticator works) returns
  8 single-use recovery codes once. With MFA on, login needs `mfaCode` (a code or a recovery code); a
  wrong code counts toward lockout. Secrets are AES-256-GCM encrypted; recovery codes are stored hashed.
* **Feature flags**: plan defaults (STARTER / PROFESSIONAL / ENTERPRISE) plus per-tenant overrides
  (`PUT /admin/features`). `webhooks`, `scim` and `lti13` are enforced; `GET /tenant/config` reports them.
* **Usage metering**: `GET /admin/usage` (seats by role and status, active users, volume);
  `PUT /admin/usage/quota` sets a seat quota (cannot go below seats in use); SCIM provisioning
  enforces it.
* **Data export**: `GET /admin/export` returns the tenant's records as JSON with no credentials; audited.
* **Webhooks** (`/admin/webhooks`): events `enrollment.completed`, `certificate.issued`,
  `quiz.submitted`, `user.provisioned`. Each POST carries `x-lms-timestamp` and
  `x-lms-signature: sha256=HMAC_SHA256(secret, timestamp + "." + body)`. The secret is shown once.
  Outside tests, URLs must be https and private or loopback hosts are rejected. Delivery is best
  effort with a 5 s timeout and is logged in `WebhookDelivery`; there are no retries yet.
* **SCIM 2.0** (`/api/v1/scim/v2`, per-tenant bearer token minted at `/admin/scim-tokens`, stored
  hashed, revocable): Users list/filter (`userName eq`), create, get, PUT, PATCH (`active`, name,
  `externalId`; Okta and Entra shapes), DELETE (suspends; history is kept). SCIM-created users are
  learners; administrator and auditor accounts cannot be changed through SCIM.

## Gradebook, question bank and plagiarism callbacks

* **Gradebook** (`/courses/:id/gradebook/*`): editors (admin, assigned instructor) define weighted
  categories (weights must total 100), assign quizzes and assignments to them, and optionally set a
  curve (`ADD_POINTS`, or `SCALE_TO_MAX`, which lifts the best score to 100 and never lowers anyone).
  `calculate` produces DRAFT grades: a learner's quiz score is their best fully-graded attempt, an
  assignment is grade / max points, and nothing submitted counts as 0. Work still waiting for a grader
  is left out and marks the grade `incomplete`. Categories with no scored work are skipped and the
  remaining weights renormalised. Uncategorised items do not count.
* **Approval is two-person.** An editor submits (`DRAFT -> SUBMITTED`; incomplete grades need
  `allowIncomplete`). Only an administrator **who did not submit** may approve, which writes
  `Enrollment.finalGrade` and notifies each learner. Rejecting returns the grades to DRAFT with a
  required note. `calculate` never overwrites APPROVED grades; an administrator must `reopen` first.
  TAs can view the gradebook but not change it. Learners see only their own grade, and only once
  approved. Every transition is audited.
* **Question bank** (`/question-bank`): instructors and administrators only (not TAs or learners).
  Items use the same validation as quiz questions, carry tags and a Bloom level, and are visible to
  their author, to administrators, and to the staff of the course they are attached to. Only the
  author or an administrator can change or delete one. `POST /quizzes/:id/questions/from-bank` copies
  items into a quiz as independent questions (new option ids; later bank edits do not touch the quiz).
* **Bloom analytics**: questions tagged with a `bloomLevel` feed `bloomsMastery` in
  `GET /analytics/cohort`; levels with no graded answers are omitted.
* **Plagiarism callbacks** (`POST /integrations/plagiarism/:tenantSlug`): off unless
  `PLAGIARISM_WEBHOOK_SECRET` is set. The provider sends `x-lms-timestamp` and
  `x-lms-signature: sha256=HMAC_SHA256(secret, timestamp + "." + rawBody)`; requests more than five
  minutes old are rejected. A valid result stores the score and an https report link; 30% or more
  alerts the course staff and feeds the at-risk radar. A submission that does not belong to the named
  tenant is a 404. Submitting work *to* a provider is not built.

## Single sign-on (OpenID Connect)

* One OIDC provider per tenant, configured by an administrator at `PUT /admin/sso` (issuer, client id,
  client secret, enabled, optional allowed e-mail domains). Needs the `sso` feature (on for the
  ENTERPRISE plan). Enabling reads the provider's discovery document first, so a wrong issuer is
  reported immediately. The client secret is stored AES-256-GCM encrypted and is never returned.
  Register the redirect URIs listed on the admin screen at the provider: `APP_URL + /api/v1/auth/sso/callback`
  and, when the tenant has a custom domain, `https://<custom domain>/api/v1/auth/sso/callback`.
* Flow: `GET /auth/sso/start` redirects to the provider with PKCE (S256), `state` and `nonce`. The
  in-flight values live in a signed, httpOnly, 10-minute cookie scoped to `/api/v1/auth/sso`, so
  there is no server-side session. `GET /auth/sso/callback` checks `state`, exchanges the code
  server-side (the secret never reaches the browser), and validates the ID token: RS256 signature
  against the provider's JWKS, issuer, audience, expiry and nonce. `alg: none` and HMAC tokens are
  refused. The flow cookie is cleared on every callback, so a callback cannot be replayed.
* **Accounts are never created by SSO.** The user is found by the provider's `sub`; the first time,
  by e-mail, and only when the provider reports `email_verified: true`. An account already bound to a
  different OIDC identity is never rebound; a SCIM-provisioned account (which holds only the
  directory's external id) is bound on first login. Suspended or locked accounts are refused.
  `allowedDomains`, when set, restricts which e-mail domains may sign in.
* Every failure sends the browser to `/login?error=sso_failed` with no detail; the reason is written
  to the audit log (`SSO_LOGIN_FAILED`). Successful logins are audited with `method: OIDC`.
  `GET /auth/sso/status` tells the login page whether to show the button.
* **Custom domains.** A tenant can sign in from the platform address or from its own domain. The flow
  returns to the host it started on: the origin is chosen when the flow starts and stored in the signed
  flow cookie, the same redirect URI is sent in the code exchange, and the browser is sent back (on
  success or failure) to that origin. The request's Host only *selects* among the origins the tenant is
  entitled to (exact, case-insensitive match on host and port); a forged Host, another tenant's domain,
  a different port or a trailing dot all fall back to `APP_URL`, so nothing can steer a sign-in or its
  redirect to an arbitrary site. Behind a reverse proxy (including the Next.js rewrite) set
  `TRUST_PROXY` so the original host is read from `X-Forwarded-Host`. Custom domains are always https
  in production.
* Users with MFA enabled enter their code on the login page (a second field appears after the
  password is accepted). SSO sign-in relies on the provider's own MFA and does not ask again.

## Assignment rubrics and grade appeals

* **Rubrics** (`PUT /assignments/:id/rubric`, course editors only): a list of criteria with maximum
  points; the assignment is worth their total. Setting or removing a rubric is refused with 409 once
  any submission has been graded, because it would change what existing grades mean.
* **Grading** (`PATCH /assignments/:id/submissions/:subId/grade`): send `grade` for a plain assignment
  or `criteria` (points per criterion) for a rubric one; the wrong shape is a 400. Every criterion must
  be scored within its range, unknown criteria are refused, and the grade is the sum. The learner sees
  the per-criterion breakdown. Regrading an already graded submission sends that learner's APPROVED
  course grade back to DRAFT (`courseGradeReopened: true`) so an approved figure cannot go stale.
* **Appeals**: the owner of a graded submission may file one appeal within 14 days of the grade
  (`POST /assignments/:id/submissions/:subId/appeal`, reason of at least 10 characters). Course staff
  are notified. `POST /appeals/:id/resolve` is for course editors (instructor or administrator, not
  TAs): UPHELD must carry the corrected grade or criterion scores, DENIED must not. The correction is
  validated before the appeal is closed and closing is a conditional update, so an invalid correction
  leaves the appeal open and two reviewers cannot both decide it. Learners see their own appeals;
  staff see the whole course.

## Organisation, compliance and the audit trail

* **Hierarchy** (`/admin/campuses`, `/admin/departments`, administrators only): campuses with departments,
  each with an upper-case code (2-20 of A-Z, 0-9, dash) unique per tenant (campuses) or per campus
  (departments). A campus that still has departments, or a department that still has courses, cannot be
  deleted (409), so nothing is orphaned by surprise. Every change is audited.
* **Compliance report** (`GET /admin/compliance`) lists *measured* facts, each PASS / WARN / FAIL / INFO:
  that the API's database role cannot bypass row-level security, that it cannot modify the audit trail,
  recent audit activity, the encryption key, the share of administrators with MFA, SSO and SCIM status,
  and unverified e-mail addresses. FERPA, COPPA and SOC 2 compliance are organisational, so the screen
  only records what the administrator *declares* (`ferpaCompliant`, `coppaCompliant`); the declarations
  do not change platform behaviour.
* **The audit trail is append-only for the application.** Migration `20261018000000_audit_append_only`
  revokes UPDATE, DELETE and TRUNCATE on "AuditLog" from `lms_app`; tests prove the role is refused while
  inserts, reads and the foreign key's SET NULL (when a user is removed) still work. A later migration
  must not re-grant those rights: grant to new tables by name rather than `ON ALL TABLES`. This protects
  against a compromised API process, not against someone with the database owner role.

## Single sign-on (SAML 2.0)

* One SAML identity provider per tenant, set up by an administrator at `PUT /admin/saml` (sign-in URL,
  IdP entity id, signing certificate, e-mail attribute, allowed domains, enabled). It uses the same
  `sso` feature as OIDC. `GET /admin/saml` lists what to give the IdP: one entity id, ACS URL and
  metadata URL per origin the tenant can sign in from (the platform address and, if it has one, its
  custom domain). `GET /auth/saml/metadata/:slug` serves public SP metadata for tenants that have SAML.
* **Flow:** SP-initiated only. `GET /auth/saml/start` sends an `AuthnRequest` (HTTP-Redirect) with an
  unpredictable id and sets a signed, httpOnly, 10-minute flow cookie holding the tenant, the request id
  and the origin. The IdP posts back to `POST /auth/saml/acs` (HTTP-POST). In production the flow cookie
  is `SameSite=None; Secure`, because browsers do not send Lax cookies on a cross-site POST.
* **What is verified** (signature handling by `@node-saml/node-saml`, the rest by the application): the
  assertion must be signed by the certificate pinned for this tenant (unsigned, wrongly signed and
  tampered assertions are refused, and a forged unsigned assertion placed beside the signed one does not
  win); the Response status must be Success; the time conditions (60 s clock skew, 10 minute maximum age);
  the audience must be this tenant's own entity id, so an assertion issued for another tenant or another
  service provider is refused; the issuer must be the configured IdP; and `InResponseTo` must equal the
  request id in the flow cookie, which refuses unsolicited (IdP-initiated), swapped and replayed
  responses without a shared server-side cache (that would break with several API servers). The cookie is
  cleared on every ACS call, so an identical POST cannot be replayed.
* **Accounts are never created.** The person is found by the persistent NameID (stored as
  `saml:<issuer>|<NameID>`), otherwise by the configured e-mail attribute. The IdP is trusted for the
  e-mail, because the administrator chose it. With the default attribute (`email`) the alias `mail` and an
  e-mail-format NameID are also accepted; once a specific attribute is named, only that attribute is
  used. A transient NameID is never stored: the account is found by e-mail on each sign-in. Matching
  rules are shared with OIDC: suspended or locked accounts, domains outside the allow-list, and accounts
  already bound to a different SAML identity are refused; SCIM-provisioned accounts, and accounts that
  were bound through OIDC (the tenant changed provider), are bound on their first SAML sign-in.
* Failures redirect to `/login?error=sso_failed` with no detail; the reason is audited
  (`SAML_LOGIN_FAILED`). Successful sign-ins are audited with `method: SAML`.
* The IdP's certificate is pinned: only the certificate (or public key) is stored, never a private key
  (one is refused). The admin screen shows its SHA-256 fingerprint and warns 30 days before it expires.
* Not built: IdP-initiated sign-in, encrypted assertions, single logout, importing IdP metadata
  automatically, and signing the AuthnRequest.

## Live classes

* Audio and video run on a **LiveKit** media server that you operate or rent; this application schedules
  classes, decides who may enter and what they may do, and records attendance. Set `LIVEKIT_URL`,
  `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` (at least 32 characters). Without them classes can still be
  scheduled, but starting and joining answer 503 and the screens say so. Point the LiveKit server's
  webhook at `POST /api/v1/integrations/livekit` using the same key and secret. If the web app ever gets a
  Content-Security-Policy, `connect-src` must allow the LiveKit URL.
* **Scheduling** (`/courses/:id/live-sessions`): course editors (assigned instructor, administrator) create
  a class (title, time not in the past, 5-480 minutes, whether learners may use camera and microphone).
  It appears on the calendar and enrolled learners are notified (and e-mailed under the usual rules).
  Editors can reschedule or cancel a class that has not started (the calendar entry follows; cancelling
  tells learners). TAs can see and join classes but not schedule, start or end them.
* **Lifecycle:** `SCHEDULED -> LIVE -> ENDED`, or `SCHEDULED -> CANCELLED`. Starting is idempotent (a
  double click, or two starts at once, both succeed) and notifies learners once. Ending closes every open
  attendance record.
* **Joining** (`POST /live-sessions/:id/join`): only while the class is LIVE, only for people who may see
  the course content and are enrolled (or are its staff); auditors and dropped or unenrolled learners are
  refused. The response is the server URL and a signed LiveKit token for that person and that room only.
  Instructors and administrators join as host (publish, and room admin); assigned TAs may publish but
  are not room admins; learners may watch, listen and chat, and publish audio/video only if the
  instructor allowed it. The token, not the web page, enforces this. Tokens last until shortly after the
  scheduled end (15 minutes to 12 hours).
* **Attendance:** joining records a visit; the media server's webhooks (`participant_joined` / `left`,
  `room_finished`) supply the time actually spent in the room. Time is added only if the person is still
  marked active, so a duplicated webhook cannot count it twice. Five minutes counts as present. Course
  staff see a roster of enrolled learners with minutes, joins and whether they are in the room now; a
  learner only sees whether they attended.
* **Webhook security:** the `Authorization` header is a JWT signed with the API secret that commits to
  the SHA-256 of the exact body, so only the media server can call it and a captured header cannot be
  reused with a different body. Room names carry the tenant (`lms_<tenant>_<session>`) because a webhook
  has no login; a room naming another tenant cannot reach this tenant's session, and identities that are
  not users of the tenant are ignored.
* **Not built:** recording, breakout rooms, a whiteboard, hand-raising, and moderating individual
  participants from the web screen (a host can remove people from within LiveKit's own tools). The room
  screen has not been exercised against a real LiveKit server.

## Known limits

* Not built: peer review; appeals for quiz grades (assignments only).
* Not enforced yet: late-submission policy, quiz question randomisation beyond shuffling the
  learner's view, guardian access to a ward's records.
* Not built yet: WebAuthn, HLS video,
  S3 asset pipeline, SMS/push delivery of notifications (in-app and e-mail only), webhook retries,
  Redis caching, native mobile apps. Suspending a user does not revoke an already-issued JWT; it
  lapses at `JWT_EXPIRES_IN`.
* Web client: the student dashboard (courses, to-do list, real quiz taking with browser-side proctoring
  events, assignments, certificates), notifications, forum, calendar, the LRS viewer, the gradebook and question
  bank screens, the teacher dashboard (metrics, proctoring feed, pending submissions) and the admin
  panels for usage, features, SSO, SCIM tokens, webhooks and data-subject requests, and the "Privacy & data"
  dialog in the header, use the live API. Still built-in sample
  data: none that are known.
