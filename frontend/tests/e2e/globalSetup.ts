/**
 * #3242 —— 全域 preflight：確認環境沒有在部署中途。
 *
 * 照這個 repo 既有的 QA-validity 紀律：**環境不成立要報 INVALID/BLOCKED，不是 FAIL**。
 * 一個「部署正在滾」造成的紅，跟「code 壞了」造成的紅必須長得不一樣。
 *
 * ⛔ `E2E_SKIP_STABILITY_CHECK=1` 可以跳過（本機快速迭代用）。
 *    ⚠️ CI 不要設它 —— 那等於把這道門關掉。
 */
import { waitForStableDeploy } from './waitForStableDeploy';

export default async function globalSetup() {
  if (process.env.E2E_SKIP_STABILITY_CHECK === '1') {
    // eslint-disable-next-line no-console
    console.log('[e2e] 跳過環境穩定檢查（E2E_SKIP_STABILITY_CHECK=1）');
    return;
  }
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'https://lingoleap-staging.web.app';
  const { fingerprint } = await waitForStableDeploy(baseURL);
  // 記下來給 teardown 比對 —— 中途被換掉也要看得見
  process.env.E2E_ENTRY_FINGERPRINT = fingerprint;
  // eslint-disable-next-line no-console
  console.log(`[e2e] 環境穩定：${baseURL} entry=${fingerprint}`);
}
