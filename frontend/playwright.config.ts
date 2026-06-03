import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  workers: 1,
  reporter: 'list',
  use: {
    headless: true,
    // CI sets PLAYWRIGHT_BASE_URL to the PR's preview deploy; fall back to staging
    // for local runs (#2062 — config used to ignore the env, so CI always hit staging).
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://lingoleap-staging.web.app',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
