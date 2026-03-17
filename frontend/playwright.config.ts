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
 *  - teacher.spec.ts Journey A tests register fresh accounts (no saved state)
 *  - All other tests reuse saved state from setup
 *
 * Test structure (maps to QA Checklist Issues):
 *  - teacher.spec.ts  ← #360 教師測試 (旅程 A~D)
 *  - student.spec.ts  ← #361 學生測試 (旅程 E~G)
 *  - admin.spec.ts    ← #362 管理員測試 (旅程 H)
 *  - infra.spec.ts    ← #363 非功能性測試 (N.1~N.10)
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
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]]
    : [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
    screenshot: 'on',
    trace: 'on-first-retry',
  },

  /* Exclude legacy spec files — kept in git but not run */
  testIgnore: [
    '**/auth-flow.spec.ts',
    '**/teacher-flow.spec.ts',
    '**/teacher-dashboard.spec.ts',
    '**/student-flow.spec.ts',
    '**/story-selection.spec.ts',
    '**/learning-flow.spec.ts',
    '**/admin-flow.spec.ts',
    '**/issue-*.spec.ts',
    '**/preview-test.spec.ts',
  ],

  projects: [
    // Setup: authenticate once per role
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // #360 教師測試 (旅程 A~D)
    {
      name: 'teacher',
      testMatch: /teacher\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/teacher.json',
      },
    },
    // #361 學生測試 (旅程 E~G)
    {
      name: 'student',
      testMatch: /student\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/student.json',
      },
    },
    // #362 管理員測試 (旅程 H)
    {
      name: 'admin',
      testMatch: /admin\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/admin.json',
      },
    },
    // #363 非功能性測試 (N.1~N.10)
    {
      name: 'infra',
      testMatch: /infra\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/student.json',
      },
    },
  ],
});
