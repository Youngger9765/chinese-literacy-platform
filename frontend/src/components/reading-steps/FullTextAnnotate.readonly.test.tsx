/**
 * FullTextAnnotate in read-only mode — what a QR-code visitor may and may not do.
 *
 * The rule (#2649): reading and listening are open, anything that writes a mark
 * is not. Marks belong to a user, and a visitor who scanned a paper worksheet
 * has no account yet.
 *
 * The affordances are *removed*, not disabled. A greyed-out 完成標記 button
 * reads as "this is broken"; an absent one reads as "not part of this page".
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import ReadingAnnotation from './FullTextAnnotate';
import type { Story } from '../../types';

vi.mock('../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    isZhuyinAny: false,
    zhuyinActive: false,
    processLinesSelective: (lines: string[]) => lines,
  }),
}));

// The player has its own tests; here we only care whether it is on the page.
vi.mock('../../hooks/useFullTextTtsQueue', () => ({
  useFullTextTtsQueue: () => ({
    currentParagraphIdx: null,
    isPlaying: false,
    isPaused: false,
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
  }),
}));

const story = {
  id: '1',
  title: '贏得喝采的輸家',
  level: 4,
  grade: 4,
  content: ['第一段的內容。', '第二段的內容。'],
  category: 'story',
  vocabulary: [],
  images: [],
} as unknown as Story;

function renderStep(readOnly: boolean) {
  return render(<ReadingAnnotation story={story} onFinish={vi.fn()} readOnly={readOnly} />);
}

describe('FullTextAnnotate — read-only (anonymous QR visitor)', () => {
  it('still shows the whole lesson text', () => {
    renderStep(true);
    expect(screen.getByText(/第一段的內容/)).toBeInTheDocument();
    expect(screen.getByText(/第二段的內容/)).toBeInTheDocument();
  });

  it('hides 完成標記 — it advances a learning flow the visitor is not in', () => {
    renderStep(true);
    expect(screen.queryByText('完成標記')).not.toBeInTheDocument();
  });

  it('hides the 我的記號 side panel', () => {
    renderStep(true);
    expect(screen.queryByText('我的記號')).not.toBeInTheDocument();
  });

  it('hides the coaching that teaches marking', () => {
    renderStep(true);
    // Both the onboarding coach and the persistent hint bar exist only to
    // explain selecting text to annotate.
    expect(screen.queryByText(/畫線|標記|選取/)).not.toBeInTheDocument();
  });

  it('does not mount the in-page player (the guest page supplies its own)', () => {
    renderStep(true);
    expect(screen.queryByTestId('reading-player')).not.toBeInTheDocument();
  });
});

describe('FullTextAnnotate — normal mode (signed-in student)', () => {
  it('keeps 完成標記', () => {
    renderStep(false);
    expect(screen.getByText('完成標記')).toBeInTheDocument();
  });

  it('keeps the 我的記號 side panel', () => {
    renderStep(false);
    expect(screen.getByText('我的記號')).toBeInTheDocument();
  });

  it('mounts the whole-lesson player', () => {
    renderStep(false);
    expect(screen.getByTestId('reading-player')).toBeInTheDocument();
  });
});
