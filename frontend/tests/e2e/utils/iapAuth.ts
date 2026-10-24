/**
 * iapAuth.ts — IAP 通行證小工具，Node/Playwright 版 (#3719)
 *
 * 均一未來可能在 staging/preview 的 Cloud Run 服務前面加一層 IAP
 * (Google 身分驗證)。headless 的 Playwright context 不是真人瀏覽器，
 * 沒有互動登入，所以每個 request 要自己帶一張 Google 簽名的 ID token
 * 才能通過 IAP —— 用 `Proxy-Authorization` 而不是 `Authorization`：
 * app 自己的 JWT 已經佔用了 `Authorization`，IAP 官方文件
 * "Authenticating from a program" 明載接受這個替代 header
 * (https://cloud.google.com/iap/docs/authentication-howto)。
 *
 * 這階段 IAP 還沒打開、沒有人設 IAP_AUDIENCE，所以
 * `getIapProxyAuthHeader()` 永遠回傳 `{}` —— 對呼叫端是零行為改變。
 *
 * 三個語言各有一份實作（bash/python 的邏輯都只在 scripts/iap_token.py
 * 寫一次，見那支的註解）；這份是 Node 這端唯一一份，不要在 spec 檔裡
 * 各自重寫。
 */
import { execFileSync } from 'node:child_process';

export type TokenMinter = (audience: string) => string;

/**
 * 真正去跟 gcloud 要 token 的實作。拆成獨立函式（而不是 inline 在
 * `getIapProxyAuthHeader` 裡）是為了讓單元測試能直接注入假的 minter ——
 * Vitest 對 ESM 的 Node 內建模組（`node:child_process`）跨檔案 mock 有
 * 已知限制（同一支 built-in 在不同模組拿到的不是同一個可攔截的綁定），
 * 用依賴注入繞開，比硬 mock child_process 穩。見 iapAuth.test.ts。
 */
function mintTokenViaGcloud(audience: string): string {
  return execFileSync(
    'gcloud',
    ['auth', 'print-identity-token', `--audiences=${audience}`],
    { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim();
}

let cached: Record<string, string> | null = null;

/**
 * 回傳 `{ 'Proxy-Authorization': 'Bearer <token>' }` 或 `{}`，永不丟例外。
 * 第一次呼叫後快取 —— 同一個 process 裡的所有 request 共用同一張 token。
 *
 * @param mintToken 測試專用注入點；正常呼叫不要傳，用預設的 gcloud 實作。
 */
export function getIapProxyAuthHeader(
  mintToken: TokenMinter = mintTokenViaGcloud,
): Record<string, string> {
  if (cached) return cached;
  const audience = process.env.IAP_AUDIENCE;
  if (!audience) {
    cached = {};
    return cached;
  }
  try {
    const token = mintToken(audience);
    cached = token ? { 'Proxy-Authorization': `Bearer ${token}` } : {};
  } catch {
    // 沒裝 gcloud / 沒登入 / token 要不到 —— 安靜放棄，呼叫端走無 header 路徑
    cached = {};
  }
  return cached;
}

/** 測試專用：清掉記憶體快取，讓下一次呼叫重新判斷環境變數。 */
export function _resetIapProxyAuthHeaderCacheForTests(): void {
  cached = null;
}
