import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import LessonAudioTable, { buildLessonQrValue, buildQrManifestCsv, buildQrManifestRows, derivePlaybackState } from './LessonAudioTable';
import { useTtsPlayback } from '../../../hooks/useTtsPlayback';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

// The real hook's returned shape (see useTtsPlayback.ts) — mocked per-test via
// mockReturnValue so tests can drive the "is audio actually playing" signal
// independently of the component under test, the same way a real <audio>
// element's play/pause events would.
vi.mock('../../../hooks/useTtsPlayback', () => ({
  useTtsPlayback: vi.fn(),
}));

// jsdom has no media playback; give the prototype a resolvable no-op so the
// component's play() patch has something real to delegate to.
if (!HTMLMediaElement.prototype.play.toString().includes('patchedPlay')) {
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
}

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,test'),
  },
}));

const STORIES_RESPONSE = {
  total: 2,
  grades: [4, 7],
  stories: [
    {
      id: 1,
      lesson_number: 1,
      title: '贏得喝采的輸家',
      grade: 4,
      grade_code: 'G4-1',
      genre: '記敘文',
      category: 'Daily',
      char_count: 100,
      thumbnail_url: '/assets/stories/thumbnails/lesson-1.webp',
      reading_strategy: null,
      intro: { author: '', background: '' },
      has_key_reading: true,
    },
    {
      id: 89,
      lesson_number: 89,
      title: '閱讀策略練習',
      grade: 7,
      grade_code: 'G7-L23',
      genre: '說明文',
      category: 'Science',
      char_count: 120,
      thumbnail_url: '/assets/stories/thumbnails/lesson-89.webp',
      reading_strategy: null,
      intro: { author: '', background: '' },
      has_key_reading: false,
    },
  ],
};

const mockSpeakText = vi.fn();
const mockStopTts = vi.fn();

/** Deferred promise helper — lets a test control exactly when a fetch resolves. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Sets the mocked useTtsPlayback() return value for the next render. */
function mockTts(overrides: {
  isTtsLoading?: boolean;
  isTtsSpeaking?: boolean;
  ttsError?: string | null;
} = {}) {
  vi.mocked(useTtsPlayback).mockReturnValue({
    isTtsSpeaking: overrides.isTtsSpeaking ?? false,
    isTtsPaused: false,
    isTtsLoading: overrides.isTtsLoading ?? false,
    ttsError: overrides.ttsError ?? null,
    isTtsDegraded: false,
    setIsTtsSpeaking: vi.fn(),
    setIsTtsPaused: vi.fn(),
    utteranceRef: { current: null },
    ttsRafRef: { current: null },
    speakText: mockSpeakText,
    pauseTts: vi.fn(),
    resumeTts: vi.fn(),
    stopTts: mockStopTts,
  });
}

/**
 * Fetch dispatcher covering both endpoints LessonAudioTable calls:
 *   GET /api/stories?page_size=300      -> the list
 *   GET /api/stories/{id}               -> per-lesson detail (used to build
 *                                          the text passed to speakText)
 * Per-lesson detail responses are distinguishable by id so tests can assert
 * *which* lesson's text actually reached speakText().
 */
function mockFetchDispatcher(detailOverride?: (id: number) => Promise<unknown> | unknown) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.includes('/api/stories?')) {
      return Promise.resolve({ ok: true, json: async () => STORIES_RESPONSE });
    }
    const match = url.match(/\/api\/stories\/(\d+)$/);
    if (match) {
      const id = Number(match[1]);
      if (detailOverride) {
        return Promise.resolve(detailOverride(id)).then((body) => ({
          ok: true,
          json: async () => body,
        }));
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          paragraphs: [`lesson-${id}-text`],
          key_reading: { passage: `lesson-${id}-key` },
        }),
      });
    }
    return Promise.reject(new Error(`unexpected fetch url in test: ${url}`));
  }));
}

