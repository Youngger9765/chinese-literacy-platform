/**
 * A paragraph is synthesized as one request, not sentence by sentence.
 *
 * Measured, and it inverts the obvious theory. Splitting a paragraph into
 * sentences and playing the clips back to back costs almost nothing in timing:
 *
 *   one request for three sentences   5.33 s
 *   three clips concatenated          5.50 s   (+84 ms per seam)
 *
 * and the pause it produces (763 ms) is if anything shorter than the pause
 * Azure renders itself between two sentences in one request (873–883 ms). So
 * the choppiness the owner hears is not gaps, and trimming the 665 ms of
 * padding Azure appends — which I had already built — would have made the
 * reading more rushed, not smoother.
 *
 * What per-sentence synthesis actually loses is prosody. Each clip is generated
 * in isolation, so the pitch contour resets at every sentence: no declination
 * across the paragraph, no anticipation of what follows. It sounds like a list
 * of sentences rather than someone reading. Only a larger synthesis unit fixes
 * that.
 *
 * Paragraph rather than whole lesson: a paragraph boundary is a place a pause
 * belongs, one paragraph can be regenerated without invalidating the rest, and
 * the highlight already tracks paragraphs — one clip now maps to exactly one
 * highlighted block.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const PARAGRAPH = '第一句話。第二句話。第三句話。';
let synthesized: string[] = [];

function installMocks() {
  synthesized = [];
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/tts/mapping/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          lesson_id: 1,
          paragraphs: [{
            index: 0,
            sentences: [
              { text: '第一句話。', hash: 'h0', chars: 5 },
              { text: '第二句話。', hash: 'h1', chars: 5 },
              { text: '第三句話。', hash: 'h2', chars: 5 },
            ],
          }],
        }),
      } as unknown as Response;
    }
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.text) synthesized.push(body.text);
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      blob: async () => ({ size: 64 }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  global.URL.createObjectURL = vi.fn(() => 'blob:stub');
  global.URL.revokeObjectURL = vi.fn();

  class StubAudio {
    src = '';
    currentTime = 0;
    paused = false;
    onended: (() => void) | null = null;
    private h: Record<string, Array<() => void>> = {};
    constructor(src?: string) { this.src = src ?? ''; }
    addEventListener(ev: string, fn: () => void) { (this.h[ev] ||= []).push(fn); }
    removeEventListener() {}
    pause() { this.paused = true; }
    play() {
      // Finish immediately so the walk runs to completion inside the test.
      queueMicrotask(() => { (this.h.ended || []).forEach((f) => f()); this.onended?.(); });
      return Promise.resolve();
    }
  }
  vi.stubGlobal('Audio', StubAudio as unknown as typeof Audio);
}

describe('paragraph-level synthesis', () => {
  beforeEach(() => { vi.resetModules(); installMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('sends the paragraph as a single request', async () => {
    const { speakText } = await import('./ttsApi');
    await speakText(PARAGRAPH, 1, 0);

    const paragraphRequests = synthesized.filter((t) => t === PARAGRAPH);
    expect(paragraphRequests).toHaveLength(1);
  });

  it('does not send the sentences individually', async () => {
    const { speakText } = await import('./ttsApi');
    await speakText(PARAGRAPH, 1, 0);

    // The mapping's sentences must not become separate synthesis calls — that
    // is the prosody reset this change exists to remove.
    for (const sentence of ['第一句話。', '第二句話。', '第三句話。']) {
      expect(synthesized).not.toContain(sentence);
    }
  });

  it('still splits when there is no lesson context to address', async () => {
    // Ad-hoc text (a definition, a hint) has no paragraph to synthesize as a
    // unit, and long text has to be chunked to stay inside the request limit.
    const { speakText } = await import('./ttsApi');
    await speakText('第一句話。第二句話。');

    expect(synthesized.length).toBeGreaterThan(1);
  });

  it('prefetches the same unit playback will ask for', async () => {
    // The bug this catches shipped: prefetch warmed the next paragraph's first
    // *sentence* while playback requested the whole *paragraph*. Different cache
    // keys, so the warm-up bought nothing and paid for an extra synthesis on
    // top. Visible on staging as 8 requests for a 5-paragraph lesson —
    // alternating one long and one short — and 13% of playback silent.
    const { prefetchText } = await import('./ttsApi');
    prefetchText(PARAGRAPH, 1, 0);
    await vi.waitFor(() => expect(synthesized.length).toBeGreaterThan(0));

    expect(synthesized).toContain(PARAGRAPH);
    expect(synthesized).not.toContain('第一句話。');
  });
});
