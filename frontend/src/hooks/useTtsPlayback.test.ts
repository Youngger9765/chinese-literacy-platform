/**
 * Unit tests for useTtsPlayback — Issue #2609 (silent Web Speech API fallback).
 *
 * Repro: when Cloud TTS (`POST /api/tts/synthesize`) fails, the single-shot
 * path (no lessonId/paragraphIdx — used by FullReading via
 * useFullReadingTtsQueue) silently falls back to the browser's built-in Web
 * Speech API with no visible signal. `ttsError` stays null because the
 * fallback "succeeded" — the student hears a robotic voice with zero
 * indication it isn't the real AI narration.
 *
 * This suite locks in `isTtsDegraded`, the flag the UI banner reads to show
 * "現在念的是系統語音" during fallback playback, and asserts it is a distinct
 * signal from `ttsError` (real failure, no fallback available).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTtsPlayback } from './useTtsPlayback';

// ---------------------------------------------------------------------------
// Mocks: fetch (Cloud TTS backend), Audio (Cloud TTS playback), Web Speech API
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

class MockAudio {
  onplay: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  currentTime = 0;
  duration = 10;
  src: string;
  constructor(url: string) {
    this.src = url;
  }
  play() {
    // Real <audio> fires onplay asynchronously once decoding starts.
    Promise.resolve().then(() => this.onplay?.());
    return Promise.resolve();
  }
  pause() {}
}
vi.stubGlobal('Audio', MockAudio);

vi.stubGlobal('URL', {
  ...URL,
  createObjectURL: vi.fn(() => 'blob:mock-url'),
  revokeObjectURL: vi.fn(),
});

class MockUtterance {
  text: string;
  lang = '';
  rate = 1;
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onboundary: ((e: { charIndex: number }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}
vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);

interface SpeechSynthesisMock {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  getVoices: ReturnType<typeof vi.fn>;
  onvoiceschanged: (() => void) | null;
}

/** Stub `window.speechSynthesis` as available with one zh-TW voice. */
function stubSpeechSynthesisAvailable(): SpeechSynthesisMock {
  const mock: SpeechSynthesisMock = {
    speak: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: vi.fn(() => [{ name: 'Test zh-TW Voice', lang: 'zh-TW' }]),
    onvoiceschanged: null,
  };
  vi.stubGlobal('speechSynthesis', mock);
  return mock;
}

/** Stub `window.speechSynthesis` as unavailable (older browser / no support). */
function stubSpeechSynthesisUnavailable(): void {
  vi.stubGlobal('speechSynthesis', undefined);
}

function mockFetchNetworkFailure(): void {
  fetchMock.mockRejectedValueOnce(new Error('network error'));
}

function mockFetchSuccess(): void {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    blob: () => Promise.resolve(new Blob(['audio'], { type: 'audio/mpeg' })),
  });
}

describe('useTtsPlayback — isTtsDegraded (silent fallback fix, #2609)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets isTtsDegraded=true when Cloud TTS fails and Web Speech fallback plays', async () => {
    const synth = stubSpeechSynthesisAvailable();
    mockFetchNetworkFailure();
    const { result } = renderHook(() => useTtsPlayback(() => {}, () => {}));

    act(() => {
      result.current.speakText('你好，早安。');
    });

    await waitFor(() => {
      expect(result.current.isTtsDegraded).toBe(true);
    });

    // Not a hard failure — the fallback voice IS playing, so ttsError must stay null.
    // Conflating the two would make "really failed" indistinguishable from
    // "degraded but working" (issue acceptance criterion #5).
    expect(result.current.ttsError).toBeNull();
    expect(synth.speak).toHaveBeenCalled();
  });

  it('clears isTtsDegraded once the fallback utterance ends', async () => {
    stubSpeechSynthesisAvailable();
    mockFetchNetworkFailure();
    const { result } = renderHook(() => useTtsPlayback(() => {}, () => {}));

    act(() => {
      result.current.speakText('你好，早安。');
    });

    await waitFor(() => expect(result.current.isTtsDegraded).toBe(true));

    act(() => {
      (result.current.utteranceRef.current as unknown as MockUtterance).onend?.();
    });

    expect(result.current.isTtsDegraded).toBe(false);
  });

  it('does not set isTtsDegraded on a normal successful Cloud TTS call', async () => {
    stubSpeechSynthesisAvailable();
    mockFetchSuccess();
    const { result } = renderHook(() => useTtsPlayback(() => {}, () => {}));

    act(() => {
      result.current.speakText('你好，早安。');
    });

    await waitFor(() => expect(result.current.isTtsSpeaking).toBe(true));
    expect(result.current.isTtsDegraded).toBe(false);
  });

  it('resets isTtsDegraded to false as soon as the next call starts', async () => {
    stubSpeechSynthesisAvailable();
    mockFetchNetworkFailure();
    const { result } = renderHook(() => useTtsPlayback(() => {}, () => {}));

    act(() => {
      result.current.speakText('第一次呼叫。');
    });
    await waitFor(() => expect(result.current.isTtsDegraded).toBe(true));

    mockFetchSuccess();
    act(() => {
      result.current.speakText('第二次呼叫。');
    });

    // isTtsDegraded resets synchronously at the top of every speakText() call.
    expect(result.current.isTtsDegraded).toBe(false);
  });

  it('does NOT set isTtsDegraded when no Web Speech fallback is available (hard failure via ttsError instead)', async () => {
    stubSpeechSynthesisUnavailable();
    mockFetchNetworkFailure();
    const { result } = renderHook(() => useTtsPlayback(() => {}, () => {}));

    act(() => {
      result.current.speakText('你好，早安。');
    });

    await waitFor(() => expect(result.current.ttsError).toBe('音檔載入失敗，請重試'));
    expect(result.current.isTtsDegraded).toBe(false);
  });

  it('clears isTtsDegraded when the fallback utterance itself errors (engine crash, no matching voice, etc.)', async () => {
    // Distinct from the "no speechSynthesis at all" case above: here the
    // fallback WAS committed to (isTtsDegraded flips true), but the Web
    // Speech engine then fails mid-flight. That must NOT leave the "still
    // playing degraded audio" banner stuck on top of a simultaneous hard
    // failure — code-reviewer catch on the first version of this fix, which
    // reset isTtsDegraded on onSpeechEnd but not on onSpeechError.
    stubSpeechSynthesisAvailable();
    mockFetchNetworkFailure();
    const { result } = renderHook(() => useTtsPlayback(() => {}, () => {}));

    act(() => {
      result.current.speakText('你好，早安。');
    });

    await waitFor(() => expect(result.current.isTtsDegraded).toBe(true));

    act(() => {
      (result.current.utteranceRef.current as unknown as MockUtterance).onerror?.();
    });

    expect(result.current.isTtsDegraded).toBe(false);
    expect(result.current.ttsError).toBe('音檔載入失敗，請重試');
  });
});