describe('LessonAudioTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTts();
    mockFetchDispatcher();
  });

  it('renders one row per lesson from the list response', async () => {
    render(<LessonAudioTable />);

    await waitFor(() => {
      expect(screen.getByText('贏得喝采的輸家')).toBeTruthy();
      expect(screen.getByText('閱讀策略練習')).toBeTruthy();
    });

    expect(screen.getAllByRole('row')).toHaveLength(STORIES_RESPONSE.total + 1);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/stories?page_size=300'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    );
  });

  it('marks only lessons without key_reading as 無重點段', async () => {
    render(<LessonAudioTable />);

    await waitFor(() => expect(screen.getByText('無重點段（唸全文）')).toBeTruthy());

    const rowWithKeyReading = screen.getByText('贏得喝采的輸家').closest('[role="row"]');
    const rowWithoutKeyReading = screen.getByText('閱讀策略練習').closest('[role="row"]');

    expect(rowWithKeyReading?.textContent).not.toContain('無重點段');
    expect(rowWithoutKeyReading?.textContent).toContain('無重點段（唸全文）');
  });

  it('builds QR values for intro and full-reading lesson routes', () => {
    const origin = 'https://staging.example.test';

    expect(buildLessonQrValue(origin, 1, 'intro')).toBe('https://staging.example.test/learn/1/intro');
    expect(buildLessonQrValue(origin, 1, 'full-reading')).toBe(
      'https://staging.example.test/learn/1/full-reading',
    );
  });

  // ── Bug #1 (#2622 follow-up): "不能停止" — the header stop button called a
  // property (`stopPlayback`) that does not exist on the hook's return value
  // (the real name is `stopTts`), so onClick was undefined and clicking it
  // did nothing. Mutation target: rename the destructure back to
  // `stopPlayback` and this test goes red because mockStopTts is never called.
  it('the header stop button calls the hook\'s stop function and returns the row to idle', async () => {
    const { rerender } = render(<LessonAudioTable />);
    await waitFor(() => screen.getByText('贏得喝采的輸家'));

    const row = screen.getByText('贏得喝采的輸家').closest('[role="row"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /播放全文/ }));
    await waitFor(() => expect(mockSpeakText).toHaveBeenCalledTimes(1));

    // Simulate the audio element actually starting to play, as the real
    // hook would report via isTtsSpeaking once the browser fires `onplay`.
    mockTts({ isTtsSpeaking: true });
    rerender(<LessonAudioTable />);
    expect(within(row).getByRole('button', { name: /停止/ })).toBeTruthy();

    // playLesson defensively calls stopTts() before every play (harmless
    // no-op when nothing was playing yet) — clear that call so this
    // assertion is specifically about the explicit stop click below.
    mockStopTts.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /停止播放/ }));
    expect(mockStopTts).toHaveBeenCalledTimes(1);

    // Once stopped, the hook reports idle again (isTtsSpeaking/isTtsLoading
    // both false) — the row must reflect that immediately, not keep showing
    // a "still working" spinner because it forgot which row it targeted.
    mockTts();
    rerender(<LessonAudioTable />);
    expect(within(row).queryByRole('button', { name: /停止/ })).toBeNull();
    expect(within(row).getByRole('button', { name: /播放全文/ })).toBeTruthy();
  });

  // Same guarantee, but via the row's own button (per the design goal: "a
  // per-row stop is better than a distant header button").
  it('clicking the row\'s own playing button stops it and returns the row to idle', async () => {
    const { rerender } = render(<LessonAudioTable />);
    await waitFor(() => screen.getByText('贏得喝采的輸家'));

    const row = screen.getByText('贏得喝采的輸家').closest('[role="row"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /播放全文/ }));
    await waitFor(() => expect(mockSpeakText).toHaveBeenCalledTimes(1));

    mockTts({ isTtsSpeaking: true });
    rerender(<LessonAudioTable />);
    const stopButton = within(row).getByRole('button', { name: /停止/ });

    mockStopTts.mockClear(); // see note above: clears playLesson's own defensive pre-play stop
    fireEvent.click(stopButton);
    expect(mockStopTts).toHaveBeenCalledTimes(1);

    mockTts();
    rerender(<LessonAudioTable />);
    expect(within(row).getByRole('button', { name: /播放全文/ })).toBeTruthy();
  });

  // ── Bug #2 (#2622 follow-up): "同時播其他的就會一堆聲音" — playingKey was
  // cleared in `finally` the instant speakText() returned (long before the
  // audio finishes), so every button re-enabled while the previous clip was
  // still playing and a second click layered a second <audio> on top with
  // nothing stopping the first. Mutation target: remove the `stopTts()` call
  // at the top of playLesson and this goes red — mockStopTts is never
  // called, and both lessons' text reach speakText with no stop in between.
  it('starting a second playback stops the first before speaking the new one', async () => {
    const { rerender } = render(<LessonAudioTable />);
    await waitFor(() => screen.getByText('贏得喝采的輸家'));

    const rowA = screen.getByText('贏得喝采的輸家').closest('[role="row"]') as HTMLElement;
    const rowB = screen.getByText('閱讀策略練習').closest('[role="row"]') as HTMLElement;

    const callOrder: string[] = [];
    mockSpeakText.mockImplementation((text: string) => callOrder.push(`speak:${text}`));
    mockStopTts.mockImplementation(() => callOrder.push('stop'));

    fireEvent.click(within(rowA).getByRole('button', { name: /播放全文/ }));
    await waitFor(() => expect(mockSpeakText).toHaveBeenCalledTimes(1));

    // Row A's audio is now "playing" as far as the hook is concerned — this
    // is the exact moment a second click used to layer more audio on top,
    // because the old code had already cleared its local playingKey and
    // re-enabled every button well before this point.
    mockTts({ isTtsSpeaking: true });
    rerender(<LessonAudioTable />);

    fireEvent.click(within(rowB).getByRole('button', { name: /播放全文/ }));
    await waitFor(() => expect(mockSpeakText).toHaveBeenCalledTimes(2));

    // playLesson calls stopTts() defensively before *every* play attempt
    // (the leading 'stop' below is that no-op on the very first click, when
    // nothing was playing yet); what this test actually guards is the
    // second 'stop', which lands between the two speak calls — i.e. lesson
    // 1's playback is stopped before lesson 89's text is ever spoken.
    expect(callOrder).toEqual(['stop', 'speak:lesson-1-text', 'stop', 'speak:lesson-89-text']);
  });

  // A newer selection must win even if the *older* selection's detail fetch
  // resolves later (out-of-order network responses) — otherwise switching
  // rows quickly could still start the stale lesson's audio after the new
  // one, re-creating the overlap bug through a different path than the
  // direct "click while already speaking" case above.
  it('ignores a stale detail-fetch response for a lesson that is no longer selected', async () => {
    const pending: Record<number, ReturnType<typeof deferred<unknown>>> = {
      1: deferred(),
      89: deferred(),
    };
    mockFetchDispatcher((id) => pending[id].promise);

    render(<LessonAudioTable />);
    await waitFor(() => screen.getByText('贏得喝采的輸家'));

    const rowA = screen.getByText('贏得喝采的輸家').closest('[role="row"]') as HTMLElement;
    const rowB = screen.getByText('閱讀策略練習').closest('[role="row"]') as HTMLElement;

    fireEvent.click(within(rowA).getByRole('button', { name: /播放全文/ }));
    fireEvent.click(within(rowB).getByRole('button', { name: /播放全文/ }));

    // Resolve the *older* request (lesson 1) after the newer one (lesson 89)
    // has already been selected.
    pending[1].resolve({ paragraphs: ['lesson-1-text'] });
    pending[89].resolve({ paragraphs: ['lesson-89-text'] });

    await waitFor(() => expect(mockSpeakText).toHaveBeenCalledTimes(1));
    expect(mockSpeakText).toHaveBeenCalledWith('lesson-89-text');
    expect(mockSpeakText).not.toHaveBeenCalledWith('lesson-1-text');
  });

  // The list-loading error screen (a full-page "載入失敗" replacement) and a
  // playback failure are different failure modes — a TTS/network error while
  // synthesising must not blow away the whole table.
  it('shows a playback error without replacing the loaded table', async () => {
    mockFetchDispatcher((id) => {
      if (id === 1) return Promise.reject(new Error('TTS 服務逾時'));
      return { paragraphs: [`lesson-${id}-text`] };
    });

    render(<LessonAudioTable />);
    await waitFor(() => screen.getByText('贏得喝采的輸家'));

    const rowA = screen.getByText('贏得喝采的輸家').closest('[role="row"]') as HTMLElement;
    fireEvent.click(within(rowA).getByRole('button', { name: /播放全文/ }));

    await waitFor(() => expect(screen.getByText(/TTS 服務逾時/)).toBeTruthy());
    // The table itself must still be there — this is not the full-page error state.
    expect(screen.getByText('閱讀策略練習')).toBeTruthy();
    expect(mockSpeakText).not.toHaveBeenCalled();
  });
});

