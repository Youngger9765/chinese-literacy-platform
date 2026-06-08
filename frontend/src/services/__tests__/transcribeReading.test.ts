/**
 * Tests for transcribeReading() wrapper — Block 3 frontend (Issue #2131).
 *
 * Verifies the fail-closed contract: any server error or unexpected shape
 * must return {method: "fallback", transcript: null} rather than throwing.
 *
 * NOTE: Real audio E2E is not tested here — requires a physical microphone.
 *       These tests mock the fetch() API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { transcribeReading } from '../learning/session';

// Minimal Blob stand-in
const fakeBlob = new Blob(['fake-audio'], { type: 'audio/webm' });

describe('transcribeReading — fail-closed contract', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns gemini result on 200 success', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        transcript: '孟嘗君養了很多門客。',
        method: 'gemini',
        reasoning: '轉錄正確。',
      }),
    });

    const result = await transcribeReading(fakeBlob, '孟嘗君養了很多門客。', 5000, 'test-token');
    expect(result.method).toBe('gemini');
    expect(result.transcript).toBe('孟嘗君養了很多門客。');
    expect(result.reasoning).toBe('轉錄正確。');
  });

  it('returns fallback when backend returns {method: "fallback", transcript: null}', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ transcript: null, method: 'fallback' }),
    });

    const result = await transcribeReading(fakeBlob, '測試文字', 3000, 'test-token');
    expect(result.method).toBe('fallback');
    expect(result.transcript).toBeNull();
  });

  it('returns fallback on HTTP 429 (rate limit), does not throw', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 429 });

    const result = await transcribeReading(fakeBlob, '測試文字', 3000, 'test-token');
    expect(result.method).toBe('fallback');
    expect(result.transcript).toBeNull();
  });

  it('returns fallback on HTTP 401 (auth), does not throw', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 401 });

    const result = await transcribeReading(fakeBlob, '測試文字', 3000, 'test-token');
    expect(result.method).toBe('fallback');
    expect(result.transcript).toBeNull();
  });

  it('returns fallback on network error (fetch throws), does not throw', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    const result = await transcribeReading(fakeBlob, '測試文字', 3000, 'test-token');
    expect(result.method).toBe('fallback');
    expect(result.transcript).toBeNull();
  });

  it('returns fallback when response JSON has unexpected shape', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ something: 'unexpected' }),
    });

    const result = await transcribeReading(fakeBlob, '測試文字', 3000, 'test-token');
    expect(result.method).toBe('fallback');
    expect(result.transcript).toBeNull();
  });
});
