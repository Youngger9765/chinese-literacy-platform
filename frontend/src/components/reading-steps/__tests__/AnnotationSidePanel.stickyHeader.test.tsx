/**
 * 「我的記號」面板的捲動分層（#3134 版面回饋）
 *
 * 版面本身（sticky、底部留白高度）在 jsdom 裡看不出來 —— 沒有版面計算。
 * 但底下這件事是**結構**不是樣式，而且壞掉的話學生會完全按不到記號：
 *
 *   aside 是 overflow-hidden（標題才不會跟著捲走）
 *   → 所以「會捲動的那一層」必須是清單自己
 *   → 一旦有人把清單的 overflow-y-auto 拿掉，記號超過一頁就再也捲不到
 *
 * 這一支只釘這條分層：標題在捲動層**外面**，記號在捲動層**裡面**。
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import AnnotationSidePanel from '../AnnotationSidePanel';
import type { AnnotationSummary } from '../annotationReducer';

const summary = { totalMarks: 2, unknown: 1, important: 1 } as unknown as AnnotationSummary;

const annotationsForPanel = [
  { annotation: { id: 'a1', type: 'unknown' }, text: '左顧右盼' },
  { annotation: { id: 'a2', type: 'important' }, text: '滿座' },
] as unknown as React.ComponentProps<typeof AnnotationSidePanel>['annotationsForPanel'];

const renderPanel = () =>
  render(
    <AnnotationSidePanel
      summary={summary}
      annotationsForPanel={annotationsForPanel}
      onJump={vi.fn()}
    />,
  );

describe('我的記號面板：標題固定、清單可捲', () => {
  it('記號清單本身是會捲動的那一層', () => {
    renderPanel();
    const scroller = screen.getByTestId('annotation-list-scroll');
    // aside 已經 overflow-hidden，捲動只可能發生在這裡
    expect(scroller.className).toContain('overflow-y-auto');
    // 每一個記號都在捲動層裡面，才捲得到
    for (const text of ['左顧右盼', '滿座']) {
      expect(scroller.contains(screen.getByText(text))).toBe(true);
    }
  });

  it('「我的記號」與標記總數在捲動層外面，不會被捲走', () => {
    renderPanel();
    const scroller = screen.getByTestId('annotation-list-scroll');
    const heading = screen.getByRole('heading', { name: '我的記號' });
    expect(scroller.contains(heading)).toBe(false);
    // 總數跟標題同一塊，一起留在上面
    expect(scroller.contains(screen.getByText('2'))).toBe(false);
  });
});
