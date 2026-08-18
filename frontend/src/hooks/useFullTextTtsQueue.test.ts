/**
 * Tests for useFullTextTtsQueue — whole-lesson sequential playback for the
 * 讀全文-做記號 (FullTextAnnotate) step's audio player.
 *
 * Exercises the REAL useTtsPlayback + ttsApi (mocking fetch + Audio only, same
 * pattern as src/__tests__/ttsApi.test.ts) so assertions prove the actual
 * wiring — not a re-implementation of the queue logic inside the test.
 *
 * MockAudio here does NOT extend HTMLMediaElement (a plain stand-in class),
 * so it never touches the hook's own belt-and-suspenders
 * HTMLMediaElement.prototype.play patch — that defensive path is covered
 * separately in useFullTextTtsQueue.stopGuard.test.ts, mirroring how
 * LessonAudioTable.test.tsx splits the same two concerns.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useFullTextTtsQueue } from './useFullTextTtsQueue';
import { _testInternals as ttsApiTestInternals } from '../services/ttsApi';

const LESSON_ID = 42;
const P0 = '第一段課文，用來測試全文朗讀。';
const P1 = '第二段課文，緊接在第一段之後。';
const P2 = '第三段課文，是最後一段。';
const PARAGRAPHS = [P0, P1, P2];

const CANON_P0 = 'CANON-SENTENCE-FOR-PARAGRAPH-0';
const CANON_P1 = 'CANON-SENTENCE-FOR-PARAGRAPH-1';
const CANON_P2 = 'CANON-SENTENCE-FOR-PARAGRAPH-2';

// Prefetch is stubbed here on purpose. These tests pin the *walk* — which
// paragraph is spoken, in what order, and when it stops — and a real prefetch
// would add a fetch for paragraph N+1 to every exact-sequence assertion,
// blurring "what was spoken" into "what was requested". Prefetch has its own
// assertions at the bottom of this file, and its overlap behaviour is covered
// in ttsApi.prefetch.test.ts.
const prefetchSpy = vi.fn();
vi.mock('../services/ttsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/ttsApi')>()),
  prefetchText: (...args: unknown[]) => prefetchSpy(...args),
}));

const MAPPING_RESPONSE = {
  lesson_id: LESSON_ID,
  paragraphs: [
    { index: 0, sentences: [{ text: CANON_P0, hash: 'h0', chars: CANON_P0.length }] },
    { index: 1, sentences: [{ text: CANON_P1, hash: 'h1', chars: CANON_P1.length }] },
    { index: 2, sentences: [{ text: CANON_P2, hash: 'h2', chars: CANON_P2.length }] },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;
let audioInstances: MockAudio[];

class MockAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  currentTime = 0;
  duration = 1;
  src: string;

  constructor(src?: string) {
    this.src = src ?? '';
    audioInstances.push(this);
  }

  // Does NOT auto-fire onended — tests control timing explicitly so
  // "paragraph finished naturally" vs "user hit stop first" stay distinct.
  play() {
    return Promise.resolve();
  }

  pause() {}
}

function defaultFetchImpl(url: string) {
  const urlStr = String(url);
  if (urlStr.includes('/api/tts/mapping/')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(MAPPING_RESPONSE) });
  }
  if (urlStr.includes('/api/tts/synthesize')) {
    return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['audio-bytes'], { type: 'audio/mpeg' })) });
  }
  return Promise.reject(new Error(`unexpected fetch: ${urlStr}`));
}

function synthesizeCalls() {
  return fetchMock.mock.calls
    .filter(([url]: [string]) => String(url).includes('/api/tts/synthesize'))
    .map(([, init]: [string, RequestInit]) => JSON.parse(init.body as string).text as string);
}

function mappingCallCount() {
  return fetchMock.mock.calls.filter(([url]: [string]) => String(url).includes('/api/tts/mapping/')).length;
}

beforeEach(() => {
  audioInstances = [];
  fetchMock = vi.fn(defaultFetchImpl);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('Audio', MockAudio);
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock-url'),
    revokeObjectURL: vi.fn(),
  });
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    writable: true,
    value: { getVoices: () => [], cancel: vi.fn(), speak: vi.fn(), pause: vi.fn(), resume: vi.fn(), onvoiceschanged: null },
  });
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    text: string;
    lang = '';
    rate = 1;
    voice: unknown = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text?: string) { this.text = text ?? ''; }
  });
  // ttsApi.ts's _urlCache/_mappingCache are module-level singletons.
  ttsApiTestInternals.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useFullTextTtsQueue', () => {
  it('is idle initially — currentParagraphIdx -1, nothing playing', () => {
    const { result } = renderHook(() => useFullTextTtsQueue({ paragraphs: PARAGRAPHS, lessonId: LESSON_ID }));
    expect(result.current.currentParagraphIdx).toBe(-1);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('play() speaks paragraph 0 through the canonical-sentence cache (lessonId + idx=0) — not a hardcoded index', async () => {
    const { result } = renderHook(() => useFullTextTtsQueue({ paragraphs: PARAGRAPHS, lessonId: LESSON_ID }));

    act(() => { result.current.play(); });

    await waitFor(() => expect(mappingCallCount()).toBeGreaterThan(0));
    const [mappingUrl] = fetchMock.mock.calls.find(([u]: [string]) => String(u).includes('/api/tts/mapping/'))!;
    expect(String(mappingUrl)).toContain(`/api/tts/mapping/${LESSON_ID}`);
    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0]));
    expect(result.current.currentParagraphIdx).toBe(0);
  });

  it('auto-advances through every paragraph in order — walking paragraph N passes index N, not 0 (#2627)', async () => {
    const { result } = renderHook(() => useFullTextTtsQueue({ paragraphs: PARAGRAPHS, lessonId: LESSON_ID }));

    act(() => { result.current.play(); });
    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0]));
    expect(result.current.currentParagraphIdx).toBe(0);

    act(() => { audioInstances[0].onended?.(); });
    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0, CANON_P1]));
    expect(result.current.currentParagraphIdx).toBe(1);

    act(() => { audioInstances[1].onended?.(); });
    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0, CANON_P1, CANON_P2]));
    expect(result.current.currentParagraphIdx).toBe(2);

    // Only ONE GET to the mapping endpoint across the whole walk — every
    // paragraph's lookup hit the cache populated by the first call.
    expect(mappingCallCount()).toBe(1);
  });

  it('returns to idle (-1) after the last paragraph finishes', async () => {
    const { result } = renderHook(() => useFullTextTtsQueue({ paragraphs: PARAGRAPHS, lessonId: LESSON_ID }));
    act(() => { result.current.play(); });
    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0]));

    act(() => { audioInstances[0].onended?.(); });
    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0, CANON_P1]));
    act(() => { audioInstances[1].onended?.(); });
    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0, CANON_P1, CANON_P2]));
    act(() => { audioInstances[2].onended?.(); });

    await waitFor(() => expect(result.current.currentParagraphIdx).toBe(-1));
    expect(result.current.isPlaying).toBe(false);
  });

  it('stop() mid-paragraph prevents any further sentence fetch — the walk does not advance even if the stale audio fires onended late', async () => {
    const { result } = renderHook(() => useFullTextTtsQueue({ paragraphs: PARAGRAPHS, lessonId: LESSON_ID }));
    act(() => { result.current.play(); });
    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0]));

    act(() => { result.current.stop(); });
    expect(result.current.currentParagraphIdx).toBe(-1);

    // The (now-stale) audio element fires onended late — e.g. a real browser
    // delivering a queued event after .pause(). Must NOT be treated as
    // "paragraph finished, advance to the next one".
    act(() => { audioInstances[0].onended?.(); });
    await new Promise((r) => setTimeout(r, 0));

    expect(synthesizeCalls()).toEqual([CANON_P0]); // never a 2nd call for CANON_P1
    expect(result.current.currentParagraphIdx).toBe(-1);
  });

  it('play() after stop() starts a fresh walk from paragraph 0, immune to the stopped walk\'s stale callbacks', async () => {
    const { result } = renderHook(() => useFullTextTtsQueue({ paragraphs: PARAGRAPHS, lessonId: LESSON_ID }));
    act(() => { result.current.play(); });
    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0]));
    act(() => { audioInstances[0].onended?.(); });
    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0, CANON_P1]));

    act(() => { result.current.stop(); });
    expect(result.current.currentParagraphIdx).toBe(-1);

    act(() => { result.current.play(); });
    await waitFor(() => expect(result.current.currentParagraphIdx).toBe(0));

    // The OLD walk's paragraph-1 audio (already stopped) fires its onended
    // late — must not be mistaken for the NEW walk's paragraph 0 finishing.
    act(() => { audioInstances[1].onended?.(); });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.currentParagraphIdx).toBe(0);
  });

  it('pause() does not advance the walk — isTtsSpeaking stays true while paused, so the finished-transition never fires', async () => {
    const { result } = renderHook(() => useFullTextTtsQueue({ paragraphs: PARAGRAPHS, lessonId: LESSON_ID }));
    act(() => { result.current.play(); });
    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0]));

    act(() => { result.current.pause(); });
    expect(result.current.isPaused).toBe(true);

    // Give any pending microtasks a chance to run — a bug here would show up
    // as an unwanted second synthesize call.
    await new Promise((r) => setTimeout(r, 0));
    expect(synthesizeCalls()).toEqual([CANON_P0]);
    expect(result.current.currentParagraphIdx).toBe(0);

    act(() => { result.current.resume(); });
    expect(result.current.isPaused).toBe(false);

    act(() => { audioInstances[0].onended?.(); });
    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0, CANON_P1]));
  });

  it('a TTS error aborts the walk instead of advancing to the next paragraph', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/tts/mapping/')) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
      }
      if (String(url).includes('/api/tts/synthesize')) {
        return Promise.resolve({ ok: false, status: 503, blob: () => Promise.resolve(new Blob([])) });
      }
      return Promise.reject(new Error('unexpected fetch'));
    });

    const { result } = renderHook(() => useFullTextTtsQueue({ paragraphs: PARAGRAPHS, lessonId: LESSON_ID }));
    act(() => { result.current.play(); });

    await waitFor(() => expect(result.current.ttsError).toBeTruthy());
    await waitFor(() => expect(result.current.currentParagraphIdx).toBe(-1));
    // Only paragraph 0's attempt happened — never a second attempt for paragraph 1.
    expect(synthesizeCalls()).toHaveLength(1);
  });

  it('play() is a no-op when paragraphs is empty', () => {
    const { result } = renderHook(() => useFullTextTtsQueue({ paragraphs: [], lessonId: LESSON_ID }));
    act(() => { result.current.play(); });
    expect(result.current.currentParagraphIdx).toBe(-1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('unmounting while playing pauses the in-flight audio (never leaves it running after navigating away)', async () => {
    const { result, unmount } = renderHook(() => useFullTextTtsQueue({ paragraphs: PARAGRAPHS, lessonId: LESSON_ID }));
    act(() => { result.current.play(); });
    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0]));

    const pauseSpy = vi.spyOn(audioInstances[0], 'pause');
    unmount();
    expect(pauseSpy).toHaveBeenCalled();
  });
});

describe('useFullTextTtsQueue — paragraph-boundary prefetch', () => {
  it('asks for the next paragraph while the current one is still being read', async () => {
    // Owner, listening to a whole lesson: 「我覺得段落之間的延遲太多了」.
    // Within a paragraph the in-loop prefetch keeps it smooth; the boundary is
    // where it stalled, because nothing had asked for paragraph N+1 yet.
    const { result } = renderHook(() =>
      useFullTextTtsQueue({ paragraphs: PARAGRAPHS, lessonId: LESSON_ID })
    );

    act(() => result.current.play());

    await waitFor(() =>
      expect(prefetchSpy).toHaveBeenCalledWith(PARAGRAPHS[1], LESSON_ID, 1)
    );
  });

  it('does not prefetch past the last paragraph', async () => {
    const { result } = renderHook(() =>
      useFullTextTtsQueue({ paragraphs: [PARAGRAPHS[0]], lessonId: LESSON_ID })
    );

    act(() => result.current.play());

    await waitFor(() => expect(prefetchSpy).toHaveBeenCalled());
    // undefined is what a walker passes at the end; prefetchText ignores it,
    // but asserting here keeps the walker from inventing a paragraph.
    expect(prefetchSpy).toHaveBeenCalledWith(undefined, LESSON_ID, 1);
  });
});
