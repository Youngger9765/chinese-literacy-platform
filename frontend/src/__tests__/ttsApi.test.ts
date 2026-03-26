/**
 * Unit tests for ttsApi retry/cooldown logic (Issue #663).
 *
 * Tests the backend retry mechanism:
 * - First failure sets cooldown, does NOT permanently disable
 * - After cooldown expires, retries backend
 * - After 3 consecutive failures, permanently falls back
 * - Success resets failure count
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    // Store callback, trigger it async
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

// Mock SpeechSynthesisUtterance as a class
class MockUtterance {
  lang = '';
  rate = 1;
  pitch = 1;
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(public text: string) {}
}
vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);

// Mock SpeechSynthesis
const mockSpeak = vi.fn().mockImplementation((u: MockUtterance) => {
  setTimeout(() => u.onend?.(), 0);
});
const mockCancel = vi.fn();
const mockGetVoices = vi.fn().mockReturnValue([]);
vi.stubGlobal('speechSynthesis', {
  speak: mockSpeak,
  cancel: mockCancel,
  getVoices: mockGetVoices,
  onvoiceschanged: null,
});

import { speakText, _testInternals } from '../services/ttsApi';

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

describe('ttsApi retry logic', () => {
  beforeEach(() => {
    _testInternals.reset();
    fetchMock.mockReset();
    mockSpeak.mockImplementation((u: MockUtterance) => {
      setTimeout(() => u.onend?.(), 0);
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('first failure sets cooldown but does NOT permanently disable', async () => {
    mockFetchFailure();

    const promise = speakText('測試');
    await vi.runAllTimersAsync();
    await promise;

    const state = _testInternals.getState();
    expect(state._consecutiveFailures).toBe(1);
    expect(state._permanentlyFallback).toBe(false);
    expect(state._lastFailureTime).toBeGreaterThan(0);
  });

  it('during cooldown, skips backend and uses Web Speech directly', async () => {
    // First call: backend fails
    mockFetchFailure();
    let promise = speakText('測試一');
    await vi.runAllTimersAsync();
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call within cooldown: should NOT call fetch
    fetchMock.mockReset();
    promise = speakText('測試二');
    await vi.runAllTimersAsync();
    await promise;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('after cooldown expires, retries backend', async () => {
    // First call: backend fails
    mockFetchFailure();
    let promise = speakText('測試');
    await vi.runAllTimersAsync();
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance past cooldown
    vi.advanceTimersByTime(_testInternals.BACKEND_COOLDOWN_MS + 100);

    // Next call: should retry backend
    mockFetchSuccess();
    promise = speakText('再試');
    await vi.runAllTimersAsync();
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('after 3 consecutive failures, permanently falls back', async () => {
    for (let i = 0; i < _testInternals.MAX_CONSECUTIVE_FAILURES; i++) {
      mockFetchFailure();
      // Advance past cooldown for each retry
      vi.advanceTimersByTime(_testInternals.BACKEND_COOLDOWN_MS + 100);
      const promise = speakText(`失敗${i}`);
      await vi.runAllTimersAsync();
      await promise;
    }

    const state = _testInternals.getState();
    expect(state._consecutiveFailures).toBe(_testInternals.MAX_CONSECUTIVE_FAILURES);
    expect(state._permanentlyFallback).toBe(true);

    // Even after cooldown, should NOT retry
    fetchMock.mockReset();
    vi.advanceTimersByTime(_testInternals.BACKEND_COOLDOWN_MS + 100);
    const promise = speakText('不該再試');
    await vi.runAllTimersAsync();
    await promise;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('success resets consecutive failure count', async () => {
    // Fail once
    mockFetchFailure();
    let promise = speakText('失敗');
    await vi.runAllTimersAsync();
    await promise;
    expect(_testInternals.getState()._consecutiveFailures).toBe(1);

    // Advance past cooldown, then succeed
    vi.advanceTimersByTime(_testInternals.BACKEND_COOLDOWN_MS + 100);
    mockFetchSuccess();
    promise = speakText('成功');
    await vi.runAllTimersAsync();
    await promise;

    const state = _testInternals.getState();
    expect(state._consecutiveFailures).toBe(0);
    expect(state._permanentlyFallback).toBe(false);
  });
});
