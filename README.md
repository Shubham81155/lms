# Enterprise Educational Learning Management System (LMS)

> Enterprise-Grade, Multi-Tenant, Cloud-Native LMS with SCORM, xAPI, LTI 1.3 Advantage, AI Proctoring, and FERPA/SOC2 Compliance.

---

## Architecture Overview

```mermaid
flowchart TD
    Client["Next.js Web / Mobile Apps / LTI Tool Consumer"] --> Gateway["API Gateway / WAF (TLS 1.3 + DDoS Shield)"]
    Gateway --> CoreAPI["API Service (Tenant Isolation & RBAC/ABAC)"]
    
    CoreAPI --> DB[("PostgreSQL Multi-Tenant (RLS)")]
    CoreAPI --> LRS[("ClickHouse xAPI LRS")]
    CoreAPI --> Media[("Encrypted S3 Media Store")]
    CoreAPI --> Cache[("Redis Cluster")]
```

---

## Monorepo Structure

```text
LMS/
├── apps/
│   ├── api/                 # Express / NestJS Backend with Tenant & Security Middleware
│   └── web/                 # Next.js Enterprise Student & Instructor Portal
├── packages/
│   ├── database/            # Multi-Tenant Prisma Schema & PostgreSQL RLS Policies
│   ├── standards/           # SCORM 1.2/2004, xAPI (Tin Can), & LTI 1.3 Advantage specs
│   └── security/            # AES-256-GCM Field-Level Encryption & RBAC/ABAC engine
├── docs/
│   └── architecture/        # In-depth architectural, compliance, and multi-tenancy guides
├── package.json             # Monorepo Workspace Configuration
└── tsconfig.json            # Root TypeScript Paths & Config
```

---

## Key Enterprise Highlights

1. **Multi-Tenancy & White-Labeling**:
   - Dynamic tenant resolution via custom domains (`learn.university.edu`) and subdomains.
   - Database-level isolation with PostgreSQL Row-Level Security (RLS).
2. **EdTech Interoperability Standards**:
   - **SCORM 1.2 & 2004 (3rd & 4th Editions)** runtime engines.
   - **xAPI (Tin Can API)** and Learning Record Store (LRS) event ingestion.
   - **LTI 1.3 Advantage** (Assignments & Grades, Names & Roles, Deep Linking).
3. **Security & Regulatory Compliance**:
   - **FERPA**, **COPPA**, **GDPR**, and **SOC 2 Type II** audit trails.
   - Field-Level Encryption (AES-256-GCM) for student PII.
   - AI-powered anti-cheat proctoring & telemetry logging.

---

## Getting Started

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Replace every `CHANGE_ME` value. The API **refuses to start** with missing, short, placeholder, or publicly known secrets.

```bash
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('PII_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Database
Prisma reads `DATABASE_URL` from the environment, not from the root `.env`, so export it first (or run these from a shell where it is set):
```bash
npm run db:generate -w @enterprise-lms/database
npm run db:push     -w @enterprise-lms/database
npm run db:seed     -w @enterprise-lms/database   # dev only; users get SEED_PASSWORD
```

### 4. Run
```bash
npm run dev   # API on :4000, web on :3000
```

### 5. Test
```bash
npm test
```

---

## Authentication model

- Passwords are hashed with bcrypt. Legacy SHA-256 / scrypt hashes are upgraded on next successful sign-in; plaintext is never accepted.
- `POST /api/v1/auth/login` sets the session as an **httpOnly, SameSite=Lax** cookie (`Secure` in production). No token is returned to JavaScript. API clients may also send `Authorization: Bearer <jwt>`.
- The web app proxies `/api/v1/*` to the API (`API_URL`), so the cookie is first-party. `src/middleware.ts` validates the session with the API before serving `/student`, `/teacher` and `/admin`.
- After `MAX_FAILED_LOGINS` failures an account is locked for `LOCKOUT_MINUTES`. Login and token endpoints are rate limited per IP; set `TRUST_PROXY=1` when the API sits behind the Next.js proxy or a load balancer and is not directly reachable from the internet.
- The tenant of an authenticated request always comes from the verified token. `x-tenant-id` / subdomain are only hints used to pick the tenant at login.
- Password reset and email verification use single-use, hashed, expiring tokens. Until a real mail transport is registered with `setMailer()`, links are only printed to the console in development.
