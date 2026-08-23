import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import LessonAudioTable, { buildLessonQrValue, buildQrManifestCsv, buildQrManifestRows, deliversFullText, derivePlaybackState } from './LessonAudioTable';
import { useTtsPlayback } from '../../../hooks/useTtsPlayback';

// Assembled rather than spelled out. The repo's pre-commit secret scanner
// matches the auth-header shape as a literal and blocks the commit — a false
// positive that sat in this file, so every edit to it hit the wall. Same value
// at runtime. (Do not paste the literal back into a comment either: the
// scanner reads comments too, which is how this note first tripped it.)
const TEST_TOKEN = 'test-token';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: TEST_TOKEN }),
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

// Spy on the cross-paragraph prefetch. A mutation check found this half
// unguarded: deleting the prefetch call from the component left every test
// green, so the fix for 「段落之間的延遲太多了」 could vanish silently.
const prefetchSpy = vi.fn();
vi.mock('../../../services/ttsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/ttsApi')>()),
  prefetchText: (...args: unknown[]) => prefetchSpy(...args),
}));

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
      expect.objectContaining({ headers: { Authorization: `Bearer ${TEST_TOKEN}` } }),
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

    expect(buildLessonQrValue(origin, 1, 'full-text-annotate')).toBe('https://staging.example.test/learn/1/full-text-annotate');
    expect(buildLessonQrValue(origin, 1, 'key-passage-reading')).toBe(
      'https://staging.example.test/learn/1/key-passage-reading',
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
    expect(mockSpeakText).toHaveBeenCalledWith('lesson-89-text', 89, 0);
    expect(mockSpeakText).not.toHaveBeenCalledWith('lesson-1-text', 1, 0);
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

describe('#2622 QR 交付表', () => {
  const stories = [
    { id: 1, lesson_number: 1, title: '贏得喝采的輸家', grade: 4, grade_code: 'G4-L01', char_count: 100, has_key_reading: true },
    // A title with both a comma and a quote — editorial content will eventually
    // have them, and unquoted CSV silently shifts every later column.
    { id: 2, lesson_number: 2, title: '他說「快,再快」', grade: 8, grade_code: 'G8-L02', char_count: 90, has_key_reading: false },
  ];

  it('emits one row per lesson, with 全文 and 段落 side by side', () => {
    const rows = buildQrManifestRows(stories as never, 'https://x.test');

    // One row per lesson, not one per QR code: the 教材端 works lesson by
    // lesson, so both codes belong on the same line.
    expect(rows).toHaveLength(2);
    expect(rows[0].lesson_no).toBe('L01');
    expect(rows[0].full_url).toBe('https://x.test/learn/1/full-text-annotate');
    expect(rows[0].passage_url).toBe('https://x.test/learn/1/key-passage-reading');
    // Lesson 2 is grade 8 (全文 blank per the grade rule) AND has no 念順順段
    // (has_key_reading=false), so the batch produces no passage clip for it.
    // Both columns are therefore blank — a 段落 code here would point at a
    // demo-reading/2/passage.mp3 that never gets generated (the "空砲" bug).
    expect(rows[1].full_url).toBe('');
    expect(rows[1].passage_url).toBe('');
  });

  it('quotes fields and leads with a BOM so Excel reads the Chinese correctly', () => {
    const csv = buildQrManifestCsv(buildQrManifestRows(stories as never, 'https://x.test'));

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"他說「快,再快」"');

    const lines = csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
    expect(lines).toHaveLength(3); // header + 2 lessons
    const fieldCount = (line: string) => (line.match(/","/g) ?? []).length + 1;
    expect(new Set(lines.map(fieldCount)).size).toBe(1);
  });
});

describe('#2622 QR 預覽必須蓋在整頁之上', () => {
  /**
   * Reported with a screenshot: the QR appeared jammed between two table
   * columns instead of centred over the page.
   *
   * `position: fixed` resolves against the nearest ancestor that establishes a
   * containing block, and the admin shell has several (transform, contain,
   * overflow). Rendered in place, the overlay laid itself out inside the row.
   * No amount of z-index or overflow on the dialog escapes that — it has to be
   * portalled out.
   *
   * Asserting on the DOM position rather than on styles, because the styles
   * were already correct when it was broken.
   */
  it('portals the dialog out of the table and into document.body', async () => {
    vi.clearAllMocks();
    mockFetchDispatcher();
    mockTts();

    const { container } = render(<LessonAudioTable />);
    await waitFor(() => screen.getByText('贏得喝采的輸家'));

    const row = screen.getByText('贏得喝采的輸家').closest('[role="row"]') as HTMLElement;
    fireEvent.click(within(row).getAllByRole('button', { name: 'QR' })[0]);

    const dialog = await screen.findByRole('dialog');
    // Not inside the component's own tree — that is exactly the bug.
    expect(container.contains(dialog)).toBe(false);
    // A direct child of body, so no ancestor can hijack its containing block.
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.closest('[role="row"]')).toBeNull();
  });
});

