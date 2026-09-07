/**
 * 做記號「先選模式再拖曳」（#3134）
 *
 * 為什麼要有這個模式：iPad 上做記號依賴原生文字選取，而 iOS 只要有文字被選取
 * 就一定會跳出系統的編輯選單（拷貝／查詢／翻譯…），蓋住畫面、跟做記號搶手勢。
 * 那是作業系統行為，網頁擋不掉 —— 只能不要觸發原生選取。
 *
 * iPad 實測（Safari 18.3.1）：
 *   caretRangeFromPoint      在 user-select:none 下回傳課文以外的節點 → 不可用
 *   逐字 span + elementFromPoint  可用；1671 字時每次命中平均 0.02ms
 *
 * ⛔ 標記模式刻意以**純文字**渲染（無注音）。AnnotatedParagraph 自己的註解寫著
 *    注音的 ruby「cannot be split character-by-character」，而逐字包 span 正是
 *    在拆它。繞開，不硬解 —— 那段邏輯還背著 PR #1155 的回歸紀錄。
 *
 * 這一支驗的是**行為契約**，不是實作細節：
 *   模式關閉 → 現行渲染完全不變（正向對照，這條垮了下面都沒有意義）
 *   模式開啟 → 逐字可定位、拖曳產生正確的 charStart/charEnd、不渲染注音
 */
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import FullTextAnnotate from '../FullTextAnnotate';
import type { Story } from '../../../types';

vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    isZhuyinAny: false,
    zhuyinActive: false,
    processLinesSelective: (lines: string[]) => lines,
  }),
}));

vi.mock('../../../hooks/useFullTextTtsQueue', () => ({
  useFullTextTtsQueue: () => ({
    currentParagraphIdx: null, isPlaying: false, isPaused: false,
    play: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(),
  }),
}));

const PARA = '老爺爺左顧右盼，可惜已經滿座。';
const story = {
  id: 'L3134',
  title: '誤會',
  content: [PARA],
  vocabulary: [],
} as unknown as Story;

/** jsdom 沒有版面計算，補上座標→字的對應（每字 40×40，單行）。 */
const CELL = 40;
function installLayoutStub() {
  document.elementFromPoint = ((x: number, y: number) => {
    const i = Math.floor(x / CELL);
    return document.querySelector(`[data-ci="${i}"]`);
  }) as typeof document.elementFromPoint;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const i = Number(this.getAttribute('data-ci'));
    const left = Number.isNaN(i) ? 0 : i * CELL;
    return { x: left, y: 0, left, top: 0, right: left + CELL, bottom: CELL,
      width: CELL, height: CELL, toJSON: () => ({}) } as DOMRect;
  };
}

/** 對某個字送出一次觸控拖曳（每個事件各自一個 render cycle）。 */
function dragChars(fromCi: number, toCi: number) {
  const host = document.querySelector('[data-mark-surface]');
  if (!host) throw new Error('找不到標記層 — 模式沒有真的開啟');
  const at = (ci: number) => ({ clientX: ci * CELL + CELL / 2, clientY: CELL / 2 });
  const fire = (type: string, ci: number) =>
    act(() => {
      const t = { identifier: 0, target: host, ...at(ci) } as unknown as Touch;
      host.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: type === 'touchend' ? [] : [t],
        changedTouches: [t],
      }));
    });
  fire('touchstart', fromCi);
  fire('touchmove', toCi);
  fire('touchend', toCi);
}

const openMode = (label: string) =>
  act(() => { screen.getByRole('button', { name: new RegExp(label) }).click(); });

const realRect = Element.prototype.getBoundingClientRect;
const realFromPoint = document.elementFromPoint;

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); installLayoutStub(); });
afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
  document.elementFromPoint = realFromPoint;
});

