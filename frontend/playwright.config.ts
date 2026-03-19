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
 *  - m1-auth.spec.ts Journey A tests register fresh accounts (no saved state)
 *  - All other tests reuse saved state from setup
 *
 * Test structure — modular m1-m6 architecture (#482):
 *  - m1-auth.spec.ts    ← M1: 教師驗證流程 (旅程 A)
 *  - m2-teacher.spec.ts ← M2: 教師班級管理 (旅程 B~D)  [#360]
 *  - m3-student.spec.ts ← M3: 學生核心功能 (旅程 E, G) [#361]
 *  - m4-admin.spec.ts   ← M4: 系統管理員  (旅程 H)    [#362]
 *  - m5-infra.spec.ts   ← M5: 非功能性測試 (N.1~N.10) [#363]
 *  - m6-learning.spec.ts← M6: 六步驟學習流程 (旅程 F) [#361]
 *
 * Legacy spec files (teacher.spec.ts, student.spec.ts, admin.spec.ts, infra.spec.ts)
 * are kept in git but excluded via testIgnore — replaced by the m1-m6 modules above.
 *
 * Reporters:
 *  - CI:    github + html (open: never) + json
 *  - Local: list + html (open: on-failure) + json
 *
 * Screenshot strategy:
 *  - `screenshot: 'on'`               — Playwright captures after every test
 *  - `withScreenshotOnFailure()`      — full-page failure screenshot via fixtures helper
 *  - `takeScreenshot()`               — named milestone screenshots for HTML report
 *
 * HTML report:
 *  - Output: playwright-report/index.html
 *  - Run locally: npx playwright show-report
 */
const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.E2E_BASE_URL ||
  'https://lingoleap-frontend-staging-958347263320.asia-east1.run.app';

export default defineConfig({
  globalTeardown: './e2e/global-teardown.ts',
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,

  // ---------------------------------------------------------------------------
  // Reporters
  //   CI:    github actions annotations + html (never auto-open) + json
  //   Local: list (live console output) + html (auto-open on failure) + json
  // ---------------------------------------------------------------------------
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['json', { outputFile: 'test-results/results.json' }],
      ]
    : [
        ['list'],
        ['html', { open: 'on-failure', outputFolder: 'playwright-report' }],
        ['json', { outputFile: 'test-results/results.json' }],
      ],

  use: {
    baseURL: BASE_URL,
    headless: true,
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
    // Playwright built-in: capture screenshot after every test (pass + fail)
    screenshot: 'on',
    // Trace on first retry (CI) for detailed step-by-step debugging
    trace: 'on-first-retry',
    // Video disabled by default — enable with `video: 'on'` for debugging
    video: 'off',
  },

  // ---------------------------------------------------------------------------
  // Exclude legacy spec files — kept in git for historical reference but NOT run.
  // The m1-m6 modules replace all of these.
  // ---------------------------------------------------------------------------
  testIgnore: [
    // Legacy role-based specs (replaced by m1-m6)
    '**/auth-flow.spec.ts',
    '**/teacher.spec.ts',
    '**/teacher-flow.spec.ts',
    '**/teacher-dashboard.spec.ts',
    '**/student.spec.ts',
    '**/student-flow.spec.ts',
    '**/admin.spec.ts',
    '**/admin-flow.spec.ts',
    '**/infra.spec.ts',
    '**/story-selection.spec.ts',
    '**/learning-flow.spec.ts',
    // One-off issue debug specs
    '**/issue-*.spec.ts',
    '**/preview-test.spec.ts',
  ],

  projects: [
    // ── Setup: authenticate once per role ────────────────────────────────────
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },

    // ── M1: 教師驗證流程 (Journey A — no storageState needed) ─────────────────
    // NOTE: m1-auth tests explicitly clear localStorage, so they are safe to
    // run under the teacher project even though teacher.json is loaded.
    {
      name: 'm1-auth',
      testMatch: /m1-auth\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/teacher.json',
      },
    },

    // ── M2: 教師班級管理 (Journeys B-D) ──────────────────────────────────────
    {
      name: 'm2-teacher',
      testMatch: /m2-teacher\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/teacher.json',
      },
    },

    // ── M3: 學生核心功能 (Journeys E, G) ─────────────────────────────────────
    {
      name: 'm3-student',
      testMatch: /m3-student\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/student.json',
      },
    },

    // ── M4: 系統管理員 (Journey H) ────────────────────────────────────────────
    {
      name: 'm4-admin',
      testMatch: /m4-admin\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/admin.json',
      },
    },

    // ── M5: 非功能性測試 (N.1~N.10) ──────────────────────────────────────────
    {
      name: 'm5-infra',
      testMatch: /m5-infra\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/student.json',
      },
    },

    // ── M6: 六步驟學習流程 (Journey F) ───────────────────────────────────────
    {
      name: 'm6-learning',
      testMatch: /m6-learning\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/student.json',
      },
    },
  ],
});