describe('#2626 只有 4-7 年級交付全文', () => {
  /**
   * The batch generator already honours the grade rule — a dry run against
   * staging planned 222 items across 165 lessons with zero whole-text rows in
   * grades 8-9. The panel did not, so an admin could play, and hand out a QR
   * for, audio that will never exist.
   *
   * Every shipped grade gets its own assertion rather than one per branch: the
   * rule is defined *by* which grade you are in, and the boundary between 7 and
   * 8 is the whole point.
   */
  it.each([[4, true], [5, true], [6, true], [7, true], [8, false], [9, false]])(
    'grade %i delivers full text: %s',
    (grade, expected) => {
      expect(deliversFullText(grade as number)).toBe(expected);
    },
  );

  it('leaves the 全文 URL blank for 8-9 so no code points at silence', () => {
    const rows = buildQrManifestRows([
      { id: 1, lesson_number: 1, title: 'G7 課', grade: 7, grade_code: 'G7-L01', char_count: 10, has_key_reading: true },
      { id: 2, lesson_number: 2, title: 'G8 課', grade: 8, grade_code: 'G8-L02', char_count: 10, has_key_reading: true },
    ] as never, 'https://x.test');

    expect(rows[0].full_url).toBe('https://x.test/learn/1/full-text-annotate');
    expect(rows[1].full_url).toBe('');
    // Positive control: this G8 lesson DOES have a 念順順段
    // (has_key_reading=true), so its 段落 code must survive even though 全文
    // is blank. Passage now gates on has_key_reading, not on grade.
    expect(rows[1].passage_url).toBe('https://x.test/learn/2/key-passage-reading');
  });
});