describe('derivePlaybackState', () => {
  const KEY = '1:full';

  it('is idle when this key is not the one currently targeted', () => {
    expect(derivePlaybackState(KEY, null, false, false, false)).toBe('idle');
    expect(derivePlaybackState(KEY, '2:full', false, true, true)).toBe('idle');
  });

  it('is working while the lesson detail fetch is in flight', () => {
    expect(derivePlaybackState(KEY, KEY, /* isFetchingDetail */ true, false, false)).toBe('working');
  });

  it('is working while the hook is loading audio (post-detail, pre-first-byte)', () => {
    expect(derivePlaybackState(KEY, KEY, false, /* isTtsLoading */ true, false)).toBe('working');
  });

  it('is playing once the hook reports audio is actually speaking', () => {
    expect(derivePlaybackState(KEY, KEY, false, false, /* isTtsSpeaking */ true)).toBe('playing');
    // Speaking takes precedence even if isTtsLoading has not yet flipped off.
    expect(derivePlaybackState(KEY, KEY, false, true, true)).toBe('playing');
  });

  it('returns to idle on its own once playback finishes naturally, with no explicit reset', () => {
    // This is the state after a clip ends by itself: activeKey is still this
    // key (nothing told the component to clear it), but both hook flags have
    // dropped back to false — the row must not get stuck showing "working".
    expect(derivePlaybackState(KEY, KEY, false, false, false)).toBe('idle');
  });
});

