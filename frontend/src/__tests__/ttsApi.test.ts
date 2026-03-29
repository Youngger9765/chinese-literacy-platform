/**
 * Unit tests for ttsApi (Issue #737 — Azure TTS only, Web Speech API removed).
 *
 * Tests:
 * - speakText() calls backend /api/tts/synthesize for each sentence
 * - Successful backend response plays audio
 * - Backend failure rejects the promise
 * - cancelTts() stops playback
 * - Empty/whitespace text resolves immediately without fetching
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally before importing the module
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// Mock Audio as a class (constructor)
let audioOnEnded: (() => void) | null = null;
class MockAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  currentTime = 0;

  play() {
    audioOnEnded = () => this.onended?.();
    setTimeout(() => audioOnEnded?.(), 0);
    return Promise.resolve();
  }
  pause() {}
}
vi.stubGlobal('Audio', MockAudio);

// Mock URL.createObjectURL
vi.stubGlobal('URL', {
  ...URL,
  createObjectURL: vi.fn(() => 'blob:mock-url'),
  revokeObjectURL: vi.fn(),
});

import { speakText, cancelTts, _testInternals } from '../services/ttsApi';

// Helper: make fetch return a successful audio blob
function mockFetchSuccess() {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    blob: () => Promise.resolve(new Blob(['audio'], { type: 'audio/mpeg' })),
  });
}

// Helper: make fetch return a failure
function mockFetchFailure(status = 503) {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status,
    blob: () => Promise.resolve(new Blob([])),
  });
}

describe('ttsApi — Azure TTS only', () => {
  beforeEach(() => {
    _testInternals.reset();
    fetchMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves immediately for empty text without calling fetch', async () => {
    await speakText('');
    expect(fetchMock).not.toHaveBeenCalled();

    await speakText('   ');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls backend /api/tts/synthesize for non-empty text', async () => {
    mockFetchSuccess();
    const promise = speakText('你好。');
    await vi.runAllTimersAsync();
    await promise;
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/tts/synthesize'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects when backend returns non-ok response', async () => {
    mockFetchFailure(503);
    // Attach rejection handler immediately to avoid unhandled rejection warning
    const promise = speakText('測試。');
    const rejection = promise.catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await rejection;
    expect(err).toBeInstanceOf(Error);
  });

  it('cancelTts stops playback mid-sequence', async () => {
    mockFetchSuccess();
    mockFetchSuccess();
    const promise = speakText('第一句。第二句。');
    // Cancel immediately
    cancelTts();
    await vi.runAllTimersAsync();
    // Promise should resolve (cancel = graceful stop, not reject)
    await promise;
  });

  it('sentence splitting: long text is split and fetches per-sentence', async () => {
    // Two short sentences — should result in 2 fetch calls
    mockFetchSuccess();
    mockFetchSuccess();
    const promise = speakText('第一句。第二句。');
    await vi.runAllTimersAsync();
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
