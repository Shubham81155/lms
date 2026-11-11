import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * k6 High-Concurrency Exam & Proctoring Load Test
 *
 * Exercises the end-to-end learner exam flow against the Express API:
 *   1. Authenticate once per VU via POST /api/v1/auth/login (httpOnly session cookie)
 *   2. Discover or fetch the target quiz (GET /api/v1/quizzes/:id)
 *   3. Open/resume an exam attempt once per VU (POST /api/v1/quizzes/:id/start)
 *   4. Repeatedly fetch exam state and post proctoring telemetry (POST /api/v1/proctoring/events)
 *
 * Thresholds match docs/architecture/load_testing_sla.md (p95 < 100ms, failure rate < 0.1%).
 */

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');
const TENANT_ID = __ENV.TENANT_ID || 'harvard';
const TEST_EMAIL = __ENV.TEST_EMAIL || 'student@gurugyan.edu';
const TEST_PASSWORD = __ENV.TEST_PASSWORD || 'Password123!';

const CONFIGURED_COURSE_ID = __ENV.COURSE_ID || '';
const CONFIGURED_QUIZ_ID = __ENV.QUIZ_ID || '';
const CONFIGURED_SUBMISSION_ID = __ENV.SUBMISSION_ID || '';

const RAMP_VUS = Number(__ENV.RAMP_VUS || 5000);
const TARGET_VUS = Number(__ENV.TARGET_VUS || 50000);
const RAMP_UP = __ENV.RAMP_UP || '2m';
const SUSTAINED_DURATION = __ENV.SUSTAINED_DURATION || '10m';
const RAMP_DOWN = __ENV.RAMP_DOWN || '2m';

const proctorLatency = new Trend('proctor_event_duration_ms');
const examFetchLatency = new Trend('exam_fetch_duration_ms');
const authFailureRate = new Rate('auth_failed');

export const options = {
  stages: [
    { duration: RAMP_UP, target: RAMP_VUS },
    { duration: SUSTAINED_DURATION, target: TARGET_VUS },
    { duration: RAMP_DOWN, target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<100'],
    http_req_failed: ['rate<0.001'],
    auth_failed: ['rate<0.001'],
  },
};

// Per-VU session state so each virtual user logs in once and reuses its httpOnly cookie.
let initialized = false;
let activeQuizId = CONFIGURED_QUIZ_ID;
let activeSubmissionId = CONFIGURED_SUBMISSION_ID;
let proctoringEnabled = Boolean(CONFIGURED_SUBMISSION_ID);

function baseHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Tenant-ID': TENANT_ID,
  };
}

function parseJsonSafe(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}

function initializeVuSession() {
  const headers = baseHeaders();

  const loginRes = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }), {
    headers,
    tags: { endpoint: 'auth_login' },
  });

  const loginOk = check(loginRes, {
    'login status is 200': (r) => r.status === 200,
    'login returns user payload': (r) => Boolean(parseJsonSafe(r)?.user?.id),
  });
  authFailureRate.add(!loginOk);

  if (!loginOk) {
    return false;
  }

  // Discover course and quiz when QUIZ_ID is not supplied explicitly.
  if (!activeQuizId) {
    let courseId = CONFIGURED_COURSE_ID;
    if (!courseId) {
      const coursesRes = http.get(`${BASE_URL}/api/v1/courses`, {
        headers,
        tags: { endpoint: 'courses_list' },
      });
      const coursesBody = parseJsonSafe(coursesRes);
      const courses = Array.isArray(coursesBody?.data) ? coursesBody.data : [];
      if (courses.length > 0) {
        courseId = courses[0].id;
      }
    }

    if (courseId) {
      const quizzesRes = http.get(`${BASE_URL}/api/v1/courses/${courseId}/quizzes`, {
        headers,
        tags: { endpoint: 'course_quizzes' },
      });
      const quizzesBody = parseJsonSafe(quizzesRes);
      const quizzes = Array.isArray(quizzesBody?.data) ? quizzesBody.data : [];
      const preferred = quizzes.find((q) => q.requireProctoring) || quizzes[0];
      if (preferred) {
        activeQuizId = preferred.id;
        proctoringEnabled = Boolean(preferred.requireProctoring);
      }
    }
  }

  // Open or resume an active attempt so proctoring telemetry attaches to a real open submission.
  if (activeQuizId && !activeSubmissionId) {
    const startRes = http.post(`${BASE_URL}/api/v1/quizzes/${activeQuizId}/start`, '{}', {
      headers,
      tags: { endpoint: 'quiz_start' },
    });
    const startBody = parseJsonSafe(startRes);
    if ((startRes.status === 200 || startRes.status === 201) && startBody?.data?.submissionId) {
      activeSubmissionId = startBody.data.submissionId;
    }
  }

  initialized = true;
  return true;
}

export default function () {
  if (!initialized) {
    const ok = initializeVuSession();
    if (!ok) {
      sleep(1);
      return;
    }
  }

  const headers = baseHeaders();

  // 1. Fetch Exam State
  if (activeQuizId) {
    const quizRes = http.get(`${BASE_URL}/api/v1/quizzes/${activeQuizId}`, {
      headers,
      tags: { endpoint: 'quiz_fetch' },
    });
    examFetchLatency.add(quizRes.timings.duration);
    check(quizRes, {
      'exam fetch status is 200': (r) => r.status === 200,
    });

    const quizBody = parseJsonSafe(quizRes);
    if (quizBody?.data && typeof quizBody.data.requireProctoring === 'boolean') {
      proctoringEnabled = quizBody.data.requireProctoring;
    }
  }

  // 2. Submit Proctoring Telemetry (only when an open attempt exists on a proctored quiz)
  if (activeSubmissionId && proctoringEnabled) {
    const proctorPayload = JSON.stringify({
      submissionId: activeSubmissionId,
      eventType: 'TAB_SWITCH',
      severity: 'LOW',
      metadata: {
        vu: __VU,
        iter: __ITER,
        source: 'k6-exam-load',
      },
    });
    const proctorRes = http.post(`${BASE_URL}/api/v1/proctoring/events`, proctorPayload, {
      headers,
      tags: { endpoint: 'proctoring_event' },
    });
    proctorLatency.add(proctorRes.timings.duration);
    check(proctorRes, {
      'proctoring event recorded (201)': (r) => r.status === 201,
    });
  }

  sleep(1);
}
