/* global process */
import { test, expect } from '@playwright/test';

const TEST_EMAIL = process.env.E2E_EMAIL || 'student@gurugyan.edu';
const TEST_PASSWORD = process.env.E2E_PASSWORD || 'Password123!';
const EXPECTED_ROLE_PATH = process.env.E2E_EXPECTED_PATH || '/student';

test.describe('Enterprise LMS Web Smoke Suite', () => {
  test('unauthenticated requests to protected portals redirect to /login with next param', async ({ page }) => {
    for (const protectedPath of ['/admin', '/teacher', '/student']) {
      await page.goto(protectedPath);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(protectedPath)}`));
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    }
  });

  test('API proxy exposes Content-Security-Policy and X-Content-Type-Options security headers', async ({ page }) => {
    const res = await page.request.get('/api/v1/health');
    expect(res.ok()).toBe(true);

    const headers = res.headers();
    expect(headers['content-security-policy']).toBeTruthy();
    expect(headers['x-content-type-options']).toBe('nosniff');

    if (process.env.E2E_EXPECT_EDGE_HEADERS === '1') {
      const docRes = await page.request.get('/login');
      const docHeaders = docRes.headers();
      expect(docHeaders['content-security-policy']).toBeTruthy();
      expect(docHeaders['x-content-type-options']).toBe('nosniff');
    }
  });

  test('login sets httpOnly session cookie, redirects by role, and opens Notification Center', async ({ page, context }) => {
    await page.goto('/login');

    await page.getByLabel('Institutional Email').fill(TEST_EMAIL);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page).toHaveURL(new RegExp(`${EXPECTED_ROLE_PATH}(?:$|/|\\?)`));

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'lms_token' || c.name === '__Host-lms_token');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);

    const notifToggle = page.getByRole('button', { name: /^Notifications/i });
    await expect(notifToggle).toBeVisible();
    await notifToggle.click();

    const notifHeading = page.getByRole('heading', { name: 'Notification Center' });
    await expect(notifHeading).toBeVisible();

    await page.getByRole('button', { name: 'Close notifications' }).click();
    await expect(notifHeading).toBeHidden();
  });
});
