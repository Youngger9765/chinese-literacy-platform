/**
 * Characterization tests for ListeningPractice refactor — Issue #1956
 *
 * TDD-first: these tests encode behaviors from the 511-LOC monolith that
 * must survive the split into:
 *   - useTTSEngine (TTS state machine)
 *   - ListeningQuestionPanel (Q/A UI — tested via component tests)
 *   - ListeningScoring (correctness logic + feedback render)
 *
 * Run with: npx vitest run src/components/reading-steps/__tests__/ListeningPractice.characterization.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ttsApi — required before importing any module that imports it
vi.mock('../../../services/ttsApi', () => ({
  speakTextWithProgress: vi.fn(),
  cancelTts: vi.fn(),
}));

import {
  scoreColour,
  buildSpeaker,
  computePlayStateFlags,
} from '../listening/listeningUtils';

import { speakTextWithProgress, cancelTts } from '../../../services/ttsApi';

// ─── scoreColour ─────────────────────────────────────────────────────────────

describe('scoreColour', () => {
  it('returns emerald class for score >= 80', () => {
    expect(scoreColour(80)).toBe('text-emerald-700');
    expect(scoreColour(100)).toBe('text-emerald-700');
    expect(scoreColour(95)).toBe('text-emerald-700');
  });

  it('returns amber class for score 60-79', () => {
    expect(scoreColour(60)).toBe('text-amber-700');
    expect(scoreColour(79)).toBe('text-amber-700');
    expect(scoreColour(65)).toBe('text-amber-700');
  });

  it('returns tertiary class for score < 60', () => {
    expect(scoreColour(0)).toBe('text-tertiary');
    expect(scoreColour(59)).toBe('text-tertiary');
    expect(scoreColour(30)).toBe('text-tertiary');
  });
});

// ─── buildSpeaker ─────────────────────────────────────────────────────────────

describe('buildSpeaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls speakTextWithProgress with the provided text on start()', async () => {
    const mockSpeak = vi.mocked(speakTextWithProgress);
    mockSpeak.mockResolvedValueOnce(undefined);

    const speaker = buildSpeaker('你好世界', 0.85);
    const onEnd = vi.fn();
    const onError = vi.fn();
    const onProgress = vi.fn();

    speaker.start(onEnd, onError, onProgress);

    await vi.waitFor(() => {
      expect(mockSpeak).toHaveBeenCalledWith('你好世界', onProgress);
    });
  });

  it('calls onEnd callback when speakTextWithProgress resolves', async () => {
    const mockSpeak = vi.mocked(speakTextWithProgress);
    mockSpeak.mockResolvedValueOnce(undefined);

    const speaker = buildSpeaker('hello', 1.0);
    const onEnd = vi.fn();
    const onError = vi.fn();
    const onProgress = vi.fn();

    speaker.start(onEnd, onError, onProgress);

    await vi.waitFor(() => {
      expect(onEnd).toHaveBeenCalledTimes(1);
    });
  });

  it('calls onError callback when speakTextWithProgress rejects', async () => {
    const mockSpeak = vi.mocked(speakTextWithProgress);
    mockSpeak.mockRejectedValueOnce(new Error('network error'));

    const speaker = buildSpeaker('hello', 1.0);
    const onEnd = vi.fn();
    const onError = vi.fn();
    const onProgress = vi.fn();

    speaker.start(onEnd, onError, onProgress);

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('network error'));
    });
  });

  it('cancel() calls cancelTts from ttsApi', () => {
    const mockCancel = vi.mocked(cancelTts);
    const speaker = buildSpeaker('hello', 1.0);
    speaker.cancel();
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it('uses generic error message when rejection has no message', async () => {
    const mockSpeak = vi.mocked(speakTextWithProgress);
    // Reject with a non-Error value
    mockSpeak.mockRejectedValueOnce(null);

    const speaker = buildSpeaker('test', 1.0);
    const onEnd = vi.fn();
    const onError = vi.fn();
    const onProgress = vi.fn();

    speaker.start(onEnd, onError, onProgress);

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith('speech error');
    });
  });
});

// ─── computePlayStateFlags ────────────────────────────────────────────────────

describe('computePlayStateFlags', () => {
  it('isIdle=true when playState=idle and paragraphPlayState=idle', () => {
    const flags = computePlayStateFlags('idle', 'idle');
    expect(flags.isIdle).toBe(true);
    expect(flags.isPlaying).toBe(false);
    expect(flags.isPaused).toBe(false);
    expect(flags.isAllDone).toBe(false);
    expect(flags.isBetweenParagraphs).toBe(false);
  });

  it('isPlaying=true when playState=playing', () => {
    const flags = computePlayStateFlags('playing', 'playing');
    expect(flags.isPlaying).toBe(true);
    expect(flags.isIdle).toBe(false);
  });

  it('isPaused=true when playState=paused', () => {
    const flags = computePlayStateFlags('paused', 'idle');
    expect(flags.isPaused).toBe(true);
    expect(flags.isIdle).toBe(false);
  });

  it('isAllDone=true when paragraphPlayState=done', () => {
    const flags = computePlayStateFlags('done', 'done');
    expect(flags.isAllDone).toBe(true);
  });

  it('isBetweenParagraphs=true when paragraphPlayState=between', () => {
    const flags = computePlayStateFlags('done', 'between');
    expect(flags.isBetweenParagraphs).toBe(true);
  });

  it('isIdle=false when playState=idle but paragraphPlayState is not idle', () => {
    // Mid-session pause (paragraphPlayState=between) makes isIdle false
    const flags = computePlayStateFlags('idle', 'between');
    expect(flags.isIdle).toBe(false);
  });
});
