/**
 * #3397（第二階段）— owner 追加需求：播放全文／速度再搬進跟 QR 全文同一條
 * 工具列（❓不懂／💛重要／復原／清除全部／QR 全文）。那條列已經擠了五顆，
 * 慢/稍慢/正常三顆攤開會把 390px 寬逼到換行甚至溢出。`compact` 把速度收成
 * 一顆按鈕，點開才展開。
 *
 * 預設（不傳 `compact`）必須跟改動前一模一樣 —— KeyPassageReadingControls
 * 與既有單測（phoneControlBar.test.tsx／ttsSpeedControl3023.test.tsx）都是
 * 裸用 `<TtsSpeedPicker />`，不該被這次改動動到。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import TtsSpeedPicker from '../TtsSpeedPicker';
import { getTtsPlaybackRate, DEFAULT_TTS_RATE, TTS_RATE_OPTIONS } from '../../../utils/ttsRate';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('#3397 TtsSpeedPicker compact mode', () => {
  it('default (non-compact) usage is unaffected — still a group of 3 buttons', () => {
    render(<TtsSpeedPicker />);
    expect(screen.getByRole('group', { name: '朗讀速度' })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(TTS_RATE_OPTIONS.length);
  });

  it('compact mode starts as a single toggle button, not the full trio', () => {
    render(<TtsSpeedPicker compact />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('group', { name: '朗讀速度' })).toBeNull();
  });

  it('the toggle shows the current rate label so a glance tells you the speed', () => {
    render(<TtsSpeedPicker compact />);
    const current = TTS_RATE_OPTIONS.find((o) => o.value === DEFAULT_TTS_RATE)!;
    const toggle = screen.getByRole('button', { name: '朗讀速度' });
    expect(toggle.textContent).toContain(current.label);
  });

  it('clicking the toggle expands all rate options', () => {
    render(<TtsSpeedPicker compact />);
    fireEvent.click(screen.getByRole('button', { name: '朗讀速度' }));
    for (const opt of TTS_RATE_OPTIONS) {
      expect(
        screen.getByRole('button', { name: `朗讀速度 ${opt.label}` }),
        `missing ${opt.label}`,
      ).toBeTruthy();
    }
  });

  it('picking a rate persists it and collapses back to one button', () => {
    render(<TtsSpeedPicker compact />);
    fireEvent.click(screen.getByRole('button', { name: '朗讀速度' }));
    const slow = TTS_RATE_OPTIONS.find((o) => o.value < DEFAULT_TTS_RATE)!;
    fireEvent.click(screen.getByRole('button', { name: `朗讀速度 ${slow.label}` }));

    expect(getTtsPlaybackRate()).toBe(slow.value);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '朗讀速度' }).textContent).toContain(slow.label);
  });

  it('the collapse (X) button inside the expanded panel also closes it without changing the rate', () => {
    render(<TtsSpeedPicker compact />);
    fireEvent.click(screen.getByRole('button', { name: '朗讀速度' }));
    const before = getTtsPlaybackRate();
    fireEvent.click(screen.getByRole('button', { name: '收起朗讀速度選單' }));
    expect(getTtsPlaybackRate()).toBe(before);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
