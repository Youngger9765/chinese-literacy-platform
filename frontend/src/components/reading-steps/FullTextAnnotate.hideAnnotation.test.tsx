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
    play: vi.fn(), playOne: vi.fn(),
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
    // 訪客頁（GuestReadingPage）沒有底部 StepFooterNav，固定動作列會浮在
    // 半空中 —— 訪客的播放控制跟登入學生一樣在上方工具列裡（#3397）。
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

  it('keeps 播放全文 out of the bottom action bar — only 完成標記 there (#3397)', () => {
    // mentor + owner 追加需求：這一步的主題是「做記號」，底部大顆播放鍵＋速度列
    // 偏離主題；owner 後來再要求把它收進上方工具列，跟 QR 全文同一列。
    // 動作列只留主 CTA。斷言「不在那條列裡」而不是「頁面上有」—— 後者搬回去
    // 也不會紅。
    renderStep(false);
    const bar = screen.getByTestId('step-action-bar');
    expect(bar).toContainElement(screen.getByText('完成標記'));
    expect(bar).not.toContainElement(screen.getByTestId('reading-player'));
    // 只有一顆播放器 —— 沒有殘留的浮動播放器或標題下方舊版本
    expect(screen.getAllByTestId('reading-player')).toHaveLength(1);
    expect(screen.queryByTestId('floating-reading-player')).not.toBeInTheDocument();
  });

  it('播放全文是次要尺寸，不跟完成標記等大（#3397）', () => {
    renderStep(false);
    const play = screen.getByText('播放全文').closest('button')!;
    expect(play.className).toContain('h-8');
    expect(play.className).not.toContain('h-14');
    expect(play.className).not.toContain('w-44');
    // 速度選擇收成一顆小按鈕，不是三顆攤開（#3397 第二階段）
    expect(screen.queryByRole('button', { name: '朗讀速度 慢' })).toBeNull();
    const speedToggle = screen.getByRole('button', { name: '朗讀速度' });
    expect(speedToggle.className).toContain('h-8');
  });

  it('sits in the top toolbar row, side by side with QR 全文 (#3397)', () => {
    renderStep(false);
    const toolbar = screen.getByTestId('full-text-toolbar');
    expect(toolbar).toContainElement(screen.getByTestId('reading-player'));
    // 不再跟著標題：toolbar 是 sticky，標題不是它的容器
    const title = screen.getByRole('heading', { level: 1 });
    expect(title.parentElement).not.toContainElement(screen.getByTestId('reading-player'));
  });
});
