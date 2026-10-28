/**
 * #3397（第二階段）— owner 追加需求：「播放全文」與速度控制再往上收，放進上方
 * 工具列（跟「QR 全文」同一列），底部只留「完成標記」。
 *
 * The first pass (#3398) had already moved it from the bottom action bar to
 * right under the title. This locks the SECOND move: out of the title area,
 * into the sticky top toolbar row, at the same small size as QR 全文, for
 * both the signed-in student and the anonymous QR/guest path.
 */
import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReadingAnnotation from '../FullTextAnnotate';
import type { Story } from '../../../types';

vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    isZhuyinAny: false,
    zhuyinActive: false,
    processZhuyin: (t: string) => t,
    processLinesSelective: (lines: string[]) => lines,
    loadLessonZhuyin: vi.fn(),
  }),
}));

const ttsState: { isPlaying: boolean; isPaused: boolean } = { isPlaying: false, isPaused: false };
const play = vi.fn();
const pauseFn = vi.fn();
const resumeFn = vi.fn();
const stopFn = vi.fn();

vi.mock('../../../hooks/useFullTextTtsQueue', () => ({
  useFullTextTtsQueue: () => ({
    currentParagraphIdx: null,
    isPlaying: ttsState.isPlaying,
    isPaused: ttsState.isPaused,
    isLoading: false,
    isTtsDegraded: false,
    play,
    playOne: vi.fn(),
    pause: pauseFn,
    resume: resumeFn,
    stop: stopFn,
  }),
}));

const story: Story = {
  id: 'toolbar-397',
  title: '工具列播放測試',
  level: 4,
  content: ['第一段課文內容，用來測試播放按鈕搬家。', '第二段課文內容。'],
  category: 'story',
  vocabulary: [],
} as unknown as Story;

function renderStep(hideAnnotation: boolean, sectionSlug: string | null = 'q-397') {
  return render(
    <ReadingAnnotation
      story={story}
      onFinish={vi.fn()}
      hideAnnotation={hideAnnotation}
      sectionSlug={sectionSlug}
    />,
  );
}

describe('#3397 播放全文／速度 移進上方工具列，與 QR 全文並排', () => {
  beforeEach(() => {
    ttsState.isPlaying = false;
    ttsState.isPaused = false;
    vi.clearAllMocks();
  });

  it('(signed-in) 播放全文 lives in the toolbar row, side by side with QR 全文', () => {
    renderStep(false);
    const toolbar = screen.getByTestId('full-text-toolbar');
    expect(within(toolbar).getByTestId('reading-player')).toBeInTheDocument();
    expect(within(toolbar).getByText('QR 全文')).toBeInTheDocument();
  });

  it('(signed-in) 底部動作列只剩完成標記，不再有播放鍵', () => {
    renderStep(false);
    const bar = screen.getByTestId('step-action-bar');
    expect(within(bar).queryByTestId('reading-player')).toBeNull();
    expect(within(bar).getByText('完成標記')).toBeInTheDocument();
  });

  it('只有一顆播放器 —— 沒有殘留在標題下方或右下角的舊版本', () => {
    renderStep(false);
    expect(screen.getAllByTestId('reading-player')).toHaveLength(1);
    expect(screen.queryByTestId('floating-reading-player')).not.toBeInTheDocument();
  });

  it('(guest/QR, hideAnnotation) 仍可在工具列播放', () => {
    renderStep(true);
    const toolbar = screen.getByTestId('full-text-toolbar');
    expect(within(toolbar).getByTestId('reading-player')).toBeInTheDocument();
    expect(screen.getAllByTestId('reading-player')).toHaveLength(1);
  });

  it('工具列裡的播放鍵是小尺寸（跟 QR 全文同級），不是底部那顆大 CTA 尺寸', () => {
    renderStep(false);
    const toolbar = screen.getByTestId('full-text-toolbar');
    const playBtn = within(toolbar).getByText('播放全文').closest('button')!;
    expect(playBtn.className).toContain('h-8');
    expect(playBtn.className).not.toContain('w-44');
    expect(playBtn.className).not.toContain('h-14');
  });

  // 播放中仍能暫停／停止、工具列保持 sticky（捲動後不消失）這條規格，
  // 由 floatingPlayer3397.test.tsx 鎖住 —— 它原本鎖的就是這個保證，
  // #3397 第二階段只是換了實作機制（見該檔開頭的說明），不是不需要了。

  it('速度控制在工具列裡收成一顆按鈕（不是三顆都攤開），避免 390 寬溢出或換兩列', () => {
    renderStep(false);
    const toolbar = screen.getByTestId('full-text-toolbar');
    // only the collapsed toggle, not the full 慢/稍慢/正常 trio
    expect(within(toolbar).queryAllByRole('button', { name: /^朗讀速度 / })).toHaveLength(0);
    expect(within(toolbar).getByRole('button', { name: '朗讀速度' })).toBeInTheDocument();
  });

  it('點開速度按鈕可以選速度，且工具列裡仍然只有這一組選項（不跟著複製）', () => {
    renderStep(false);
    const toolbar = screen.getByTestId('full-text-toolbar');
    fireEvent.click(within(toolbar).getByRole('button', { name: '朗讀速度' }));
    expect(within(toolbar).getByRole('button', { name: '朗讀速度 正常' })).toBeInTheDocument();
  });
});
