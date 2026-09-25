/**
 * 課文層欄位要撐過 `api.ts` 那層逐欄映射（#3309）。
 *
 * ## 為什麼需要這條
 *
 * 一個課文層欄位要走完四層才會被學生看到，而**每一層都是逐欄寫死的**，
 * 少宣告一層就靜默消失，沒有錯誤、沒有紅燈：
 *
 *   1. `lesson_indexes.py` 組 row 的字典
 *   2. `lesson_indexes.py` 多篇課的逐篇 carry
 *   3. `routes/stories.py` 的回應投影 + `schemas/story.py`
 *   4. **`services/api.ts` 的 snake_case → camelCase 映射器** ← 這一層
 *
 * 2026-09-25 實測：#3309 的 `underlined_terms` 第 1、2 層都做了、測試全綠、
 * 元件也寫好了，去 preview 截圖才發現一個字都沒畫上 —— 第 3 層丟掉一次，
 * 補完之後第 4 層又丟掉一次。API 回應裡明明有那個欄位，`story.underlined_terms`
 * 永遠是 `undefined`，因為映射器沒有替它寫一行。
 *
 * ⛔ 這條刻意讀 `api.ts` 的原始碼而不是呼叫映射函式：要抓的就是「有沒有為這一欄
 *    寫那一行」，而不是「傳進去的物件會不會原樣出來」。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const API_TS = path.resolve(__dirname, '../api.ts');

/** 課文層欄位：snake_case（API）→ camelCase（Story）。 */
const ARTICLE_FIELDS: ReadonlyArray<[string, string]> = [
  ['source_line', 'sourceLine'],
  ['inline_table', 'inlineTable'],
  ['inline_tables', 'inlineTables'],
  ['comparison_table', 'comparisonTable'],
  ['summary_table', 'summaryTable'],
  ['underlined_terms', 'underlinedTerms'],
];

describe('api.ts 的映射器', () => {
  const src = fs.readFileSync(API_TS, 'utf-8');

  it('對照組：檔案讀得到而且看起來像映射器', () => {
    // 沒有這條的話，下面每一條在檔案被改名／搬走時都會變成空斷言
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain('sourceLine: detail.source_line');
  });

  it.each(ARTICLE_FIELDS)('把 %s 映射成 %s', (snake, camel) => {
    // 型別宣告
    expect(src).toMatch(new RegExp(`\\b${snake}\\?:`));
    // 真正那一行賦值 —— 少了它，API 回得再對前端也拿不到
    expect(src).toContain(`${camel}: detail.${snake}`);
  });
});
