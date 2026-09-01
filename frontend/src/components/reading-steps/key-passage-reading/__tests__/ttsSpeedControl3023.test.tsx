/**
 * #3023 — the speed control has to be reachable from the reading step, next
 * to the AI 朗讀 button, and it has to persist.
 *
 * A control that exists in a settings page the student never opens is the
 * same as no control: the teacher's report was about the reading step.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import KeyPassageReadingControls from '../KeyPassageReadingControls';
import { getTtsPlaybackRate, DEFAULT_TTS_RATE, TTS_RATE_OPTIONS } from '../../../../utils/ttsRate';

const noop = () => {};
const baseProps = {
  onSpeak: noop,
  onStartSession: noop,
  onSubmit: noop,
  onCancel: noop,
  onStopTts: noop,
  onPauseTts: noop,
  onResumeTts: noop,
  onRetry: noop,
  onFinish: noop,
  isTtsPaused: false,
  sessionTranscriptReady: false,
  recordingSecs: 0,
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('#3023 speed control in the reading step', () => {
  it('offers every rate option beside the AI 朗讀 button when idle', () => {
    render(<KeyPassageReadingControls state="idle" {...baseProps} />);
    expect(screen.getByRole('button', { name: /AI 朗讀/ })).toBeTruthy();
    for (const opt of TTS_RATE_OPTIONS) {
      expect(
        screen.getByRole('button', { name: `朗讀速度 ${opt.label}` }),
        `missing speed option ${opt.label}`,
      ).toBeTruthy();
    }
  });

  it('persists the chosen rate so the next lesson keeps it', () => {
    render(<KeyPassageReadingControls state="idle" {...baseProps} />);
    const slow = TTS_RATE_OPTIONS.find((o) => o.value < DEFAULT_TTS_RATE)!;
    fireEvent.click(screen.getByRole('button', { name: `朗讀速度 ${slow.label}` }));
    expect(getTtsPlaybackRate()).toBe(slow.value);
  });

  it('marks the active option with aria-pressed so it is not colour-only', () => {
    render(<KeyPassageReadingControls state="idle" {...baseProps} />);
    const current = TTS_RATE_OPTIONS.find((o) => o.value === DEFAULT_TTS_RATE)!;
    const btn = screen.getByRole('button', { name: `朗讀速度 ${current.label}` });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  // Changing speed mid-playback would restart or jar the audio; the control
  // belongs to the idle state where the student is choosing how to listen.
  it('is not shown while recording', () => {
    render(<KeyPassageReadingControls state="recording" {...baseProps} />);
    expect(screen.queryByRole('button', { name: /朗讀速度/ })).toBeNull();
  });
});
