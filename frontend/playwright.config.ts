import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for LingoLeap E2E tests.
 *
 * BASE_URL priority:
 *  1. PLAYWRIGHT_BASE_URL env var (set by CI for PR preview environments)
 *  2. E2E_BASE_URL env var (legacy compat)
 *  3. Staging URL as fallback
 *
 * Auth strategy:
 *  - "setup" project logs in once per role and saves storageState
 *  - teacher-tests / admin-tests reuse saved state (no repeated logins)
 *  - auth-tests and student-tests register fresh accounts (no saved state)
 */
const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.E2E_BASE_URL ||
  'https://lingoleap-frontend-staging-958347263320.asia-east1.run.app';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  /* Run tests in files sequentially to avoid auth contention */
  fullyParallel: false,
  /* Retry on CI only */
  retries: process.env.CI ? 1 : 0,
  /* Reporter to use */
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    headless: true,
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
    /* Capture screenshot only on failure */
    screenshot: 'only-on-failure',
    /* Collect trace when retrying failed test */
    trace: 'on-first-retry',
  },
  projects: [
    // Setup project: logs in and saves auth state files
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Auth flow tests: no saved state (tests login/register themselves)
    {
      name: 'auth-tests',
      testMatch: /auth-flow\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Student tests: reuse saved student auth state
    {
      name: 'student-tests',
      testMatch: /student-flow\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/student.json',
      },
    },
    // Teacher tests: reuse saved teacher auth state
    {
      name: 'teacher-tests',
      testMatch: /teacher-flow\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/teacher.json',
      },
    },
    // Admin tests: reuse saved admin auth state
    {
      name: 'admin-tests',
      testMatch: /admin-flow\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/admin.json',
      },
    },
  ],
});
