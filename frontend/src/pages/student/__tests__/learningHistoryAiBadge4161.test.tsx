/**
 * #4161：學習紀錄裡從 AI 派發進來的練習要標「AI 派發」。
 * 真的把 SessionCard 所在的頁面畫出來要接認證與兩支請求，這裡改驗頁面程式：
 * 標籤只在 entry_source 是 ai_dispatch 時出現，而且畫在課文紀錄卡（不是練習工具箱卡）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'LearningHistoryPage.tsx'), 'utf-8');
const cardStart = SRC.indexOf('const SessionCard');
const toolboxStart = SRC.indexOf('const ToolboxSessionCard');

describe('#4161 學習紀錄的「AI 派發」標籤', () => {
  it('有 entry_source 判斷與標籤文字', () => {
    expect(SRC).toContain("session.entry_source === 'ai_dispatch'");
    expect(SRC).toContain('data-testid="ai-dispatch-badge"');
    expect(SRC).toContain('AI 派發');
  });

  it('標籤在課文紀錄卡裡，不在練習工具箱卡裡', () => {
    const at = SRC.indexOf('data-testid="ai-dispatch-badge"');
    expect(cardStart).toBeGreaterThan(-1);
    expect(toolboxStart).toBeGreaterThan(cardStart);
    expect(at).toBeGreaterThan(cardStart);
    expect(at).toBeLessThan(toolboxStart);
  });

  it('標籤只有一處，沒有複製到別的卡', () => {
    expect(SRC.split('data-testid="ai-dispatch-badge"').length - 1).toBe(1);
  });
});