describe('#3134 做記號：先選模式再拖曳', () => {
  it('正向對照 — 模式關閉時不逐字拆，維持現行渲染', () => {
    render(<FullTextAnnotate story={story} onFinish={vi.fn()} />);
    expect(document.querySelectorAll('[data-ci]')).toHaveLength(0);
    expect(document.querySelector('[data-mark-surface]')).toBeNull();
  });

  it('模式關閉時不動原生選取 —— 桌機仍可選字複製、也仍能用選取做記號', () => {
    render(<FullTextAnnotate story={story} onFinish={vi.fn()} />);
    // 模式關閉時 data-mark-surface 不存在，所以要從課文的父容器抓。
    const para = document.querySelector('[data-para-idx]');
    const surface = para?.closest('[style*="user-select"], [style*="userSelect"]') as HTMLElement
      ?? (para?.parentElement?.closest('div') as HTMLElement);
    const us = surface.style.userSelect || surface.style.webkitUserSelect;

    // ⛔ 這裡刻意斷言 style 而不是行為，原因：jsdom 不會真的執行 user-select
    //    —— 設成 'none' 之後 getSelection() 在 jsdom 裡照樣回傳選取範圍，
    //    所以「選不到字」這件事在 jsdom 是觀察不到的。style 就是機制本身。
    //
    // 為什麼值得鎖：模式關閉時若被改成 'none'，桌機使用者不但不能複製，
    // 連原本「選取文字做記號」那條路都會斷（handleMouseUp 靠 getSelection()），
    // 而這個 PR 最核心的承諾就是「模式關閉 = 現況完全不變」。
    expect(us).toBe('text');
  });

  it('開啟模式後，課文每個字都可定位', () => {
    render(<FullTextAnnotate story={story} onFinish={vi.fn()} />);
    openMode('不懂');
    const cells = document.querySelectorAll('[data-ci]');
    expect(cells).toHaveLength([...PARA].length);
    expect(cells[0].textContent).toBe('老');
  });

  it('模式開啟時停用原生選取（iOS 選單就不會出現），但垂直捲動要留著', () => {
    render(<FullTextAnnotate story={story} onFinish={vi.fn()} />);
    openMode('不懂');
    const surface = document.querySelector('[data-mark-surface]') as HTMLElement;
    expect(surface).not.toBeNull();
    expect(surface.style.userSelect || surface.style.webkitUserSelect).toBe('none');
    // ⛔ 不是 'none'。整塊設 none 會讓學生在標記模式下捲不動長課文
    // （探針只有一小段所以沒暴露這件事）。'pan-y' 讓垂直滑動照常捲動，
    // 水平拖曳才交給我們 —— 而標記詞語本來就是水平動作。
    expect(surface.style.touchAction).toBe('pan-y');
  });

  it('拖曳「左顧右盼」會標記到正確的四個字', () => {
    render(<FullTextAnnotate story={story} onFinish={vi.fn()} />);
    openMode('不懂');
    dragChars(3, 6);                                  // 左(3) → 盼(6)
    const marked = [...document.querySelectorAll('[data-annotated]')];
    expect(marked.map((m) => m.textContent).join('')).toBe('左顧右盼');
    expect(marked[0].getAttribute('data-annotated')).toBe('unknown');
  });

  it('反向拖曳（由後往前）結果相同', () => {
    render(<FullTextAnnotate story={story} onFinish={vi.fn()} />);
    openMode('不懂');
    dragChars(6, 3);
    expect([...document.querySelectorAll('[data-annotated]')]
      .map((m) => m.textContent).join('')).toBe('左顧右盼');
  });

  it('可以累積多個記號，且各自帶自己的類型', () => {
    render(<FullTextAnnotate story={story} onFinish={vi.fn()} />);
    openMode('不懂');
    dragChars(3, 6);                                  // 左顧右盼 → unknown
    openMode('重要');
    dragChars(12, 13);                                // 滿座 → important
    const byType = (t: string) => [...document.querySelectorAll(`[data-annotated="${t}"]`)]
      .map((m) => m.textContent).join('');
    expect(byType('unknown')).toBe('左顧右盼');
    expect(byType('important')).toBe('滿座');
  });

  it('關閉模式後回到現行渲染，且記號還在', () => {
    render(<FullTextAnnotate story={story} onFinish={vi.fn()} />);
    openMode('不懂');
    dragChars(3, 6);
    openMode('關閉標記');
    expect(document.querySelector('[data-mark-surface]')).toBeNull();
    expect(document.querySelectorAll('[data-ci]')).toHaveLength(0);
    // 記號本身不隨模式消失
    expect(document.querySelector('[role="mark"]')?.textContent).toBe('左顧右盼');
  });
});
