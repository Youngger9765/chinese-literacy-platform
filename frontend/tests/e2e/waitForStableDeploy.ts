/**
 * #3242 —— 開跑前先等環境穩定，不要跟部署賽跑。
 *
 * ## 實測到的競態
 *
 * `E2E Tests` 的 base URL 是**共用的 staging**，而 `Deploy to Staging` 由同一個
 * push 觸發 —— 兩個 workflow 沒有相依，所以每次 push 到 staging 都會賽跑一次。
 * 測試走一輪 9–10 分鐘、部署 7 分鐘，重疊幾乎必然。
 *
 * 2026-09-16 的實際數字（PR #3241）：
 *
 *     E2E Tests          20:05:12 → 20:15:24  ❌
 *     Deploy to Staging  20:05:09 → 20:12:18  ← 完全重疊
 *     前端新 revision 建立            20:11:05
 *
 * 失敗的是 `multiTextJourney` 的**第 8–17 步**（第 2、3 篇「看不到內容」），
 * 而第 1–7 步過 —— 分界剛好落在 revision 被換掉那一刻。部署穩定後同一支重跑 5/5 passed。
 *
 * ⭐ 這也解釋先前 `full-qa` A8 那幾次「每次紅不同測試」：不是同一個 bug，
 * 是**環境在測試中途變了**。
 *
 * ## 作法：等，而不是重試
 *
 * 前端是 SPA，`index.html` 引用的 entry bundle 檔名帶 content hash ——
 * 換 revision 就換 hash。所以「連續兩次探測 hash 相同」＝ 這一刻沒有部署在滾。
 *
 * ⛔ 等不到就 **throw**，而且訊息要說清楚這是 **INVALID 不是 FAIL** ——
 * 一個「環境正在換」造成的紅，跟「code 壞了」造成的紅必須長得不一樣，
 * 否則下一個人會去修一個沒壞的東西（我自己就差點）。
 *
 * ⚠️ 這支不需要 `gcloud`、不需要 GitHub API、不需要 `workflow` scope ——
 * 只用 base URL 本身。改 `.github/workflows/` 需要 `workflow` scope 的 token，
 * 而那個限制正好逼出這個更簡單的作法。
 */

/** 從 index.html 取出 entry bundle 的檔名（換 revision 就會變）。 */
async function entryFingerprint(baseURL: string): Promise<string | null> {
  const res = await fetch(baseURL, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) return null;
  const html = await res.text();
  // Vite 產的 entry：<script ... src="/assets/index-<hash>.js">
  const m = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
  return m ? m[0] : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface StableDeploy {
  fingerprint: string;
  baseURL: string;
}

/**
 * 等到連續兩次探測拿到同一個 fingerprint。
 *
 * @param probeGapMs 兩次探測間隔。要比「換 revision 的空窗」長 —— Cloud Run
 *   換流量是秒級，30 秒足夠；太短會把同一個瞬間量兩次，等於沒等。
 * @param budgetMs 總預算。超過就 throw（視為 INVALID）。部署約 7 分鐘，
 *   給 10 分鐘。⛔ 不要無限等 —— 那會讓 CI 掛著不給答案。
 */
export async function waitForStableDeploy(
  baseURL: string,
  { probeGapMs = 30_000, budgetMs = 600_000 } = {},
): Promise<StableDeploy> {
  const started = Date.now();
  let prev = await entryFingerprint(baseURL);
  let probes = 1;

  while (Date.now() - started < budgetMs) {
    await sleep(probeGapMs);
    const now = await entryFingerprint(baseURL);
    probes += 1;
    if (now && prev && now === prev) {
      return { fingerprint: now, baseURL };
    }
    // eslint-disable-next-line no-console
    console.log(
      `[e2e] 環境還在變（第 ${probes} 次探測）：${prev ?? '(取不到)'} → ${now ?? '(取不到)'}`,
    );
    prev = now;
  }

  throw new Error(
    `\n⛔ INVALID（不是 FAIL）：${baseURL} 在 ${Math.round(budgetMs / 1000)} 秒內\n` +
    `   entry bundle 的 hash 一直在變 —— 有部署正在滾，環境會在測試中途換掉。\n` +
    `   這不是 code 壞了。等部署完成後重跑。\n` +
    `   診斷：gh run list --branch staging --json name,createdAt,updatedAt\n` +
    `        對照 gcloud run revisions list --service lingoleap-frontend-staging\n` +
    `   根因與長期修法見 #3242。\n`,
  );
}
