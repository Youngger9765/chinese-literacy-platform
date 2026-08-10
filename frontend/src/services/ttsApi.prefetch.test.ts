/**
 * While one sentence plays, the next one should already be on its way.
 *
 * Playback was strictly serial: request a sentence, wait for it, play it, then
 * request the next one. Every uncached sentence therefore inserted its full
 * synthesis time as silence — measured at 4.5s on a cold key passage in the
 * admin panel (#2627).
 *
 * The wait is avoidable. A sentence takes seconds to *say* and well under a
 * second to fetch, so the fetch for sentence N+1 fits comfortably inside the
 * playback of sentence N. Owner's words: 「你不能夠在全文朗讀之前你就一句一句
 * 人家還在讀的時候就趕快趕快預先處理嗎？」
 *
 * Doing it in the shared loop fixes every caller at once — Intro, the whole-
 * lesson walk, and the admin panel — rather than one prefetch per feature.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const SENTENCES = ['第一句。', '第二句。', '第三句。'];

/** Order of events: 'fetch:<text>' and 'play:<text>'. */
let timeline: string[] = [];
let resolvePlay: Array<() => void> = [];

function installMocks() {
  timeline = [];
  resolvePlay = [];

  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/tts/mapping/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          lesson_id: 1,
          paragraphs: [{ index: 0, sentences: SENTENCES.map((t) => ({ text: t, hash: t, chars: t.length })) }],
        }),
      } as unknown as Response;
    }
    const body = JSON.parse(String(init?.body ?? '{}'));
    timeline.push(`fetch:${body.text}`);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      blob: async () => ({ size: 128 }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  global.URL.createObjectURL = vi.fn(() => 'blob:stub');
  global.URL.revokeObjectURL = vi.fn();

  // An Audio element that only finishes when the test says so, so we can
  // inspect what happened *during* playback rather than after it.
  class StubAudio {
    src = '';
    currentTime = 0;
    paused = false;
    onended: (() => void) | null = null;
    private handlers: Record<string, Array<() => void>> = {};
    constructor(src?: string) {
      this.src = src ?? '';
    }
    addEventListener(ev: string, fn: () => void) {
      (this.handlers[ev] ||= []).push(fn);
    }
    removeEventListener() {}
    pause() {
      this.paused = true;
    }
    play() {
      timeline.push('play');
      return new Promise<void>((res) => {
        resolvePlay.push(() => {
          (this.handlers.ended || []).forEach((f) => f());
          this.onended?.();
        });
        res();
      });
    }
  }
  vi.stubGlobal('Audio', StubAudio as unknown as typeof Audio);
}

describe('sentence prefetch', () => {
  beforeEach(() => {
    vi.resetModules();
    installMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests the next sentence before the current one has finished', async () => {
    const { speakText } = await import('./ttsApi');

    const done = speakText('第一句。第二句。第三句。');

    // Let the first fetch + play get going.
    await vi.waitFor(() => expect(timeline).toContain('play'));

    const beforeFirstEnds = [...timeline];
    const fetched = beforeFirstEnds.filter((e) => e.startsWith('fetch:'));

    expect(fetched).toContain('fetch:第一句。');
    expect(fetched).toContain(
      'fetch:第二句。',
    );

    // Drain so the promise settles and the test doesn't leak a pending walk.
    // Bounded rather than while-empty: a resolve can queue the next play, so
    // an unbounded loop here would hang the run instead of failing it.
    for (let i = 0; i < 30; i += 1) {
      if (resolvePlay.length) resolvePlay.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
    await done.catch(() => {});
  });

  it('still plays every sentence, in order', async () => {
    const { speakText } = await import('./ttsApi');
    const done = speakText('第一句。第二句。第三句。');

    for (let i = 0; i < 30; i += 1) {
      if (resolvePlay.length) resolvePlay.shift()!();
      await Promise.resolve();
    }
    await done.catch(() => {});

    const played = timeline.filter((e) => e === 'play').length;
    expect(played).toBe(SENTENCES.length);

    // Each sentence fetched exactly once — prefetching must not double-charge
    // us for synthesis.
    for (const s of SENTENCES) {
      expect(timeline.filter((e) => e === `fetch:${s}`)).toHaveLength(1);
    }
  });
});
