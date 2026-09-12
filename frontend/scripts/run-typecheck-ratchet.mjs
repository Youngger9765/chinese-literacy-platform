#!/usr/bin/env node
/**
 * 跑 tsc，把出貨程式碼的錯誤數跟 typecheck-baseline.json 比對（#3195）。
 * 變多就 exit 1 並列出新增的那幾條。
 *
 * ⚠️ tsc 有錯時 exit code 非 0 —— 這裡**不能**因此就當成失敗，
 *    因為基準本來就有 39 個錯。要看的是解析後的數量，不是 tsc 的 exit code。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseErrors, evaluateRatchet, CURRENT_SCHEMA_VERSION } from './typecheckRatchet.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE = resolve(here, '..', 'typecheck-baseline.json');

let out = '';
try {
  out = execFileSync('npx', ['tsc', '--noEmit'], { cwd: resolve(here, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
} catch (e) {
  // tsc 有型別錯誤時以非 0 結束，輸出在 stdout —— 那是正常情況，不是失敗。
  //
  // ⚠️ 但**生不出行程**（npx 不見、tsc 壞掉、ENOENT）時 stdout/stderr 都是 null，
  //    接成空字串之後 parseErrors('') 回三個空陣列，底下的守衛也不會發火，
  //    於是整個門會印「型別錯誤從 39 降到 0，請調降到 0」然後 exit 0 ——
  //    基礎設施整個爛掉卻讀成「太棒了，棘輪更緊了」。所以這裡要先分開。
  if (e.code === 'ENOENT' || e.status === undefined || e.stdout == null) {
    console.error('⛔ 跑不起 tsc，這道門無法判斷 —— 不要當成通過。');
    console.error(`   code=${e.code ?? '-'} status=${e.status ?? '-'} signal=${e.signal ?? '-'}`);
    if (e.stderr) console.error(String(e.stderr).slice(0, 500));
    process.exit(2);
  }
  if (e.code === 'ENOBUFS') {
    console.error('⛔ tsc 的輸出超過緩衝上限，拿到的是被截斷的內容 —— 不要當成通過。');
    process.exit(2);
  }
  out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
}

const { shipped, test, unparsed } = parseErrors(out);

// tsc 完全沒輸出且沒有錯，是可能的（零錯誤）。但如果連一行都解析不出來**而且**
// 輸出不是空的，那是格式變了 —— 當成門壞掉，不可以靜靜回報零。
if (unparsed.length > 0 && shipped.length === 0 && test.length === 0) {
  console.error('⛔ 認不得 tsc 的輸出格式，這道門無法判斷 —— 不要當成通過。前幾行：');
  console.error(unparsed.slice(0, 5).map((l) => '   ' + l).join('\n'));
  process.exit(2);
}

if (process.argv.includes('--write-baseline')) {
  // 這份基準是 pipeline 的產物，所以它必須說得出自己從哪來 ——
  // 少了這幾行，下一個人會把 39 當成「真值」而不是「某一版某個指令的輸出」。
  // （repo 既有的 test_golden_files_declare_provenance_spec.py 就是擋這件事的。）
  let sha = 'unknown';
  try {
    // 用短 SHA：40 字元的十六進位字串會被 repo 的 secret 掃描器認成憑證
    //（實測 40 字元 → 命中 azure_openai；12 字元 → 0 命中）。12 碼在這個 repo 足以唯一定位。
    sha = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: resolve(here, '..'), encoding: 'utf8' }).trim();
  } catch { /* 不在 git 樹裡也要能產生基準，只是來源標成 unknown */ }

  writeFileSync(BASELINE, JSON.stringify({
    _comment: '#3195 型別檢查棘輪的基準。只算出貨程式碼（測試檔不算）。改這個檔要在 PR 裡說明。',
    _provenance: {
      derived_from: 'npx tsc --noEmit，取 error 行、排除測試檔（*.test.* / *.spec.* / *.eval.* / __tests__ / __smoke__ / test(s) 路徑片段）',
      generated_by: 'frontend/scripts/run-typecheck-ratchet.mjs --write-baseline',
      frozen_at: new Date().toISOString(),
      edition: `git ${sha}`,
      note: '⚠️ 這是產物不是真值。tsconfig、TypeScript 版本或排除規則改了，這個數字就會動 —— 重跑 --write-baseline，不要手改。',
    },
    // 比對鍵的格式版本。改 keyOf 就要在 typecheckRatchet.mjs 把 CURRENT_SCHEMA_VERSION +1，
    // 這樣沒重建基準的情況會被直接認出來，而不是變成「一次多了 39 個錯」。
    schemaVersion: CURRENT_SCHEMA_VERSION,
    shippedErrors: shipped.length,
    // 必須連 text 一起存 —— 比對的鍵是 file|code|text，少了它每一條都會對不上、整批誤報
    entries: shipped.map((e) => ({ file: e.file, code: e.code, text: e.text }))
      .sort((a, b) => (a.file + a.code + a.text).localeCompare(b.file + b.code + b.text)),
  }, null, 2) + '\n', 'utf8');
  console.log(`✅ 基準已寫入：出貨程式碼 ${shipped.length} 個錯（測試檔 ${test.length} 個不算）`);
  process.exit(0);
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
const v = evaluateRatchet(shipped, base.shippedErrors, base.entries ?? null, base.schemaVersion);

console.log(`型別檢查棘輪：出貨程式碼 ${v.count} 個錯（基準 ${v.baselineCount}）／測試檔 ${test.length} 個（不算）`);
console.log(v.message);
process.exit(v.ok ? 0 : 1);
