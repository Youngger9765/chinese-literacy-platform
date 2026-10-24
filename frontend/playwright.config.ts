import { defineConfig } from '@playwright/test';
import { getIapProxyAuthHeader } from './tests/e2e/utils/iapAuth';

export default defineConfig({
  testDir: './tests/e2e',
  // #3242：開跑前等環境穩定、跑完再確認沒被換掉。
  // E2E 打的是共用 staging，而部署由同一個 push 觸發 —— 兩者會賽跑。
  globalSetup: './tests/e2e/globalSetup.ts',
  globalTeardown: './tests/e2e/globalTeardown.ts',
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
    // #3719 — IAP 準備：有一天 staging/preview 的 Cloud Run 服務前面可能
    // 加一層 IAP。這個 context option 套用到預設的 `page` fixture（所有
    // 瀏覽器請求，含頁面 JS 自己發的 fetch/XHR）跟 `request` fixture
    // （APIRequestContext）—— 但不套用到 spec 自己手動開的
    // `browser.newContext()`/`chromium.launch()`，那些要各自顯式帶。
    // 現在 IAP_AUDIENCE 沒人設，getIapProxyAuthHeader() 回傳 {}，等於沒加
    // 這個 option，零行為改變。
    extraHTTPHeaders: getIapProxyAuthHeader(),
  },
});
