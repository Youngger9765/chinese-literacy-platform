/**
 * createArchipelagoWorld.test.ts — #3780 群島模式（docs/prd/2026-10-30-
 * archipelago-clusters-prd.md）。
 *
 * 只鎖「類別 → 造型」這個純函式判斷（code review 2026-10-30 blocker 1）：
 * 之前呼叫端把 `/api/stories` 的原始類別碼（Science/Fable/History/Daily）
 * 直接傳進場景，但這支比對的是正規化過的中文標籤，兩邊對不上，全部島都
 * 掉進 default 造型——沒有測試抓到，因為這段判斷混在 three.js 的建構
 * 程式碼裡，沒辦法單獨測。抽出來之後補四個正類別 + 一個空字串案例。
 */
import { describe, it, expect } from 'vitest';
import { landmarkShapeFor } from '../createArchipelagoWorld';

describe('landmarkShapeFor — 類別（已正規化的中文標籤）→ 造型', () => {
  it('自然科學 → science', () => {
    expect(landmarkShapeFor('自然科學')).toBe('science');
  });

  it('寓言故事 → fable', () => {
    expect(landmarkShapeFor('寓言故事')).toBe('fable');
  });

  it('歷史人文 → history', () => {
    expect(landmarkShapeFor('歷史人文')).toBe('history');
  });

  it('生活 → daily', () => {
    expect(landmarkShapeFor('生活')).toBe('daily');
  });

  it('空字串／查不到的標籤 → default（fail-closed，不拋錯）', () => {
    expect(landmarkShapeFor('')).toBe('default');
    expect(landmarkShapeFor('其他')).toBe('default');
    expect(landmarkShapeFor('Science')).toBe('default'); // 沒正規化過的原始碼也要落在 default，不是巧合對上
  });
});
