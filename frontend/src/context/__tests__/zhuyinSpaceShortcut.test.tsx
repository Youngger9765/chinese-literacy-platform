/**
 * PRD 寫「Space 切換注音」，切換本體（`toggleZhuyin`，none→difficult→all 循環）
 * 早就有了，但**沒有任何地方綁鍵**（#2787 第 4 條）。
 *
 * ⚠️ 全域綁 Space 有危險：Space 同時是「捲頁」與「觸發焦點按鈕」，
 * 而造句練習那類步驟有自由輸入框 —— 沒有防護的話學生打不出空白。
 * 所以這裡連防護一起鎖住，不只鎖「有沒有綁」。
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ZhuyinProvider, useZhuyin } from '../ZhuyinContext';

const Probe: React.FC = () => {
  const { zhuyinMode } = useZhuyin();
  return (
    <div>
      <span data-testid="mode">{zhuyinMode}</span>
      <input data-testid="field" />
      <textarea data-testid="area" />
    </div>
  );
};

function press(target: EventTarget, key = ' ', init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  });
}

const mode = () => screen.getByTestId('mode').textContent;

describe('Space 切換注音', () => {
  it('按 Space 會切換注音模式', () => {
    render(<ZhuyinProvider><Probe /></ZhuyinProvider>);
    const first = mode();
    press(document.body);
    expect(mode(), 'Space 沒有切換注音模式').not.toBe(first);
  });

  it('循環三個模式後回到原點（正向對照：不是隨便亂跳）', () => {
    render(<ZhuyinProvider><Probe /></ZhuyinProvider>);
    const start = mode();
    const seen = new Set([start]);
    for (let i = 0; i < 3; i++) { press(document.body); seen.add(mode()!); }
    expect(seen.size, `只看到 ${seen.size} 種模式：${[...seen]}`).toBe(3);
    expect(mode()).toBe(start);
  });

  it('游標在輸入框裡時不可以攔截 Space —— 學生要打得出空白', () => {
    render(<ZhuyinProvider><Probe /></ZhuyinProvider>);
    const field = screen.getByTestId('field');
    field.focus();
    const before = mode();
    press(field);
    expect(mode(), 'Space 在輸入框裡被攔截了，學生打不出空白').toBe(before);
  });

  it('游標在 textarea 裡時同樣不攔截', () => {
    render(<ZhuyinProvider><Probe /></ZhuyinProvider>);
    const area = screen.getByTestId('area');
    area.focus();
    const before = mode();
    press(area);
    expect(mode()).toBe(before);
  });

  // ⚠️ 每按一次就要斷言一次。三個修飾鍵連按三下，若防護不存在會剛好循環一圈
  // 回到原點 —— 最後才斷言的話這條永遠是綠的（實測過：拿掉防護仍 6 passed）。
  it.each([['ctrlKey'], ['metaKey'], ['altKey']])('帶 %s 的 Space 不算', (mod) => {
    render(<ZhuyinProvider><Probe /></ZhuyinProvider>);
    const before = mode();
    press(document.body, ' ', { [mod]: true } as KeyboardEventInit);
    expect(mode(), `${mod}+Space 不該切換注音`).toBe(before);
  });

  it('其他鍵不會誤觸（負向對照）', () => {
    render(<ZhuyinProvider><Probe /></ZhuyinProvider>);
    const before = mode();
    press(document.body, 'a');
    press(document.body, 'Enter');
    expect(mode()).toBe(before);
  });
});
