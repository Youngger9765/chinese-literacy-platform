/**
 * iapAuth.ts — IAP 通行證小工具，Node/Playwright 版 (#3719, 依 #3730 實測結果重寫)
 *
 * 均一未來可能在 staging/preview 的 Cloud Run 服務前面加一層 IAP
 * (Google 身分驗證)。headless 的 Playwright context 不是真人瀏覽器，
 * 沒有互動登入，所以每個 request 要自己帶一張通得過 IAP 的 token
 * 才能通過 —— 用 `Proxy-Authorization` 而不是 `Authorization`：
 * app 自己的 JWT 已經佔用了 `Authorization`，IAP 官方文件
 * "Authenticating from a program" 明載接受這個替代 header
 * (https://cloud.google.com/iap/docs/authentication-howto)。
 *
 * ## 為什麼是「服務帳號自簽 JWT」，不是一般的 ID token
 *
 * #3730 用一個丟棄式 canary 服務實測過（IAP 真的開著）：由 Google 代管
 * OAuth client 核發的一般 ID token（這支原本呼叫的
 * `gcloud auth print-identity-token`）一律被 IAP 拒絕，回 401
 * "Invalid JWT audience" —— Cloud Run 原生 IAP 整合背後是 Google 代管的
 * OAuth client，不支援這種程式化核發的 token。
 *
 * 實測真的有效的做法：**服務帳號自己簽一張 JWT**——`iss` = `sub` =
 * 服務帳號 email，`aud` = 目標服務網址，`exp` 不超過 1 小時，放進
 * `Authorization` 或 `Proxy-Authorization` 都會通過 → 200。
 *
 * 兩種簽法，依環境自動選（跟 `scripts/iap_token.py` 的邏輯對稱，但
 * Node 這端是用 `gcloud` 轉呼叫、不是直接 call Google 的函式庫）：
 *   1. 本機或有金鑰檔的環境（`GOOGLE_APPLICATION_CREDENTIALS` 指到一個
 *      服務帳號 JSON 金鑰）→ 直接用金鑰裡的私鑰在本機簽（`node:crypto`
 *      RS256），不打任何網路請求。
 *   2. CI／沒有實體金鑰檔的環境（例如 Workload Identity Federation）→
 *      呼叫 `gcloud iam service-accounts sign-jwt --iam-account=<SA>`
 *      （已用 `--help` 核對：這支指令一律透過 IAM Credentials API 用
 *      系統代管金鑰簽，不需要拿到私鑰本身——跟 Python 那端呼叫
 *      `google.auth.iam.Signer` 殊途同歸）。簽署身分解析順序：
 *      `IAP_SIGNING_SA_EMAIL` 環境變數 → 目前 `gcloud` 的 active account
 *      （CI 跑過 `google-github-actions/auth@v2` 之後通常就是那個
 *      工作流程的服務帳號本身）。
 *
 * 這階段 IAP 還沒打開、沒有人設 IAP_AUDIENCE，所以
 * `getIapProxyAuthHeader()` 永遠回傳 `{}`、完全不會嘗試簽署 ——
 * 對呼叫端是零行為改變。
 *
 * 三個語言各有一份實作（Python/bash 的邏輯只在 scripts/iap_token.py
 * 寫一次，見那支的註解）；這份是 Node 這端唯一一份，不要在 spec 檔裡
 * 各自重寫。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSign } from 'node:crypto';

export type TokenMinter = (audience: string) => string;

/** 服務帳號自簽 JWT 的有效期上限。#3730 canary 實測這個值可行。 */
const MAX_TOKEN_LIFETIME_S = 3600;

interface SelfSignedClaims {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
}

function buildClaims(audience: string, saEmail: string, now = Math.floor(Date.now() / 1000)): SelfSignedClaims {
  return { iss: saEmail, sub: saEmail, aud: audience, iat: now, exp: now + MAX_TOKEN_LIFETIME_S };
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

/** 拿到私鑰（PEM）之後，本機用 RS256 直接簽，不打任何網路請求。 */
function signWithPrivateKey(claims: SelfSignedClaims, privateKeyPem: string): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKeyPem);
  return `${signingInput}.${base64url(signature)}`;
}

