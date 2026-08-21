/**
 * 「💡 本課學習策略」這個框對 175 課裡的 123 課是空的。
 *
 * 來源鏈是 `worksheetIntro.target_strategy` → `intro.author` → `goal_box.strategy_line`。
 * 前兩個是 Layer-1/2 欄位，二修的 uid tree **從來不寫**；第三個只有 52 課有。
 * 而 `readingStrategy` 171 課都有值，鏈上就是沒讀它 —— `types.ts` 甚至標著
 * `// for future Intro enhancement`：欄位是為了這個框加的，加了之後沒接上（2026-08-19 實測）。
 *
 * 兩者是同一件事，只差前綴：
 *     readingStrategy        '讀出故事道理'
 *     goal_box.strategy_line '目標策略：讀出故事道理'
 *
 * ⚠️ 這裡呼叫的是**生產函式本身**（`resolveRawStrategy`）。
 * 原本那段邏輯內聯在 JSX 的 IIFE 裡，測試只能自己重排一次同樣的判斷 ——
 * 那是打在複製品上，改壞生產程式碼不會變紅。所以先抽成純函式再測。
 */
import { describe, it, expect } from 'vitest';
import { resolveRawStrategy } from '../Intro';

describe('學習策略框的來源鏈', () => {
  it('只有 goal_box — 去掉「目標策略：」前綴', () => {
    expect(resolveRawStrategy({ goalBox: { strategy_line: '目標策略：讀出故事道理' } })).toBe('讀出故事道理');
  });

  it('只有 readingStrategy — 這條是新接上的，少了它 123 課的框是空的', () => {
    expect(resolveRawStrategy({ readingStrategy: '推論策略' })).toBe('推論策略');
  });

  it('兩個都有時 goal_box 優先 — 它是學習單上逐字印的那句', () => {
    expect(
      resolveRawStrategy({ goalBox: { strategy_line: '目標策略：甲' }, readingStrategy: '乙' }),
    ).toBe('甲');
  });

  it('正向對照：既有的兩個來源優先序沒有被改動', () => {
    expect(
      resolveRawStrategy({
        worksheetIntro: { target_strategy: '最優先' },
        goalBox: { strategy_line: '目標策略：不該贏' },
        readingStrategy: '也不該贏',
      }),
    ).toBe('最優先');
    expect(
      resolveRawStrategy({
        intro: { author: '說明文 · 摘要策略' },
        goalBox: { strategy_line: '目標策略：不該贏' },
      }),
    ).toBe('摘要策略');
  });

  it('全都沒有時回空字串，不是 undefined — 呼叫端用它判斷要不要 render', () => {
    expect(resolveRawStrategy({})).toBe('');
  });

  it('strategy_line 裡的換行normalize 成逗號，不會在畫面上斷行', () => {
    expect(resolveRawStrategy({ goalBox: { strategy_line: '目標策略：寫作手法──\n排比' } })).toBe(
      '寫作手法──，排比',
    );
  });
});