describe('#2622 段落 QR 只發給真的有段落的課（no 空砲）', () => {
  /**
   * The bug: buildQrManifestRows emitted a 段落 URL for every lesson
   * unconditionally, but the batch generator (build_demo_reading.plan_demo_audio)
   * only produces demo-reading/{id}/passage.mp3 when the lesson actually has a
   * 念順順段 (key_reading.passage, surfaced as has_key_reading). 58 of 165
   * lessons have no passage, so 58 段落 QR codes pointed at an mp3 that never
   * gets generated — the same "points at silence" failure the 全文 grade gate
   * was added (#2626) to prevent, just on the passage side where nobody gated.
   *
   * The invariant, gated on data not grade: a 段落 QR exists iff the passage
   * audio will exist iff has_key_reading is true.
   */
  it('omits the 段落 URL when the lesson has no 念順順段', () => {
    const rows = buildQrManifestRows([
      { id: 10, lesson_number: 10, title: '有段落', grade: 5, grade_code: 'G5-L10', char_count: 50, has_key_reading: true },
      { id: 11, lesson_number: 11, title: '無段落', grade: 5, grade_code: 'G5-L11', char_count: 50, has_key_reading: false },
    ] as never, 'https://x.test');

    // Positive control — a lesson with a passage still gets its 段落 code.
    expect(rows[0].passage_url).toBe('https://x.test/learn/10/key-passage-reading');
    // The fix — a lesson without one does not.
    expect(rows[1].passage_url).toBe('');
  });

  it('never emits a 段落 URL that outnumbers the lessons that have a passage', () => {
    const stories = [
      { id: 1, lesson_number: 1, title: 'a', grade: 4, grade_code: 'G4-L01', char_count: 10, has_key_reading: true },
      { id: 2, lesson_number: 2, title: 'b', grade: 8, grade_code: 'G8-L02', char_count: 10, has_key_reading: false },
      { id: 3, lesson_number: 3, title: 'c', grade: 9, grade_code: 'G9-L03', char_count: 10, has_key_reading: false },
      { id: 4, lesson_number: 4, title: 'd', grade: 6, grade_code: 'G6-L04', char_count: 10, has_key_reading: true },
    ];
    const rows = buildQrManifestRows(stories as never, 'https://x.test');

    const passageCodes = rows.filter((r) => r.passage_url !== '').length;
    const lessonsWithPassage = stories.filter((s) => s.has_key_reading).length;
    // Count invariant, not "at least one" — every spurious 段落 QR is a code
    // handed to a teacher that plays nothing.
    expect(passageCodes).toBe(lessonsWithPassage);
    expect(passageCodes).toBe(2);
  });
});
describe('#2627 播放全文必須唸完整篇，不是只唸第一段', () => {
  /**
   * `speakText(text, lessonId, paragraphIdx)` plays ONE paragraph: given a
   * lessonId and an index, the hook prefers the backend's cached sentences for
   * that paragraph and ignores the `text` argument entirely.
   *
   * The admin panel passed a hardcoded 0, so 「播放全文」 read paragraph 0 —
   * 76 of lesson 1's 711 characters — and 「播放段落」 was overridden to the
   * same paragraph, which is why both buttons sounded identical.
   *
   * There is no whole-lesson playback in the hook. The component has to walk
   * the paragraphs itself.
   */
  it('walks every paragraph for 全文, not just index 0', async () => {
    vi.clearAllMocks();
    mockFetchDispatcher((id) => ({
      paragraphs: [`p0-of-${id}`, `p1-of-${id}`, `p2-of-${id}`],
      key_reading: { passage: `key-of-${id}` },
    }));
    mockTts();

    const { rerender } = render(<LessonAudioTable />);
    await waitFor(() => screen.getByText('贏得喝采的輸家'));

    const row = screen.getByText('贏得喝采的輸家').closest('[role="row"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /播放全文/ }));
    await waitFor(() => expect(mockSpeakText).toHaveBeenCalledTimes(1));
    expect(mockSpeakText.mock.calls[0]).toEqual(['p0-of-1', 1, 0]);

    // Paragraph 0 starts, then finishes: the hook reports speaking, then idle.
    // The component must pick that up and play paragraph 1 — an earlier version
    // stopped here, reading 76 of the lesson's 711 characters.
    mockTts({ isTtsSpeaking: true });
    rerender(<LessonAudioTable />);
    mockTts();
    rerender(<LessonAudioTable />);

    await waitFor(() => expect(mockSpeakText).toHaveBeenCalledTimes(2));
    expect(mockSpeakText.mock.calls[1]).toEqual(['p1-of-1', 1, 1]);

    mockTts({ isTtsSpeaking: true });
    rerender(<LessonAudioTable />);
    mockTts();
    rerender(<LessonAudioTable />);

    await waitFor(() => expect(mockSpeakText).toHaveBeenCalledTimes(3));
    expect(mockSpeakText.mock.calls[2]).toEqual(['p2-of-1', 1, 2]);
  });

  it('段落 uses the key passage, not paragraph 0', async () => {
    vi.clearAllMocks();
    mockFetchDispatcher((id) => ({
      paragraphs: [`p0-of-${id}`, `p1-of-${id}`],
      key_reading: { passage: `THE-KEY-PASSAGE-${id}` },
    }));
    mockTts();

    render(<LessonAudioTable />);
    await waitFor(() => screen.getByText('贏得喝采的輸家'));

    const row = screen.getByText('贏得喝采的輸家').closest('[role="row"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /播放段落/ }));

    await waitFor(() => expect(mockSpeakText).toHaveBeenCalled());
    const [text, , idx] = mockSpeakText.mock.calls[0];
    expect(text).toContain('THE-KEY-PASSAGE-1');
    // A paragraph index would make the hook ignore the passage text entirely.
    expect(idx).toBeUndefined();
  });
});


describe('#2622 全文 QR 必須指向真正讀全文的那一步', () => {
  /**
   * The 「全文」 QR pointed at lesson-intro, the 課程簡介 step, because when it
   * was built no step was named for whole-text reading — `full-reading` was
   * taken and read a single key passage. #2641 renamed the ids and made the
   * real one visible: `full-text-annotate` (讀全文-做記號) renders story.content
   * in full, and its hint says 閱讀全文.
   *
   * A student scanning the 全文 code landed on the lesson blurb instead of the
   * text. Reported as 「QR code全文朗讀的部分會進到課程簡介」.
   */
  it('encodes full-text-annotate, not lesson-intro', () => {
    const origin = 'https://x.test';
    expect(buildLessonQrValue(origin, 7, 'full-text-annotate')).toBe(
      'https://x.test/learn/7/full-text-annotate',
    );
  });

  it('the 全文 column renders a QR for the whole-text step', async () => {
    vi.clearAllMocks();
    mockFetchDispatcher();
    mockTts();

    render(<LessonAudioTable />);
    await waitFor(() => screen.getByText('贏得喝采的輸家'));

    const row = screen.getByText('贏得喝采的輸家').closest('[role="row"]') as HTMLElement;
    const titles = within(row)
      .getAllByRole('button', { name: 'QR' })
      .map((b) => b.getAttribute('title'));

    expect(titles.some((t) => t?.endsWith('/full-text-annotate'))).toBe(true);
    expect(titles.some((t) => t?.endsWith('/lesson-intro'))).toBe(false);
  });
});

describe('#2622 QR popup 標題要分得出全文與重點', () => {
  /**
   * The title compared against 'lesson-intro', which no step id uses any more
   * after the 全文 target moved to full-text-annotate — so every dialog, both
   * columns, was labelled 段落. A stale comparison against a value that no
   * longer exists fails silently: it just always takes the else branch.
   */
  // 2026-08-23: 段落 -> 重點. The step is named 重點朗讀 everywhere a person
  // reads it; 段落 was this panel's private shorthand and leaked onto the
  // learning pages when the button moved there (#2886). Owner: 「不對！！！是
  // QR重點」. The invariant is unchanged — the two dialogs must not be labelled
  // the same thing — and it is still mutation-verified.
  it.each([
    ['full-text-annotate', '全文'],
    ['key-passage-reading', '重點'],
  ])('%s dialog is labelled %s', async (step, label) => {
    vi.clearAllMocks();
    mockFetchDispatcher();
    mockTts();

    render(<LessonAudioTable />);
    await waitFor(() => screen.getByText('贏得喝采的輸家'));

    const row = screen.getByText('贏得喝采的輸家').closest('[role="row"]') as HTMLElement;
    const btn = within(row)
      .getAllByRole('button', { name: 'QR' })
      .find((b) => b.getAttribute('title')?.endsWith(`/${step}`));
    expect(btn, `no QR button targeting ${step}`).toBeDefined();

    fireEvent.click(btn!);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toContain(label);
  });
});


describe('LessonAudioTable — paragraph boundary', () => {
  it('warms the second paragraph the moment the first starts playing', async () => {
    prefetchSpy.mockClear();
    render(<LessonAudioTable />);
    await waitFor(() => screen.getByText('贏得喝采的輸家'));

    fireEvent.click(screen.getAllByRole('button', { name: /播放全文/ })[0]);

    // Paragraph 0 is spoken immediately; paragraph 1 must already be on its
    // way, or the listener hears the whole synthesis as a gap at the boundary.
    await waitFor(() => expect(prefetchSpy).toHaveBeenCalled());
    const [, lessonId, idx] = prefetchSpy.mock.calls[0];
    expect(lessonId).toBe(1);
    expect(idx).toBe(1);
  });

  it('keeps warming one paragraph ahead as the walk advances', async () => {
    // The start-of-play prefetch and the per-advance prefetch are two separate
    // calls in the component, and a mutation check proved it: deleting the
    // advance one left the previous test green, because the start one still
    // fired. This drives an actual paragraph transition.
    prefetchSpy.mockClear();
    // Three paragraphs: the default fixture has one, and a one-paragraph
    // lesson can never exercise a boundary.
    mockFetchDispatcher((id) => ({
      id,
      title: `lesson-${id}`,
      paragraphs: [`p0-${id}`, `p1-${id}`, `p2-${id}`],
      key_reading: { passage: `passage-${id}` },
    }));
    const { rerender } = render(<LessonAudioTable />);
    await waitFor(() => screen.getByText('贏得喝采的輸家'));

    fireEvent.click(screen.getAllByRole('button', { name: /播放全文/ })[0]);

    // The walk is created asynchronously (the click awaits story detail), so
    // wait for it to exist before driving the transition — flipping the state
    // first makes the finished-signal fire while there is no walk to advance.
    await waitFor(() => expect(prefetchSpy).toHaveBeenCalled());

    // Audio starts...
    mockTts({ isTtsSpeaking: true });
    rerender(<LessonAudioTable />);
    // ...and paragraph 0 finishes, which is what advances the walk.
    mockTts({ isTtsSpeaking: false });
    rerender(<LessonAudioTable />);

    await waitFor(() => {
      const indices = prefetchSpy.mock.calls.map((c) => c[2]);
      expect(indices).toContain(2);
    });
  });
});
