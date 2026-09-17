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

/**
 * 兩個環境變數要**成對**設，漏一個是靜默的（#3242）。
 *
 * 各支 spec 的後端位址是 `process.env.E2E_BACKEND_URL || '<staging>'`。
 * 只設 `PLAYWRIGHT_BASE_URL`（指到 preview）而沒設 `E2E_BACKEND_URL` 的話，
 * **畫面打 preview、API 打 staging** —— 而 log 上什麼都看不出來。
 *
 * 更毒的是空字串：`preview-deploy.yml` 用
 * `gcloud ... --format='value(status.url)' || echo "N/A"` 取 URL，
 * 而 gcloud **成功但印空字串**時 `$?` 是 0 → `||` 不觸發 → 拿到空字串而不是 `N/A`
 * → 下游 `!= 'N/A'` 的判斷放行 → `E2E_BACKEND_URL=''` → JS 的 `||` 對空字串回退
 * → 又是畫面 preview、API staging。
 *
 * `full-qa` 的 `loginAs` 讓這件事更貴：token 從 `E2E_BACKEND_URL` 那顆後端拿、
 * 塞進 baseURL origin 的 localStorage，SPA 再用 build 時烤進去的 `VITE_API_URL`
 * 打另一顆後端。兩顆後端的 user id 不同 → 失敗長得像奇怪的 401/404，
 * 不像「環境設錯」。所以這裡 fail-closed，報 INVALID 而不是讓它跑出一個假的紅。
 */
export function assertEnvPaired() {
  const base = process.env.PLAYWRIGHT_BASE_URL;
  const backend = process.env.E2E_BACKEND_URL;
  if (backend !== undefined && backend.trim() === '') {
    throw new Error(
      '⛔ INVALID：E2E_BACKEND_URL 是空字串 —— JS 的 || 會靜默回退打 staging。' +
      '八成是取 preview URL 那步拿到空值（gcloud 成功但印空字串），修 setup 再重跑（#3242）',
    );
  }
  // base 指向 staging 時不設 backend 是對的（預設值就是 staging）；
  // 指向別的環境（preview）卻不設 backend，才是那個靜默的錯。
  if (base && !backend && !/staging/.test(base)) {
    throw new Error(
      `⛔ INVALID：指定了 PLAYWRIGHT_BASE_URL=${base} 但沒設 E2E_BACKEND_URL —— ` +
      `API 會回退打各支 spec 的預設值（staging 後端），畫面與 API 在兩個環境，` +
      `這一輪的綠不算數（#3242）`,
    );
  }
}

export default async function globalSetup() {
  assertEnvPaired();
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
