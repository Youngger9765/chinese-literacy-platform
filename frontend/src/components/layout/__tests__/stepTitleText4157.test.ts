/**
 * #4157 / #4155 —— 頁首不再寫「報告 10/10」，關卡位置改成獨立的「第 N / M 關」，
 * 報告不算在 M 裡。
 */
import { describe, expect, it } from 'vitest';
import { stepTitleText, stepCounterText, stepCountExcludingReport } from '../stepTitleText';

const steps = [
  { id: 'lesson-intro', label: '課程簡介' },
  { id: 'comprehension', label: '閱讀理解' },
  { id: 'report', label: '報告' },
];

describe('stepTitleText（只有名稱）', () => {
  it('⭐ 任何關卡都只回名稱，不帶 N/total', () => {
    expect(stepTitleText(steps[2])).toBe('報告');
    expect(stepTitleText(steps[1])).toBe('閱讀理解');
  });
});

describe('stepCounterText（#4155）', () => {
  it('⭐ 第 N / M 關，M 不含報告', () => {
    expect(stepCounterText(steps, 1, false)).toBe('第 2 / 2 關');
    expect(stepCounterText(steps, 0, false)).toBe('第 1 / 2 關');
  });
  it('⛔ 報告頁與工具箱模式不顯示', () => {
    expect(stepCounterText(steps, 2, false)).toBeNull();
    expect(stepCounterText(steps, 0, true)).toBeNull();
  });
  it('⛔ 報告不在最後時，分子也不會超過分母', () => {
    const odd = [
      { id: 'lesson-intro', label: '課程簡介' },
      { id: 'report', label: '報告' },
      { id: 'comprehension', label: '閱讀理解' },
    ];
    expect(stepCounterText(odd, 2, false)).toBe('第 2 / 2 關');
  });
  it('⛔ 多文本課同一關重複多輪，每一輪各算一關', () => {
    const multi = [
      { id: 'full-text-annotate', label: '讀全文-做記號' },
      { id: 'full-text-annotate', label: '讀全文-做記號' },
      { id: 'report', label: '報告' },
    ];
    expect(stepCounterText(multi, 1, false)).toBe('第 2 / 2 關');
  });
});

describe('stepCountExcludingReport', () => {
  it('⭐ 不含報告', () => {
    expect(stepCountExcludingReport(steps)).toBe(2);
  });
});
