/**
 * #3242 —— e2e spec 不得把環境網址寫死而沒有 env 出口。
 *
 * ## 為什麼需要這條
 *
 * `E2E Tests` 跟同一個 commit 的 `Deploy to Staging` 是兩個獨立 workflow，
 * 由同一個 push 觸發 → 每次都在賽跑。測試走 9–10 分鐘、部署 7 分鐘，重疊幾乎必然，
 * 於是「環境在測試中途被換掉」會表現成**每次紅不同的測試**。
 *
 * 長期解法是讓每個 PR 的 e2e 打**自己的 preview**（沒有別人會在中途換它）。
 * 那件事的前置條件就是這條鎖：**每一支 spec 都要能被指到別的環境**。
 *
 * 在這之前 `full-qa` 與 `demo-path` 把 staging 後端寫成 `const`，
 * 於是就算把 `PLAYWRIGHT_BASE_URL` 指到 preview，API 仍然打 staging ——
 * 畫面一個環境、API 另一個環境，那種綠燈什麼都不證明。
 *
 * ## 這條鎖的判準是「逐個字面值」，不是「整檔出現過一次」
 *
 * 第一版寫成 `src.includes('process.env.E2E_BACKEND_URL')` —— 整檔只要出現一次就算過。
 * 複審用 6 種方式繞過它，全部放行：在已有出口的檔案裡**再**宣告一個寫死的 const、
 * 字串拼接、放進子目錄、改用 `.test.ts` 命名、把常數 DRY 進 helper 再 import。
 * 所以現在改成：**每一個網址字面值都要緊接在自己的 env 出口後面**，
 * 而且掃描範圍遞迴、涵蓋 helper 檔與 Playwright 會吃的所有副檔名。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const E2E_DIR = join(__dirname, '../../tests/e2e');

/** 所有 lingoleap 的環境 host（含只有 host 沒有 scheme 的拼接寫法） */
const ENV_HOST = /(?:https?:\/\/)?lingoleap[a-z0-9-]*\.(?:web\.app|[a-z0-9.-]*run\.app)/gi;

/** 後端 host 要 E2E_BACKEND_URL，前端 host 要 PLAYWRIGHT_BASE_URL */
const envVarFor = (host: string) => (/backend/i.test(host) ? 'E2E_BACKEND_URL' : 'PLAYWRIGHT_BASE_URL');

/**
 * 註解裡提到網址不算違規 —— 那是說明文字，不是 code 會去打的位址。
 * ⚠️ 這一步會改變位移，所以判斷出口時要用**剝掉註解後的**同一份字串。
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** 出口必須緊貼在字面值前面：`process.env.X || `（允許再串別的 fallback） */
function hasEscapeHatchBefore(src: string, at: number, envVar: string): boolean {
  const window = src.slice(Math.max(0, at - 120), at);
  return new RegExp(`process\\.env\\.${envVar}\\b[\\s\\S]{0,80}\\|\\|[\\s|\\w.()'"\`]*$`).test(window);
}

/** Playwright 會載入的所有檔案（遞迴），helper 也算 —— 常數可以被 DRY 到 helper 裡 */
function e2eFiles(): string[] {
  return readdirSync(E2E_DIR, { recursive: true, encoding: 'utf-8' })
    .filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f))
    .sort();
}

/** 回傳「沒有對應 env 出口」的 host 清單 */
function offenders(rawSrc: string): string[] {
  const src = stripComments(rawSrc);
  const out: string[] = [];
  for (const m of src.matchAll(ENV_HOST)) {
    const host = m[0];
    if (!hasEscapeHatchBefore(src, m.index!, envVarFor(host))) out.push(host);
  }
  return out;
}

