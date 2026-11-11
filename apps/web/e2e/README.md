# Web Playwright E2E Smoke Suite

End-to-end browser smoke tests for `@enterprise-lms/web` verifying:

1. **Auth route protection**: Unauthenticated visits to `/admin`, `/teacher`, and `/student` redirect to `/login?next=...`.
2. **Security headers**: Responses carry `Content-Security-Policy` and `X-Content-Type-Options: nosniff`.
3. **Sign-in & httpOnly cookie**: Submitting institutional credentials sets an `httpOnly` `lms_token` (or `__Host-lms_token`) cookie and redirects to the role-appropriate portal.
4. **Notification Center**: Authenticated shell navigation opens and closes the `Notification Center` popover.

> **Note on file format (`.mjs`)**: `@playwright/test` is intentionally not pinned in `package.json` / `package-lock.json` to keep CI `npm ci` lean until browser E2E runs are added to CI. Using ESM JavaScript (`playwright.config.mjs` and `e2e/smoke.spec.mjs`) with JSDoc types keeps `tsc --noEmit -p apps/web` and `npm run lint` passing cleanly without altering `tsconfig.json`.

## Prerequisites

1. Start PostgreSQL, the API (`apps/api`, default `http://localhost:4000`), and the Web app (`apps/web`, default `http://localhost:3000`).
2. Seed the demo/test users (e.g. `student@gurugyan.edu` / `Password123!` on the target tenant).
3. Install Playwright locally (without modifying `package-lock.json`) or run via `npx`:

```bash
# Option A: ephemeral install (does not alter package.json / package-lock.json)
npm install --no-save @playwright/test
npx playwright install chromium

# Option B: install as devDependency in apps/web when ready to wire into CI
npm install -D -w @enterprise-lms/web @playwright/test
```

## Running the Smoke Suite

From `apps/web`:

```bash
cd apps/web
npx playwright test
```

### Environment Variables

| Variable                  | Default                 | Description                                                        |
| :------------------------ | :---------------------- | :----------------------------------------------------------------- |
| `E2E_BASE_URL`            | `http://127.0.0.1:3000` | Base URL of the running Next.js web application.                   |
| `E2E_EMAIL`               | `student@gurugyan.edu`  | Sign-in email for the authenticated flow.                          |
| `E2E_PASSWORD`            | `Password123!`          | Password for `E2E_EMAIL`.                                          |
| `E2E_EXPECTED_PATH`       | `/student`              | Expected post-login pathname prefix (`/student`, `/teacher`, etc.) |
| `E2E_EXPECT_EDGE_HEADERS` | _(unset)_               | Set to `1` when testing behind Caddy to also assert page headers.  |
