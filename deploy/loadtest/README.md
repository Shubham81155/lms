# Enterprise LMS Load Testing (k6)

Runnable [k6](https://k6.io/) load test scripts aligned with the target concurrency and latency SLAs in [`docs/architecture/load_testing_sla.md`](../../docs/architecture/load_testing_sla.md).

## Scripts

- **`exam-load.js`**: Simulates concurrent exam takers authenticating via `POST /api/v1/auth/login`, fetching quiz state (`GET /api/v1/quizzes/:id`), opening/resuming an attempt (`POST /api/v1/quizzes/:id/start`), and streaming proctoring telemetry (`POST /api/v1/proctoring/events`).

## Prerequisites

1. Install k6 (`brew install k6`, `winget install k6 --source winget`, or via Docker `grafana/k6`).
2. Ensure the target API instance is reachable and has a seeded tenant/student account plus at least one published course with an active quiz (with `requireProctoring: true` if testing `POST /api/v1/proctoring/events`).
3. For large-scale load runs, raise or disable `RATE_LIMIT_LOGIN_MAX` in your staging test environment so concurrent VU logins are not throttled by the login brute-force limiter.

## Environment Variables

| Variable             | Default                 | Description                                                               |
| :------------------- | :---------------------- | :------------------------------------------------------------------------ |
| `BASE_URL`           | `http://localhost:4000` | Base URL of the API server (no trailing slash).                           |
| `TENANT_ID`          | `harvard`               | Tenant slug/ID sent in the `X-Tenant-ID` header.                          |
| `TEST_EMAIL`         | `student@gurugyan.edu`  | Learner account email used for login.                                     |
| `TEST_PASSWORD`      | `Password123!`          | Learner account password.                                                 |
| `COURSE_ID`          | _(auto-discovered)_     | Optional course ID; when omitted, picks the first visible course.         |
| `QUIZ_ID`            | _(auto-discovered)_     | Optional quiz ID; when omitted, picks the first proctored/available quiz. |
| `SUBMISSION_ID`      | _(auto-started)_        | Optional open `QuizSubmission` ID; otherwise starts/resumes an attempt.   |
| `RAMP_VUS`           | `5000`                  | Virtual users at end of ramp-up stage.                                    |
| `TARGET_VUS`         | `50000`                 | Peak virtual users during sustained stage.                                |
| `RAMP_UP`            | `2m`                    | Duration of the initial ramp-up stage.                                    |
| `SUSTAINED_DURATION` | `10m`                   | Duration of the peak sustained stage.                                     |
| `RAMP_DOWN`          | `2m`                    | Duration of the ramp-down stage.                                          |

## Running

### Local Smoke Check (low VU count)

```bash
k6 run \
  -e BASE_URL=http://localhost:4000 \
  -e TENANT_ID=harvard \
  -e TEST_EMAIL=student@gurugyan.edu \
  -e TEST_PASSWORD=Password123! \
  -e RAMP_VUS=10 \
  -e TARGET_VUS=25 \
  -e RAMP_UP=10s \
  -e SUSTAINED_DURATION=20s \
  -e RAMP_DOWN=10s \
  deploy/loadtest/exam-load.js
```

### Full SLA Benchmark (50,000 concurrent exam takers)

```bash
k6 run \
  -e BASE_URL=https://api.lms.example.com \
  -e TENANT_ID=harvard \
  -e TEST_EMAIL=loadtest-student@example.edu \
  -e TEST_PASSWORD="$LOADTEST_PASSWORD" \
  deploy/loadtest/exam-load.js
```

## Target Thresholds

- `http_req_duration`: `p(95) < 100ms`
- `http_req_failed`: `rate < 0.001` (< 0.1% errors)
- `auth_failed`: `rate < 0.001`
