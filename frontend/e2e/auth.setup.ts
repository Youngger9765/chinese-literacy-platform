/**
 * Global auth setup — runs once before all tests to create saved auth states.
 * This avoids hitting rate limits by logging in only once per role.
 */
import { test as setup, expect } from '@playwright/test';

const TEACHER_EMAIL = 'teacher@test.com';
const TEACHER_PASSWORD = 'teacher1234';
const ADMIN_EMAIL = 'admin@test.com';
const ADMIN_PASSWORD = 'admin1234';
const STUDENT_EMAIL = 'student@test.com';
const STUDENT_PASSWORD = 'student1234';

const FRONTEND_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.E2E_BASE_URL ||
  'https://lingoleap-frontend-staging-958347263320.asia-east1.run.app';

const BACKEND_BASE_URL = FRONTEND_BASE_URL.replace('frontend', 'backend');

async function loginAndGetToken(
  request: import('@playwright/test').APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const loginRes = await request.post(`${BACKEND_BASE_URL}/api/auth/login`, {
    headers: { 'Content-Type': 'application/json' },
    data: { email, password },
  });

  expect(loginRes.ok()).toBeTruthy();
  const loginJson = await loginRes.json();
  const token = loginJson.access_token as string | undefined;
  expect(token).toBeTruthy();

  // Verify token is usable before storing it as auth state.
  const meRes = await request.get(`${BACKEND_BASE_URL}/api/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(meRes.ok()).toBeTruthy();

  return token!;
}

async function saveStorageStateWithToken(
  page: import('@playwright/test').Page,
  token: string,
  statePath: string,
): Promise<void> {
  await page.goto('/');
  await page.evaluate((tokenValue) => {
    localStorage.setItem('lingoleap_token', tokenValue);
  }, token);
  await page.context().storageState({ path: statePath });
}

setup('authenticate as teacher', async ({ page, request }) => {
  const token = await loginAndGetToken(request, TEACHER_EMAIL, TEACHER_PASSWORD);
  await saveStorageStateWithToken(page, token, 'e2e/.auth/teacher.json');
});

setup('authenticate as admin', async ({ page, request }) => {
  const token = await loginAndGetToken(request, ADMIN_EMAIL, ADMIN_PASSWORD);
  await saveStorageStateWithToken(page, token, 'e2e/.auth/admin.json');
});

setup('authenticate as student', async ({ page, request }) => {
  // Use pre-seeded student account instead of self-registering.
  // Student self-registration was blocked in #457; seed accounts have email_verified=True (#475).
  const token = await loginAndGetToken(request, STUDENT_EMAIL, STUDENT_PASSWORD);
  await saveStorageStateWithToken(page, token, 'e2e/.auth/student.json');
});
