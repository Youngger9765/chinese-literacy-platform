/**
 * #4157 —— 頁首不再寫「報告 10/10」：那是關卡位置，跟同頁「完成 0 / 9 關」會互相矛盾。
 */
import { describe, expect, it } from 'vitest';
import { stepTitleText } from '../stepTitleText';

describe('#4157 stepTitleText', () => {
  it('⭐ 報告頁只顯示名稱，不帶 N/total', () => {
    expect(stepTitleText({ id: 'report', label: '報告' }, 9, 10, false)).toBe('報告');
  });
  it('⛔ 其他關卡維持「名稱 N/total」', () => {
    expect(stepTitleText({ id: 'full-text-annotate', label: '讀全文-做記號' }, 1, 11, false)).toBe('讀全文-做記號 2/11');
  });
  it('⛔ 工具箱模式只顯示名稱', () => {
    expect(stepTitleText({ id: 'full-text-annotate', label: '讀全文-做記號' }, 1, 11, true)).toBe('讀全文-做記號');
  });
});