/** 有實體服務帳號金鑰檔時：讀出 `client_email` + `private_key`，本機簽。 */
function mintViaKeyFile(keyPath: string, audience: string): string | null {
  const info = JSON.parse(readFileSync(keyPath, 'utf8')) as {
    client_email?: string;
    private_key?: string;
  };
  if (!info.client_email || !info.private_key) return null;
  return signWithPrivateKey(buildClaims(audience, info.client_email), info.private_key);
}

/** 要簽署身分的服務帳號 email：環境變數優先，否則讀目前 gcloud 的 active account。 */
function resolveSigningServiceAccountEmail(): string | null {
  const override = process.env.IAP_SIGNING_SA_EMAIL;
  if (override) return override;
  try {
    const account = execFileSync('gcloud', ['config', 'get-value', 'account'], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return account || null;
  } catch {
    return null;
  }
}

/**
 * 沒有實體金鑰檔時：請 `gcloud iam service-accounts sign-jwt` 代簽
 * （它一律透過 IAM Credentials API 用系統代管金鑰簽，呼叫端的身分需要對
 * 目標服務帳號有 `roles/iam.serviceAccountTokenCreator`，或本身就是
 * 那個服務帳號）。用暫存目錄來回傳遞 claims/簽好的 JWT，因為這支
 * `gcloud` 子指令的介面是「輸入檔案 → 輸出檔案」，不是 stdin/stdout。
 */
function mintViaIamCredentialsCli(audience: string): string | null {
  const saEmail = resolveSigningServiceAccountEmail();
  if (!saEmail) return null;
  const claims = buildClaims(audience, saEmail);
  const dir = mkdtempSync(join(tmpdir(), 'iap-jwt-'));
  try {
    const inPath = join(dir, 'claims.json');
    const outPath = join(dir, 'signed.jwt');
    writeFileSync(inPath, JSON.stringify(claims));
    execFileSync(
      'gcloud',
      ['iam', 'service-accounts', 'sign-jwt', `--iam-account=${saEmail}`, inPath, outPath],
      { timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const token = readFileSync(outPath, 'utf8').trim();
    return token || null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 預設的 minter：有金鑰檔走本機簽，否則 fall back 到 IAM Credentials。
 * 拆成獨立函式（而不是 inline 在 `getIapProxyAuthHeader` 裡）是為了讓
 * 單元測試能直接注入假的 minter —— Vitest 對 ESM 的 Node 內建模組
 * （`node:child_process`／`node:fs`）跨檔案 mock 有已知限制，用依賴注入
 * 繞開，比硬 mock 穩。見 iapAuth.test.ts。
 */
function mintTokenSelfSigned(audience: string): string {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyPath && existsSync(keyPath)) {
    const viaKeyFile = mintViaKeyFile(keyPath, audience);
    if (viaKeyFile) return viaKeyFile;
  }
  const viaIam = mintViaIamCredentialsCli(audience);
  if (viaIam) return viaIam;
  throw new Error('no usable credentials to mint a self-signed IAP JWT');
}

let cached: Record<string, string> | null = null;

/**
 * 回傳 `{ 'Proxy-Authorization': 'Bearer <token>' }` 或 `{}`，永不丟例外。
 * 第一次呼叫後快取 —— 同一個 process 裡的所有 request 共用同一張 token。
 *
 * @param mintToken 測試專用注入點；正常呼叫不要傳，用預設的自簽 JWT 實作。
 */
export function getIapProxyAuthHeader(
  mintToken: TokenMinter = mintTokenSelfSigned,
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
    // 沒有可用憑證 / gcloud 不在 / 簽署被拒 —— 安靜放棄，呼叫端走無 header 路徑
    cached = {};
  }
  return cached;
}

/** 測試專用：清掉記憶體快取，讓下一次呼叫重新判斷環境變數。 */
export function _resetIapProxyAuthHeaderCacheForTests(): void {
  cached = null;
}
