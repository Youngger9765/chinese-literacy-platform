/**
 * #3023 — the speed control has to be on the path the reporting audience
 * actually walks.
 *
 * The first pass put TtsSpeedPicker only in KeyPassageReadingControls, which
 * is mounted only by KeyPassageReading -- the SIGNED-IN shell. But
 * key-passage-reading is a PUBLIC_LEARNING_STEP: LearningRouteGate sends
 * every unauthenticated visitor to GuestReadingPage, which renders
 * FullTextAnnotate for both 讀全文-做記號 AND 重點朗讀, and that path plays
 * its demo audio through ReadingPlayer.
 *
 * So a student scanning the printed QR on the 課後學習扶助 worksheet -- the
 * exact scenario the ticket names -- heard 273 字/分 with no way to change
 * it. The rate plumbing reached them (useFullTextTtsQueue -> useTtsPlayback);
 * the control did not.
 *
 * ReadingPlayer is the shared demo-audio player, so the control belongs here.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ReadingPlayer from '../ReadingPlayer';
import { getTtsPlaybackRate, DEFAULT_TTS_RATE, TTS_RATE_OPTIONS } from '../../../utils/ttsRate';

const handlers = {
  onPlay: vi.fn(),
  onPause: vi.fn(),
  onResume: vi.fn(),
  onStop: vi.fn(),
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('#3023 ReadingPlayer carries the speed control', () => {
  it('offers every rate while idle -- this is the guest/QR surface', () => {
    render(<ReadingPlayer isPlaying={false} isPaused={false} {...handlers} />);
    for (const opt of TTS_RATE_OPTIONS) {
      expect(
        screen.getByRole('button', { name: `朗讀速度 ${opt.label}` }),
        `missing ${opt.label}`,
      ).toBeTruthy();
    }
  });

  it('persists the choice', () => {
    render(<ReadingPlayer isPlaying={false} isPaused={false} {...handlers} />);
    const slow = TTS_RATE_OPTIONS.find((o) => o.value < DEFAULT_TTS_RATE)!;
    fireEvent.click(screen.getByRole('button', { name: `朗讀速度 ${slow.label}` }));
    expect(getTtsPlaybackRate()).toBe(slow.value);
  });

  // Changing rate mid-utterance would need the audio restarted to take
  // effect, which is jarring. Offer it when the student is choosing.
  it('hides the control while audio is playing', () => {
    render(<ReadingPlayer isPlaying isPaused={false} {...handlers} />);
    expect(screen.queryByRole('button', { name: /朗讀速度/ })).toBeNull();
  });

  it('still shows play/stop as before (negative control on the existing UI)', () => {
    const { rerender } = render(
      <ReadingPlayer isPlaying={false} isPaused={false} idleLabel="播放全文" {...handlers} />,
    );
    expect(screen.getByRole('button', { name: '播放全文' })).toBeTruthy();
    rerender(<ReadingPlayer isPlaying isPaused={false} idleLabel="播放全文" {...handlers} />);
    expect(screen.getByRole('button', { name: /停止/ })).toBeTruthy();
  });

  it('can be turned off by a caller that has its own control', () => {
    render(<ReadingPlayer isPlaying={false} isPaused={false} showSpeed={false} {...handlers} />);
    expect(screen.queryByRole('button', { name: /朗讀速度/ })).toBeNull();
  });
});
