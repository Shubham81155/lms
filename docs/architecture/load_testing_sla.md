# Enterprise LMS High-Concurrency Load Testing & Disaster Recovery Runbook

## 1. Concurrency Benchmarks & Target SLAs

> These are **targets** for a production deployment, not measured results. The repository does not contain
> Kubernetes manifests, a Kafka queue or multi-region infrastructure yet (see `docs/ROADMAP.md`).

| Metric                             | Target SLA                     | Architecture Strategy                                                        |
| :--------------------------------- | :----------------------------- | :--------------------------------------------------------------------------- |
| **Simultaneous Exam Takers**       | 50,000 active concurrent users | Redis state caching, batch submission queue (Kafka), read-replicas.          |
| **API Response Time ($p95$)**      | $< 100\text{ ms}$ globally     | Cloudflare Edge caching, CDN media distribution, database indexing.          |
| **Availability SLA**               | $99.95\%$ Uptime               | Multi-region Kubernetes deployment with automated cluster health checks.     |
| **Recovery Point Objective (RPO)** | $\le 5\text{ minutes}$         | Continuous PostgreSQL WAL streaming and S3 cross-region replication.         |
| **Recovery Time Objective (RTO)**  | $\le 15\text{ minutes}$        | Automated DNS failover via Route 53 health checks & active-standby clusters. |

---

## 2. Load Testing Scenario (k6 Test Script)

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 5000 }, // Ramp-up
    { duration: '10m', target: 50000 }, // Sustained heavy exam traffic
    { duration: '2m', target: 0 }, // Ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<100'],
    http_req_failed: ['rate<0.001'],
  },
};

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    'X-Tenant-ID': 'harvard',
    Authorization: 'Bearer <MOCK_OIDC_TOKEN>',
  };

  // 1. Fetch Exam State
  const res = http.get('https://api.lms.enterprise.com/api/v1/courses/cs101/quiz', { headers });
  check(res, { 'status is 200': (r) => r.status === 200 });

  // 2. Submit Proctoring Telemetry
  const proctorPayload = JSON.stringify({
    submissionId: 'sub_test_001',
    eventType: 'FACE_GAZE_OK',
    severity: 'LOW',
  });
  http.post('https://api.lms.enterprise.com/api/v1/proctoring/events', proctorPayload, { headers });

  sleep(1);
}
```

---

## 3. Disaster Recovery (DR) Execution Playbook

1. **Primary Region Degradation Event**:
   - Cloudflare health checks detect 3 consecutive failed probes on primary endpoint.
2. **Automated Traffic Rerouting**:
   - DNS updates to standby cluster in secondary region (`us-west-2`).
3. **Database Promotion**:
   - Promote read-replica PostgreSQL instance to write-primary.
   - Run verification query: `SELECT pg_is_in_recovery();` (must return `false`).
4. **Tenant Context Verification**:
   - Execute sample test tenant verification query with Row-Level Security (RLS) active.
5. **Post-Mortem & Log Synchronization**:
   - Stream audit logs to secondary SIEM instance to preserve write-once compliance records.
