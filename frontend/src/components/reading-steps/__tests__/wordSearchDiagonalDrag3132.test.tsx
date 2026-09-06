/**
 * 語詞複習 — 斜著拖要圈得起來（#3132）
 *
 * 為什麼 #2863 的鎖沒擋住：那支測試驗斜線的方式是**直接呼叫 `getCellsBetween`**，
 * 而學生實際拖曳走的是 `useWordSearchProgress.handleDragMove`，那裡有一份漏掉 45°
 * 的內聯複製（斜的一律 `cells.push(dragStart)`，只留起點）。
 * 工具函式是對的、測試是綠的、功能是壞的 —— 鎖守著一條沒有人走的路。
 *
 * 所以這一支**不碰工具函式**，一律走元件的真實拖曳路徑
 * （mousedown → mousemove → mouseup，經 `resolveCell` / `elementFromPoint`）。
 *
 * 實際災情：教師版字表 30% 的答案是斜的（全庫 1490 條裡 445 條，143 課裡 139 課
 * 至少各有一條），代表幾乎每一課都至少有一個詞圈不起來。
 *
 * ⛔ 四個斜向都要驗。#2863 只驗了 (0,0)→(2,2)（右下），而現場回報壞掉的是
 *    **左下**（仆 在上一列右邊、倒 在下一列左邊）—— 只驗一個斜向仍會漏。
 */
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VocabWordSearch from '../VocabWordSearch';
import type { Story } from '../../../types';

/**
 * 自動生成的字表**永遠不會**放斜線（`wordSearchGrid.ts` 的 `Direction` 型別只有
 * horizontal / vertical），所以這裡餵教師版字表，自己控制斜線位置。
 *
 *        c0   c1   c2   c3
 *   r0   甲   口   口   丙
 *   r1   口   乙   丁   口
 *   r2   戊   己   口   口
 *   r3   口   口   口   口
 *
 *   甲乙 = (0,0)→(1,1)  右下斜；反向拖即左上
 *   丙丁 = (0,3)→(1,2)  左下斜；反向拖即右上   ← 現場回報壞掉的方向
 *   戊己 = (2,0)→(2,1)  水平，正向對照
 */
const story = {
  id: 'L3132D',
  title: '斜線拖曳回歸測試',
  vocabulary: [
    { word: '甲乙', definition: '測試用' },
    { word: '丙丁', definition: '測試用' },
    { word: '戊己', definition: '測試用' },
  ],
  vocabReview: {
    grid: ['甲口口丙', '口乙丁口', '戊己口口', '口口口口'],
    target_words: ['甲乙', '丙丁', '戊己'],
  },
} as unknown as Story;

const CELL = 40;

/** jsdom 沒有版面計算，補上座標→格子的對應（每格 40×40），讓真正的 resolveCell 照常執行。 */
function installLayoutStub() {
  const cellAt = (x: number, y: number) =>
    document.querySelector(
      `[data-row="${Math.floor(y / CELL)}"][data-col="${Math.floor(x / CELL)}"]`,
    );
  document.elementFromPoint = ((x: number, y: number) => cellAt(x, y)) as typeof document.elementFromPoint;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const r = Number(this.getAttribute('data-row'));
    const c = Number(this.getAttribute('data-col'));
    const left = Number.isNaN(c) ? 0 : c * CELL;
    const top = Number.isNaN(r) ? 0 : r * CELL;
    return { x: left, y: top, left, top, right: left + CELL, bottom: top + CELL,
      width: CELL, height: CELL, toJSON: () => ({}) } as DOMRect;
  };
}

/** 送出一次拖曳（每個事件各自一個 render cycle，跟真人拖曳一樣）。 */
function dragOver(from: { r: number; c: number }, to: { r: number; c: number }) {
  const gridEl = document.querySelector('[role="grid"]');
  if (!gridEl) throw new Error('找不到字母格 — 測試沒真的圈到詞');
  const pt = (p: { r: number; c: number }) => ({
    clientX: p.c * CELL + CELL / 2,
    clientY: p.r * CELL + CELL / 2,
  });
  const fire = (type: string, p: { r: number; c: number }) =>
    act(() => {
      gridEl.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, buttons: 1, ...pt(p) }),
      );
    });
  fire('mousedown', from);
  fire('mousemove', to);
  fire('mouseup', to);
}

/** 最後一次回報裡「找到的詞」。 */
function foundWords(spy: ReturnType<typeof vi.fn>): string[] {
  if (spy.mock.calls.length === 0) return [];
  const p = spy.mock.calls[spy.mock.calls.length - 1][0] as { foundWords?: unknown };
  return Array.isArray(p?.foundWords) ? (p.foundWords as string[]) : [];
}

/** 開一份乾淨的畫面，拖一次，回報找到了什麼。 */
function dragOnFreshBoard(from: { r: number; c: number }, to: { r: number; c: number }): string[] {
  localStorage.clear();
  const onProgressChange = vi.fn();
  const { unmount } = render(
    <VocabWordSearch story={story} onFinish={vi.fn()} onProgressChange={onProgressChange} />,
  );
  // 前提自檢：字表要真的是我們餵進去的那張，不然下面驗的是別的東西
  const firstCell = document.querySelector('[data-row="0"][data-col="0"]');
  expect(firstCell?.textContent?.trim(), '教師版字表沒有被採用').toBe('甲');

  dragOver(from, to);
  const found = foundWords(onProgressChange);
  unmount();
  return found;
}

const realRect = Element.prototype.getBoundingClientRect;
const realFromPoint = document.elementFromPoint;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  installLayoutStub();
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
  document.elementFromPoint = realFromPoint;
});

describe('#3132 語詞複習：斜著拖要圈得起來', () => {
  it('正向對照 — 水平的詞圈得起來（這條垮了，下面全部沒有意義）', () => {
    expect(dragOnFreshBoard({ r: 2, c: 0 }, { r: 2, c: 1 })).toContain('戊己');
  });

  it('右下斜：甲(0,0) → 乙(1,1)', () => {
    expect(dragOnFreshBoard({ r: 0, c: 0 }, { r: 1, c: 1 })).toContain('甲乙');
  });

  it('左上斜：乙(1,1) → 甲(0,0)（同一個詞反向拖）', () => {
    expect(dragOnFreshBoard({ r: 1, c: 1 }, { r: 0, c: 0 })).toContain('甲乙');
  });

  it('左下斜：丙(0,3) → 丁(1,2) —— 現場回報「仆倒」壞掉的就是這個方向', () => {
    expect(dragOnFreshBoard({ r: 0, c: 3 }, { r: 1, c: 2 })).toContain('丙丁');
  });

  it('右上斜：丁(1,2) → 丙(0,3)（同一個詞反向拖）', () => {
    expect(dragOnFreshBoard({ r: 1, c: 2 }, { r: 0, c: 3 })).toContain('丙丁');
  });

  it('負向對照 — 既非直線也非 45° 的亂拖不算數', () => {
    // (0,0)→(1,3)：dr=1, dc=3。放寬成「任意兩點連線」會讓學生亂拖也中。
    expect(dragOnFreshBoard({ r: 0, c: 0 }, { r: 1, c: 3 })).toEqual([]);
  });
});
