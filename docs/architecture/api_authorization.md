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

## Known limits

* Not enforced yet: proctoring requirements, late-submission policy, quiz question randomisation
  beyond shuffling the learner's view, guardian access to a ward's records.
* `analytics/*`, xAPI, proctoring and LTI endpoints are still stubs (Phase 4); the two ingestion
  stubs now require authentication.
