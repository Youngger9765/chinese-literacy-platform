/**
 * VocabWordSearch.progressPersistence.test.tsx — 語詞複習找到的字要進得了 DB（#2848）
 *
 * 為什麼會漏掉：`useWordSearchProgress` 從頭到尾沒有任何 API import，找到的字只寫
 * localStorage（`wordSearch_progress_<story>`）。`VocabReviewPage` 也沒有拿
 * `saveStepProgressPatch`。整關在完成之前對 DB 完全不存在。
 *
 * 2026-08-21 staging 實測（真瀏覽器，session 1937，課文 20011）：
 *   圈出 2 個詞（localStorage 記到 `["喝采","凝聚力"]`）→ 等 12 秒 →
 *   `/progress` 一次 PUT 都沒有，`step_data` 裡連 `vocab-review` 這個鍵都不存在。
 *   ⚠️ 圈詞是拖曳互動，headless 點不動，這一步的 mousedown/mousemove/mouseup
 *   是用 DOM 事件注入送進去的（座標取自真實 `getBoundingClientRect()`，
 *   走的是元件自己的 `resolveCell` → `elementFromPoint` 那條路）。
 *
 * 斷言用「找到 N 個就要存回 N 個」的數量形式。
 */
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VocabWordSearch from '../VocabWordSearch';
import type { Story } from '../../../types';
import type { WordSearchProgress } from '../useWordSearchProgress';

const story = {
  id: 'L2848R',
  title: '進度保存回歸測試',
  vocabulary: [
    { word: '龍爭虎鬥', definition: '形容激烈競爭' },
    { word: '目不轉睛', definition: '非常專心注視' },
    { word: '落寞', definition: '失落寂寞' },
    { word: '喝采', definition: '大聲叫好' },
    { word: '凝聚力', definition: '讓一群人團結的力量' },
  ],
} as unknown as Story;

/**
 * jsdom 沒有實作版面計算，`document.elementFromPoint` 永遠回 null，元件的
 * `resolveCell` 就永遠解不出格子。這裡把座標→格子的對應補上（每格 40×40），
 * 讓真正的 `resolveCell` / `handleDragStart` / `handleDragEnd` 照常執行 ——
 * 補的是瀏覽器環境的缺口，不是繞過被測邏輯。
 */
const CELL = 40;
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

/** 讀出畫面上的字母格。 */
function readGrid(): string[][] {
  const grid: string[][] = [];
  document.querySelectorAll('[data-row][data-col]').forEach((el) => {
    const r = Number(el.getAttribute('data-row'));
    const c = Number(el.getAttribute('data-col'));
    grid[r] = grid[r] ?? [];
    grid[r][c] = (el.textContent ?? '').trim();
  });
  return grid;
}

/** 在格子裡找出這個詞的起訖座標（只找水平／垂直，含反向）。 */
function locate(grid: string[][], word: string) {
  const n = grid.length;
  const chars = [...word];
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      for (const [dr, dc] of dirs) {
        const endR = r + dr * (chars.length - 1);
        const endC = c + dc * (chars.length - 1);
        if (endR < 0 || endC < 0 || endR >= n || endC >= n) continue;
        if (chars.every((ch, i) => grid[r + dr * i]?.[c + dc * i] === ch)) {
          return { from: { r, c }, to: { r: endR, c: endC } };
        }
      }
    }
  }
  return null;
}

/** 對格子送出一次拖曳（每個事件各自一個 render cycle，跟真人拖曳一樣）。 */
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

/** 最後一次回報的「找到幾個詞」。 */
function foundFromLastCall(spy: ReturnType<typeof vi.fn>): number {
  if (spy.mock.calls.length === 0) return -1;
  const p = spy.mock.calls[spy.mock.calls.length - 1][0] as { foundWords?: unknown[] };
  return Array.isArray(p?.foundWords) ? p.foundWords.length : -1;
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

describe('語詞複習 — 找到的字要進得了 DB（#2848）', () => {
  it('每找到一個詞就回報一次，回報的個數等於已找到的個數', () => {
    const onProgressChange = vi.fn();
    render(<VocabWordSearch story={story} onFinish={vi.fn()} onProgressChange={onProgressChange} />);

    const grid = readGrid();
    expect(grid.length).toBeGreaterThan(0);

    const targets = ['喝采', '落寞', '凝聚力'];
    let found = 0;
    for (const w of targets) {
      const pos = locate(grid, w);
      if (!pos) continue;
      dragOver(pos.from, pos.to);
      found++;
      expect(foundFromLastCall(onProgressChange)).toBe(found);
    }
    // 至少要真的圈到 2 個，否則這條測試什麼都沒證明。
    expect(found).toBeGreaterThanOrEqual(2);
  });

  it('回報的 patch 在還沒全部找完時不可標記完成', () => {
    const onProgressChange = vi.fn();
    render(<VocabWordSearch story={story} onFinish={vi.fn()} onProgressChange={onProgressChange} />);
    const grid = readGrid();
    const pos = locate(grid, '喝采');
    expect(pos).toBeTruthy();
    dragOver(pos!.from, pos!.to);

    const last = onProgressChange.mock.calls[onProgressChange.mock.calls.length - 1][0] as {
      completed?: boolean;
    };
    expect(last.completed).not.toBe(true);
  });

  it('重新掛載時要從 DB 快照還原已找到的詞（存了讀不回來等於沒存）', () => {
    const onProgressChange = vi.fn();
    const { unmount } = render(
      <VocabWordSearch story={story} onFinish={vi.fn()} onProgressChange={onProgressChange} />,
    );
    const grid = readGrid();
    const targets = ['喝采', '落寞'].map((w) => locate(grid, w)).filter(Boolean);
    expect(targets.length).toBe(2);
    targets.forEach((p) => dragOver(p!.from, p!.to));

    const saved = onProgressChange.mock.calls[
      onProgressChange.mock.calls.length - 1
    ][0] as WordSearchProgress;
    expect(saved.foundWords).toHaveLength(2);

    unmount();
    localStorage.clear(); // 只走 DB 那條路

    const after = vi.fn();
    render(
      <VocabWordSearch
        story={story}
        onFinish={vi.fn()}
        initialProgress={saved}
        onProgressChange={after}
      />,
    );
    // 還原之後再圈第 3 個 → 回報必須是 3，不是 1。
    const grid2 = readGrid();
    const third = locate(grid2, '凝聚力');
    expect(third).toBeTruthy();
    dragOver(third!.from, third!.to);
    expect(foundFromLastCall(after)).toBe(3);
  });
});
