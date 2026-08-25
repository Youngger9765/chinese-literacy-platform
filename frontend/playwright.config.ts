import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  workers: 1,
  reporter: 'list',
  use: {
    headless: true,
    // 測試瀏覽器一律靜音。朗讀測試會真的播出聲音，從擁有者的喇叭出來 ——
    // 2026-08-26 一次故意打掉後端的降級測試就這樣吵到他，而且他先聽到、
    // 我的攔截還沒抓到。測試不該讓人聽見。
    launchOptions: { args: ['--mute-audio'] },
    // CI sets PLAYWRIGHT_BASE_URL to the PR's preview deploy; fall back to staging
    // for local runs (#2062 — config used to ignore the env, so CI always hit staging).
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://lingoleap-staging.web.app',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