describe('#3242 e2e 的環境位址要能被環境變數覆寫', () => {
  it('量具抓得到 e2e 檔案', () => {
    // ⛔ 目錄改名、副檔名改掉、或遞迴失效的話，下面每一條都會「靜靜地通過」
    const files = e2eFiles();
    expect(files.length, `只掃到 ${files.length} 個檔：${files.join(', ')}`).toBeGreaterThanOrEqual(8);
    expect(files.filter((f) => f.endsWith('.spec.ts')).length).toBeGreaterThanOrEqual(5);
  });

  it('量具的正負對照都成立', () => {
    // 該命中的要命中 —— 含沒有 scheme 的拼接寫法
    expect("'https://lingoleap-backend-staging-1.asia-east1.run.app'".match(ENV_HOST)).not.toBeNull();
    expect("'lingoleap-backend-pr-9-x.a.run.app'".match(ENV_HOST)).not.toBeNull();
    expect('https://lingoleap-staging.web.app'.match(ENV_HOST)).not.toBeNull();
    // 不該命中的要落空（負向對照）
    expect('https://example.com/api'.match(ENV_HOST)).toBeNull();
    // 後端／前端要分得開
    expect(envVarFor('lingoleap-backend-staging-1.run.app')).toBe('E2E_BACKEND_URL');
    expect(envVarFor('lingoleap-staging.web.app')).toBe('PLAYWRIGHT_BASE_URL');
    // 出口偵測：有出口 → 空，沒出口 → 1 筆
    expect(offenders("const B = process.env.E2E_BACKEND_URL\n  || 'https://lingoleap-backend-staging-1.run.app';")).toEqual([]);
    expect(offenders("const B = 'https://lingoleap-backend-staging-1.run.app';").length).toBe(1);
    // 註解裡的網址不算違規；但同一行的 code 仍要被抓到
    expect(offenders("// 說明：https://lingoleap-backend-staging-1.run.app 是預設值")).toEqual([]);
    expect(offenders("/* https://lingoleap-staging.web.app */\nconst F = 'https://lingoleap-staging.web.app';").length).toBe(1);
  });

  it.each(e2eFiles())('%s 的每個環境網址都要配 env 出口', (file) => {
    const bad = offenders(readFileSync(join(E2E_DIR, file), 'utf-8'));
    expect(
      bad,
      `${file} 有 ${bad.length} 個環境網址沒有緊貼的 env 出口：${bad.join(', ')}\n` +
      `後端要 E2E_BACKEND_URL、前端要 PLAYWRIGHT_BASE_URL —— ` +
      `少了出口，把畫面指到 preview 時這一支仍會打 staging，那種綠燈不算數（#3242）`,
    ).toEqual([]);
  });

  describe('兩個環境變數要成對設（globalSetup 的 fail-closed）', () => {
    const run = async (env: Record<string, string | undefined>) => {
      const saved = { ...process.env };
      Object.assign(process.env, env);
      for (const k of Object.keys(env)) if (env[k] === undefined) delete process.env[k];
      try {
        const { assertEnvPaired } = await import('../../tests/e2e/globalSetup');
        assertEnvPaired();
        return 'ok';
      } catch (e) {
        return (e as Error).message;
      } finally {
        process.env = saved;
      }
    };
    const PREVIEW = 'https://lingoleap-frontend-issue-1-x.run.app';

    it('都沒設 → 過（預設就是 staging）', async () => {
      expect(await run({ PLAYWRIGHT_BASE_URL: undefined, E2E_BACKEND_URL: undefined })).toBe('ok');
    });
    it('明寫 staging 而不設 backend → 過', async () => {
      expect(await run({ PLAYWRIGHT_BASE_URL: 'https://lingoleap-staging.web.app', E2E_BACKEND_URL: undefined })).toBe('ok');
    });
    it('成對設到 preview → 過', async () => {
      expect(await run({ PLAYWRIGHT_BASE_URL: PREVIEW, E2E_BACKEND_URL: 'https://b.run.app' })).toBe('ok');
    });
    it('⛔ 指到 preview 卻漏設 backend → INVALID', async () => {
      expect(await run({ PLAYWRIGHT_BASE_URL: PREVIEW, E2E_BACKEND_URL: undefined })).toMatch(/INVALID.*沒設 E2E_BACKEND_URL/s);
    });
    it('⛔ backend 是空字串 → INVALID（JS 的 || 會靜默回退）', async () => {
      expect(await run({ PLAYWRIGHT_BASE_URL: PREVIEW, E2E_BACKEND_URL: '' })).toMatch(/INVALID.*空字串/s);
    });
  });

  it('出口的預設值仍是 staging（行為不變）', () => {
    // ⚠️ 條件是「真的把它當 URL 用」（後面接 `||` 取預設值），不是「檔案裡提到它」。
    //    `globalSetup.ts` 刻意**只讀不給預設** —— 它要分辨「沒設」與「設成空字串」，
    //    給了預設就分不出來了。把它算進來會逼它去寫一個它不該有的預設值。
    // ⚠️ 要先剝註解 —— `globalSetup.ts` 的說明文字裡就寫著
    //    `process.env.E2E_BACKEND_URL || '<staging>'` 這個樣子，會被誤選。
    const consumes = (f: string) =>
      /process\.env\.E2E_BACKEND_URL[\s\S]{0,40}\|\|/.test(
        stripComments(readFileSync(join(E2E_DIR, f), 'utf-8')));
    const withEnv = e2eFiles().filter(consumes);
    expect(withEnv.length, `只有 ${withEnv.length} 個檔有 E2E_BACKEND_URL 出口 —— 有人把出口拔掉了`)
      .toBeGreaterThanOrEqual(3);
    for (const f of withEnv) {
      const src = stripComments(readFileSync(join(E2E_DIR, f), 'utf-8'));
      expect(src, `${f} 的 E2E_BACKEND_URL 後面沒有 staging 預設值 —— 沒設環境變數時會是 undefined`)
        .toMatch(/process\.env\.E2E_BACKEND_URL[\s\S]{0,40}\|\|[\s\S]{0,20}["']https:\/\/lingoleap-backend-staging/);
    }
  });
});
