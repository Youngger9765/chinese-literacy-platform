/**
 * 學習流程外殼的「一個畫面高」契約
 *
 * 這一支釘的是 CSS 宣告順序，不是元件行為 —— 因為這個坑的失敗方式是**靜默的**：
 * 寫錯了畫面不會壞、build 不會紅、桌機看起來完全正常，只有 iPad 上底部那條
 * 「第幾步 / 上一步 / 下一步」會被推到摺線以下（2026-09-06 實測回報）。
 *
 * 踩過的那一版：`className="h-screen h-dvh"`。看起來像是「dvh 為主、vh 當
 * fallback」，實際 Tailwind 產出的 CSS 裡 .h-dvh(offset 15021) 排在
 * .h-screen(offset 15129) **之前** → 100vh 反而勝出 → 等於沒改。
 * class 在 HTML 屬性裡的先後不決定勝負，stylesheet 裡的先後才決定。
 *
 * 所以 fallback 只能寫在同一條規則裡，靠宣告順序覆蓋。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '../../..');
const css = readFileSync(join(SRC, 'index.css'), 'utf8');
const appShell = readFileSync(join(SRC, 'components/layout/AppShell.tsx'), 'utf8');

describe('LearningAppShell 的畫面高度', () => {
  it('.h-viewport 先宣告 100vh 再用 100dvh 覆蓋', () => {
    const rule = css.match(/\.h-viewport\s*\{([^}]*)\}/);
    expect(rule, '.h-viewport 不見了 —— 外殼會退回 auto 高度').not.toBeNull();

    const body = rule![1];
    const vh = body.indexOf('100vh');
    const dvh = body.indexOf('100dvh');

    expect(vh, '少了 100vh fallback：Safari < 15.4 會拿不到高度').toBeGreaterThan(-1);
    expect(dvh, '少了 100dvh：iPad 上底部導覽列又會被推到摺線以下').toBeGreaterThan(-1);
    // 100dvh 必須在後面才蓋得過 100vh
    expect(dvh).toBeGreaterThan(vh);
  });

  it('學習外殼用 h-viewport，不是 h-screen', () => {
    // LearningAppShell 是 flex-col、最後一個子元素 StepFooterNav 是 in-flow 的，
    // 所以外殼高度一超過可視範圍，被擠出去的就是底部那條。
    const shell = appShell.match(/className="h-[^"]*flex flex-col bg-surface[^"]*"/);
    expect(shell, '找不到 LearningAppShell 的外層 className').not.toBeNull();
    expect(shell![0]).toContain('h-viewport');
    expect(shell![0]).not.toContain('h-screen');
  });
});