describe('#2622 stop must actually silence the audio, not just the UI', () => {
  /**
   * Measured on staging 2026-08-08: clicking stop flipped the button back to
   * 「播放全文」while the clip kept going, currentTime advancing 13s → 18s → 41s.
   * Worse than the bug it replaced, because the screen then asserts something
   * false.
   *
   * Two earlier fixes aimed at handles the TTS layer exposes — utteranceRef and
   * ttsApi's _currentAudio — and both still missed the element that was
   * sounding. So the component now records the elements themselves, by patching
   * HTMLMediaElement.prototype.play while it is mounted. That the technique
   * reaches and stops the real element was verified in a browser on staging:
   * an element at p:false t:13 went to p:true t:0 and stayed there.
   *
   * This test drives that patch directly with a stub element rather than trying
   * to make jsdom play audio — jsdom has no playback, and three attempts to
   * simulate it failed for reasons that had nothing to do with the code under
   * test.
   */
  it('pauses every element that started playing while the panel was open', async () => {
    vi.clearAllMocks();
    mockFetchDispatcher();
    mockTts();

    const { rerender } = render(<LessonAudioTable />);
    await waitFor(() => screen.getByText('贏得喝采的輸家'));

    const row = screen.getByText('贏得喝采的輸家').closest('[role="row"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /播放全文/ }));
    await waitFor(() => expect(mockSpeakText).toHaveBeenCalledTimes(1));

    // Stand in for the <audio> the TTS layer creates: never in the document,
    // reachable only because the component patched the prototype's play().
    let paused = false;
    const pause = vi.fn(() => { paused = true; });
    const clip = {
      get paused() { return paused; },
      currentTime: 42,
      pause,
    } as unknown as HTMLMediaElement;
    HTMLMediaElement.prototype.play.call(clip);

    mockTts({ isTtsSpeaking: true });
    rerender(<LessonAudioTable />);

    fireEvent.click(screen.getByRole('button', { name: /停止播放/ }));

    expect(pause).toHaveBeenCalled();
    expect(clip.currentTime).toBe(0);
  });
});

describe('#2622 QR 交付表 CSV', () => {
  const stories = [
    { id: 1, lesson_number: 1, title: '贏得喝采的輸家', grade: 4, grade_code: 'G4-L01', char_count: 100, has_key_reading: true },
    // A title containing both a comma and a quote — editorial content will
    // eventually have them, and unquoted CSV silently shifts every later column.
    { id: 2, lesson_number: 2, title: '他說「快,再快」', grade: 8, grade_code: 'G8-L02', char_count: 90, has_key_reading: false },
  ];

  it('emits two rows per lesson, 全文 and 段落', () => {
    const rows = buildQrManifestRows(stories as never, 'https://x.test');
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.kind)).toEqual(['全文', '段落', '全文', '段落']);
    expect(rows[0].url).toBe('https://x.test/learn/1/intro');
    expect(rows[1].url).toBe('https://x.test/learn/1/full-reading');
    expect(rows[0].qr_file).toBe('intro-qr-L01.png');
    expect(rows[1].qr_file).toBe('full-reading-qr-L01.png');
  });

  it('quotes fields and leads with a BOM so Excel reads the Chinese correctly', () => {
    const csv = buildQrManifestCsv(buildQrManifestRows(stories as never, 'https://x.test'));

    expect(csv.startsWith('﻿')).toBe(true);
    // The comma inside the title must not create a column.
    expect(csv).toContain('"他說「快,再快」"');
    // Every line has the same field count as the header.
    const lines = csv.replace(/^﻿/, '').trimEnd().split('\r\n');
    const fieldCount = (line: string) => (line.match(/","/g) ?? []).length + 1;
    expect(new Set(lines.map(fieldCount)).size).toBe(1);
    expect(lines).toHaveLength(5); // header + 4 rows
  });
});
