/**
 * #3750 —— e2e spec 打 /api/admin/seed/demo-students 不得用時間戳當 prefix。
 *
 * ## 為什麼需要這條
 *
 * `backend/app/services/test_seed_service.py` 的 `seed_demo_students` 是
 * **逐 email 冪等**設計：同一個 prefix 重複呼叫會重用同一批帳號，不會一直長。
 * 但 `full-qa.spec.ts` 跟 `demo-path.spec.ts` 都曾經帶
 * `prefix: 'qa' + Date.now()...` / `'e2e' + Date.now()...` —— 每次執行都是
 * 全新的 email，直接繞過這個冪等設計。兩支都固定打 `classroom_id: 1`（共用
 * 的示範班級），從沒有清理過，~4.5 個月下來把那個班級灌到 1,928 個「學生」。
 * 跨班賽季功能把 `roster_size` 原封不動顯示給使用者，才第一次讓這個污染
 * 被看見（「全班 1,698 人已參與」）。
 *
 * 這條鎖只管「呼叫這支 API 的 prefix 是不是時間戳生成的」——不是說時間戳本身
 * 違法，是說**只要 prefix 每次不同，冪等設計就形同虛設**，污染只會一直長。
 *
 * ## 量具的正負對照（避免重蹈 #3242 的覆轍：整檔出現過一次不算過）
 *
 * `Date.now()` 這個字面值如果出現在檔案任何地方都算違規太寬鬆、都不算又太窄
 * ——判準是「`prefix:` 欄位的值本身含不含 `Date.now()`／`Math.random()`／
 * 其他執行期變動值」。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const E2E_DIR = join(__dirname, '../../tests/e2e');

/** 會呼叫 demo-seed API 的 `data: { ... prefix: ... }` 區塊。*/
const SEED_CALL_BLOCK = /data:\s*\{[^}]*prefix:[^}]*\}/g;

/** prefix 欄位值裡含執行期變動值（時間戳／亂數）——冪等設計形同虛設的訊號。*/
const VOLATILE_PREFIX = /prefix:\s*[^,}]*\b(Date\.now|Math\.random|performance\.now|uuid|crypto\.random)/i;

function e2eFiles(): string[] {
  // 不按檔名排除任何檔案 —— 判定完全交給下面「有沒有打這支 API」的內容檢查。
  // code review 2026-10-24：原本這裡排除了檔名含 demo-seed/seed-demo 的檔案，
  // 但一支叫 `demo-seed-cleanup.spec.ts`（這張票本身就會讓人想這樣命名）如果
  // 用 Date.now() 當 prefix，會被這條過濾器悄悄放過——檔名剛好最可能撞到這個
  // 過濾器的，正是最該被這道鎖盯住的那種檔案。
  return readdirSync(E2E_DIR, { recursive: true, encoding: 'utf-8' })
    .filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f))
    .sort();
}

/** 找出「呼叫 demo-seed 的 prefix 用了執行期變動值」的檔案清單。*/
function offenders(): string[] {
  const bad: string[] = [];
  for (const file of e2eFiles()) {
    const src = readFileSync(join(E2E_DIR, file), 'utf-8');
    if (!src.includes('/admin/seed/demo-students')) continue;
    for (const block of src.match(SEED_CALL_BLOCK) ?? []) {
      if (VOLATILE_PREFIX.test(block)) {
        bad.push(`${file}: ${block.replace(/\s+/g, ' ').trim()}`);
      }
    }
  }
  return bad;
}

describe('#3750 demo-seed 呼叫的 prefix 不得用時間戳/亂數', () => {
  it('量具抓得到 e2e 檔案', () => {
    const files = e2eFiles();
    expect(files.length, `只掃到 ${files.length} 個檔：${files.join(', ')}`).toBeGreaterThanOrEqual(8);
  });

  it('量具的正負對照都成立', () => {
    // 該命中的要命中
    expect(VOLATILE_PREFIX.test("data: { classroom_id: 1, count: 1, prefix: 'qa' + Date.now().toString() }")).toBe(true);
    expect(VOLATILE_PREFIX.test("data: { classroom_id: 1, count: 1, prefix: 'e2e' + Math.random() }")).toBe(true);
    // 固定字面值 prefix 不該命中（負向對照）
    expect(VOLATILE_PREFIX.test("data: { classroom_id: 1, count: 1, prefix: 'qa-fullqa-smoke' }")).toBe(false);
    expect(VOLATILE_PREFIX.test("data: { classroom_id: 1, count: 1, prefix: 'e2e-demopath-smoke' }")).toBe(false);
    // SEED_CALL_BLOCK 要抓得到完整的 data 區塊（含換行）
    const multiline = `data: {\n  classroom_id: 1,\n  count: 1,\n  prefix: 'qa' + Date.now().toString().slice(-6),\n}`;
    const blocks = multiline.match(SEED_CALL_BLOCK) ?? [];
    expect(blocks.length).toBe(1);
    expect(VOLATILE_PREFIX.test(blocks[0])).toBe(true);
  });

  it('full-qa.spec.ts 與 demo-path.spec.ts 現在真的都在打這支 API（量具沒有對著空氣）', () => {
    const files = e2eFiles();
    const callers = files.filter((f) => {
      const src = readFileSync(join(E2E_DIR, f), 'utf-8');
      return src.includes('/admin/seed/demo-students');
    });
    expect(callers, '沒有任何 e2e 檔呼叫 demo-seed API —— 量具失去鎖定目標').toContain('full-qa.spec.ts');
    expect(callers).toContain('demo-path.spec.ts');
  });

  it('沒有任何 e2e 檔用時間戳/亂數當 demo-seed 的 prefix', () => {
    const bad = offenders();
    expect(
      bad,
      `${bad.length} 處違規：\n${bad.join('\n')}\n` +
      'seed_demo_students 是逐 email 冪等設計，prefix 每次不同會讓這個設計形同虛設、' +
      '持續污染共用的 staging 班級（#3750：classroom_id=1 曾被灌到 1,928 個測試帳號）',
    ).toEqual([]);
  });
});
