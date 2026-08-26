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

function renderStep(hideAnnotation: boolean) {
  return render(<ReadingAnnotation story={story} onFinish={vi.fn()} hideAnnotation={hideAnnotation} />);
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

  it('keeps the player — a visitor who cannot annotate can still listen', () => {
    // This is the regression that produced two audio sources. Hiding the
    // annotations used to hide the player too, so the guest page grew its own
    // pre-generated mp3, and within days it no longer matched what a signed-in
    // student heard. Owner: 「全文朗讀的登錄的前後那個用的音怎麼不一樣啊」.
    renderStep(true);
    expect(screen.getByTestId('reading-player')).toBeInTheDocument();
  });

  it('keeps the player out of the bottom action bar', () => {
    // #2941 搬的是登入學生那顆。訪客頁（GuestReadingPage）沒有底部
    // StepFooterNav，固定動作列會浮在半空中，而且訪客沒有「完成標記」
    // 可以並排 —— 所以訪客的播放控制留在文章上方。
    renderStep(true);
    expect(screen.queryByTestId('step-action-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('reading-player')).toBeInTheDocument();
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

  it('puts 播放全文 next to 完成標記 in the bottom action bar (#2941)', () => {
    // 放在文章上方時，學生一往下讀就把播放鍵捲出畫面；「完成標記」在底部那條
    // 固定列上永遠看得到，所以兩顆並排在那裡。斷言「同一條列裡」而不是
    // 「頁面上有」—— 後者原本就成立，改壞了也不會紅。
    renderStep(false);
    const bar = screen.getByTestId('step-action-bar');
    expect(bar).toContainElement(screen.getByTestId('reading-player'));
    expect(bar).toContainElement(screen.getByText('完成標記'));
    // 只有一顆，沒有連舊位置一起留下來
    expect(screen.getAllByTestId('reading-player')).toHaveLength(1);
  });
});
