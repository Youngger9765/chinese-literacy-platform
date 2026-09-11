/**
 * 每段段號旁的喇叭（#3141）— 讀全文-做記號
 *
 * Owner: 「在每一段的開頭數字旁邊加一個喇叭，點下去就會播放該段落的語音」.
 *
 * 這一支驗行為契約，不驗實作：
 *   - 每一段都有自己的喇叭，且點下去播的是**那一段**（#2627 的失敗形狀：
 *     傳死的 0 會讓每顆喇叭都唸第 1 段，而且不會報錯）
 *   - 喇叭活在 [data-para-idx] 子樹**外面** —— 這是位置性的正確，不是美觀：
 *     在裡面它的 markup 會撐大 annotation 存的字元位移，而在標記模式下它會落進
 *     charAtPoint 解析用的 [data-ci] 字元格裡（#3134/#3135）
 *   - 正在唸的那一段再點一次是「停」，不是從頭重播
 *   - 未登入的 QR 訪客也要有（#2649：不能標記，但要能聽）
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import FullTextAnnotate from '../FullTextAnnotate';
import type { Story } from '../../../types';

vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    isZhuyinAny: false,
    zhuyinActive: false,
    processLinesSelective: (lines: string[]) => lines,
  }),
}));

const playOne = vi.fn();
const stop = vi.fn();
const play = vi.fn();
// Which paragraph the reader reports as current — the same field that drives
// the existing highlight and scroll-into-view, so the button rides on it.
let currentParagraphIdx = -1;

vi.mock('../../../hooks/useFullTextTtsQueue', () => ({
  useFullTextTtsQueue: () => ({
    get currentParagraphIdx() { return currentParagraphIdx; },
    isPlaying: currentParagraphIdx >= 0,
    isPaused: false,
    isLoading: false,
    ttsError: null,
    isTtsDegraded: false,
    play, playOne, pause: vi.fn(), resume: vi.fn(), stop,
  }),
}));

const PARAS = [
  '第一段：老爺爺左顧右盼，可惜已經滿座。',
  '第二段：小男孩站起來，把位子讓給他。',
  '第三段：車廂裡響起一陣掌聲。',
];

const story = {
  id: 'L3141',
  title: '讓座',
  content: PARAS,
  vocabulary: [],
} as unknown as Story;

function renderStep(props: Record<string, unknown> = {}) {
  return render(
    <FullTextAnnotate story={story} onFinish={vi.fn()} {...props} />
  );
}

beforeEach(() => {
  // jsdom has no layout, so no scrollIntoView. FullTextAnnotate calls it to
  // follow the paragraph being read — reached only once a paragraph is active.
  Element.prototype.scrollIntoView = vi.fn();
  playOne.mockClear();
  stop.mockClear();
  play.mockClear();
  currentParagraphIdx = -1;
});

describe('每段段號旁的喇叭 (#3141)', () => {
  it('每一段都有一顆，標示的是那一段的段號', () => {
    renderStep();
    PARAS.forEach((_, i) => {
      expect(screen.getByLabelText(`朗讀第 ${i + 1} 段`)).toBeTruthy();
    });
  });

  it('點第 N 段的喇叭，播的是第 N 段 —— 不是寫死的第 1 段 (#2627 同型)', () => {
    renderStep();

    fireEvent.click(screen.getByLabelText('朗讀第 2 段'));
    expect(playOne).toHaveBeenCalledWith(1);

    playOne.mockClear();
    fireEvent.click(screen.getByLabelText('朗讀第 3 段'));
    expect(playOne).toHaveBeenCalledWith(2);
  });

  it('喇叭不在 [data-para-idx] 子樹裡 —— 否則做記號會標到錯的字', () => {
    // 位移污染的回歸鎖。段號本來就因為這個理由住在外面
    // （FullTextAnnotate 的註解），喇叭有 markup，更不能進去。
    const { container } = renderStep();

    container.querySelectorAll('[data-para-idx]').forEach((para) => {
      expect(para.querySelector('[data-testid^="paragraph-speaker-"]')).toBeNull();
    });
    // 正向對照：它確實被畫出來了（否則上面那條空集合也會過）。
    expect(container.querySelectorAll('[data-testid^="paragraph-speaker-"]').length)
      .toBe(PARAS.length);
  });

  it('喇叭不是字元格 —— 標記模式的 charAtPoint 靠 closest([data-ci]) 解析點擊', () => {
    // 這條成立，點喇叭就不可能留下假記號：charAtPoint 回 null，
    // handleMarkEnd 的 `if (!start) return` 直接早退（#3134/#3135）。
    const { container } = renderStep();

    container.querySelectorAll('[data-testid^="paragraph-speaker-"]').forEach((btn) => {
      expect(btn.closest('[data-ci]')).toBeNull();
    });
  });

  it('正在唸的那一段，再點一次是「停」，不是從頭重播', () => {
    currentParagraphIdx = 1;
    renderStep();

    fireEvent.click(screen.getByLabelText('停止朗讀第 2 段'));
    expect(stop).toHaveBeenCalled();
    expect(playOne).not.toHaveBeenCalled();

    // 別段仍然是「播」，不是「停」。
    fireEvent.click(screen.getByLabelText('朗讀第 3 段'));
    expect(playOne).toHaveBeenCalledWith(2);
  });

  it('未登入的 QR 訪客也有喇叭（#2649：不能標記，但要能聽）', () => {
    renderStep({ hideAnnotation: true });

    expect(screen.getByLabelText('朗讀第 1 段')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('朗讀第 1 段'));
    expect(playOne).toHaveBeenCalledWith(0);
  });
});
