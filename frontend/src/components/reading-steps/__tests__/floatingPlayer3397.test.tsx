/**
 * #3397 — pause/stop must stay reachable while playing, no matter how far
 * the student has scrolled.
 *
 * History of this guarantee (same requirement, two different mechanisms):
 *   1. First pass (#3398): 播放全文 moved under the title, so a separate
 *      IntersectionObserver watched that inline player and popped a floating
 *      mini player into the bottom-right corner only once it scrolled out of
 *      view — `floating-reading-player`, built in this very file.
 *   2. Second pass (owner comment on #3397): the player moved again, into
 *      the top toolbar row (❓不懂／💛重要／復原／清除全部／QR 全文) at the
 *      request of the owner. That row is already `sticky top-0` — it was
 *      never going anywhere. The IntersectionObserver, the ref, the "is it
 *      currently off-screen" state, and the floating overlay all became
 *      *redundant* machinery solving a problem the CSS already solves, so
 *      they were deleted rather than kept around as dead code.
 *
 * jsdom has no real layout, so neither version of this test can literally
 * scroll the page. What it CAN lock: the toolbar carries the `sticky`/`top-0`
 * classes that keep it pinned in a real browser, pause/stop render the
 * moment playback starts (no longer gated behind a "scrolled past" trigger
 * at all), and no floating player exists anywhere in the tree to drift out
 * of sync with it.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ReadingAnnotation from '../FullTextAnnotate';
import type { Story } from '../../../types';

vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    isZhuyinAny: false,
    zhuyinActive: false,
    processLinesSelective: (lines: string[]) => lines,
  }),
}));

const readerState = { isPlaying: false, isPaused: false };
const pauseFn = vi.fn();
const stopFn = vi.fn();
vi.mock('../../../hooks/useFullTextTtsQueue', () => ({
  useFullTextTtsQueue: () => ({
    currentParagraphIdx: null,
    ...readerState,
    play: vi.fn(), playOne: vi.fn(), pause: pauseFn, resume: vi.fn(), stop: stopFn,
  }),
}));

const story = {
  id: '1', title: '贏得喝采的輸家', level: 4, grade: 4,
  content: ['第一段的內容。'], category: 'story', vocabulary: [], images: [],
} as unknown as Story;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  readerState.isPlaying = false;
  readerState.isPaused = false;
});

describe('FullTextAnnotate — pause/stop stays reachable while playing (#3397)', () => {
  it('no separate floating player exists — the sticky toolbar is the only control', () => {
    readerState.isPlaying = true;
    render(<ReadingAnnotation story={story} onFinish={vi.fn()} />);
    expect(screen.queryByTestId('floating-reading-player')).not.toBeInTheDocument();
    // Exactly one player, already visible — nothing to wait for or scroll past.
    expect(screen.getAllByTestId('reading-player')).toHaveLength(1);
  });

  it('the control sits in a toolbar that is pinned (sticky top-0), not one that scrolls away', () => {
    readerState.isPlaying = true;
    render(<ReadingAnnotation story={story} onFinish={vi.fn()} />);
    const toolbar = screen.getByTestId('full-text-toolbar');
    expect(toolbar.className).toMatch(/\bsticky\b/);
    expect(toolbar.className).toMatch(/\btop-0\b/);
    expect(toolbar).toContainElement(screen.getByTestId('reading-player'));
  });

  it('暫停 is clickable immediately while playing — no scrolled-out gate to clear first', () => {
    readerState.isPlaying = true;
    render(<ReadingAnnotation story={story} onFinish={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /暫停/ }));
    expect(pauseFn).toHaveBeenCalledTimes(1);
  });

  it('停止 is clickable immediately while paused — same guarantee, the other active state', () => {
    readerState.isPaused = true;
    render(<ReadingAnnotation story={story} onFinish={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /停止/ }));
    expect(stopFn).toHaveBeenCalledTimes(1);
  });

  it('stays hidden while idle — no floating anything, nothing to show', () => {
    render(<ReadingAnnotation story={story} onFinish={vi.fn()} />);
    expect(screen.queryByTestId('floating-reading-player')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /暫停/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /停止/ })).not.toBeInTheDocument();
  });
});
