/**
 * #3397 — 播放全文搬到標題下方之後，播放中往下讀時暫停／停止必須還按得到。
 * 標題下那顆捲出畫面（IntersectionObserver 回報 not intersecting）且正在播，
 * 右下角才浮出迷你播放器；閒置時不出現。
 */
import { act, render, screen } from '@testing-library/react';
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
vi.mock('../../../hooks/useFullTextTtsQueue', () => ({
  useFullTextTtsQueue: () => ({
    currentParagraphIdx: null,
    ...readerState,
    play: vi.fn(), playOne: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(),
  }),
}));

const story = {
  id: '1', title: '贏得喝采的輸家', level: 4, grade: 4,
  content: ['第一段的內容。'], category: 'story', vocabulary: [], images: [],
} as unknown as Story;

let ioCallback: IntersectionObserverCallback | null = null;
function scrollInlinePlayerOut() {
  act(() => {
    ioCallback?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
  });
}

beforeEach(() => {
  ioCallback = null;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: IntersectionObserverCallback) { ioCallback = cb; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  readerState.isPlaying = false;
  readerState.isPaused = false;
});

describe('FullTextAnnotate floating mini player (#3397)', () => {
  it('appears when playing and the inline player is scrolled away', () => {
    readerState.isPlaying = true;
    render(<ReadingAnnotation story={story} onFinish={vi.fn()} />);
    expect(screen.queryByTestId('floating-reading-player')).not.toBeInTheDocument();
    scrollInlinePlayerOut();
    const floating = screen.getByTestId('floating-reading-player');
    expect(floating).toHaveTextContent('暫停');
    expect(floating).toHaveTextContent('停止');
  });

  it('stays hidden while idle even when scrolled away', () => {
    render(<ReadingAnnotation story={story} onFinish={vi.fn()} />);
    scrollInlinePlayerOut();
    expect(screen.queryByTestId('floating-reading-player')).not.toBeInTheDocument();
  });
});
