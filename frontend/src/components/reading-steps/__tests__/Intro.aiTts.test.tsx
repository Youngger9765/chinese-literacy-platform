/**
 * Tests for Intro.tsx — #2607 AI 朗讀 button (Gemini TTS, full-text direction)
 *
 * REVISION HISTORY (see PR #2608 for the full story):
 *   v1 (commit cd4b5f7d, superseded): AI 朗讀 read only the short 課文簡介 teaser
 *       (story.lessonIntro.course_intro / story.intro.background) and deliberately
 *       did NOT pass lessonId/paragraphIdx, because that teaser text is not one of
 *       story.content's paragraphs.
 *   v2 (this file): real staging data showed 0/8 sampled lessons had actual
 *       course_intro data — all 8 fell back to intro.background, which is a
 *       hard-truncated ~103-char substring of the lesson body that cuts off
 *       mid-word (e.g. "…神仙不"). Reading that aloud as if it were a summary is
 *       wrong. AI 朗讀 now narrates the ACTUAL full lesson body (story.content),
 *       paragraph by paragraph, and a "展開看全文" panel shows the same text being
 *       narrated. Since story.content IS the canonical paragraph array, this
 *       version DOES pass lessonId + paragraphIdx per paragraph — the backend's
 *       sentence cache (GET /api/tts/mapping/{lessonId}) is keyed by exactly that
 *       index, so this is what lets each call hit the pre-generated cache instead
 *       of paying a live 8-15s synthesis every time.
 *
 * TDD-first protocol: written red against the (reverted) v1 implementation —
 * every test below either fails outright (button text is "AI 朗讀", not
 * "AI 朗讀全文") or fails because the v1 code never calls
 * GET /api/tts/mapping/{lessonId} at all. Green after the v2 rewire.
 *
 * Mocks fetch + Audio (same pattern as src/__tests__/ttsApi.test.ts) so
 * assertions exercise the REAL useTtsPlayback hook + ttsApi module — not a
 * re-implementation of the logic inside the test. Audio playback is driven
 * manually (via audioInstances[]), not auto-fired, so tests can distinguish
 * "paragraph finished naturally" from "user clicked stop mid-paragraph".
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Intro imports react-router-dom useNavigate — mock it
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    zhuyinActive: false,
    processZhuyin: (text: string) => text,
  }),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

vi.mock('../../../services/omoApi', () => ({
  getPriorOmoUploadByLesson: vi.fn().mockResolvedValue({ has_prior_upload: false }),
  getOmoImageSignedUrl: vi.fn(),
}));

vi.mock('../../../hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}));

vi.mock('../../../config/stepConfig', () => ({
  resolveActiveSteps: () => [
    { id: 'full-text-annotate', label: '做記號' },
    { id: 'paragraph-reading', label: '逐段朗讀' },
  ],
}));

import Intro from '../Intro';
import { Story } from '../../../types';
import { _testInternals as ttsApiTestInternals } from '../../../services/ttsApi';

const P0 = '第一段課文正文，內容是真的課文，不是簡介。';
const P1 = '第二段課文正文，緊接在第一段之後。';
// Deliberately different from anything real.split() would produce from P0/P1 —
// proves the backend's canonical mapping (not a frontend regex split) is what
// actually gets synthesised, and that paragraph 0 → mapping index 0, paragraph
// 1 → mapping index 1 (not swapped).
const CANON_P0 = 'CANON-SENTENCE-FOR-PARAGRAPH-0';
const CANON_P1 = 'CANON-SENTENCE-FOR-PARAGRAPH-1';

const LESSON_ID = 42;

const baseStory: Story = {
  id: String(LESSON_ID),
  title: '測試課文',
  level: '3',
  content: [P0, P1],
  thumbnail: '/test.jpg',
  category: 'Fable',
  filename: 'L01.yml',
  vocabulary: [],
  intro: {
    author: '測試作者',
    // Simulates the real-world hard-truncated fallback — must NOT be what gets narrated.
    background: '這是被截斷到一半的課文開頭，不應該被 AI 朗讀全文按鈕唸出來，因為它根本',
  },
  lessonIntro: {
    source: 'docx_explanation',
    text: '學習策略說明文字',
    course_intro: '', // 0/8 sampled lessons had real data — simulate the common case
  },
};

const MAPPING_RESPONSE = {
  lesson_id: LESSON_ID,
  paragraphs: [
    { index: 0, sentences: [{ text: CANON_P0, hash: 'h0', chars: CANON_P0.length }] },
    { index: 1, sentences: [{ text: CANON_P1, hash: 'h1', chars: CANON_P1.length }] },
  ],
};

// ── fetch + Audio mocks ──────────────────────────────────────────────────
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

  // Does NOT auto-fire onended — tests control timing explicitly via
  // audioInstances[n].onended?.() so "finished naturally" vs "user hit stop
  // before it finished" can be distinguished.
  play() {
    return Promise.resolve();
  }

  pause() {}
}

/** Default happy-path fetch mock: mapping GET succeeds, every synthesize POST succeeds. */
function defaultFetchImpl(url: string) {
  const urlStr = String(url);
  if (urlStr.includes('/api/tts/mapping/')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(MAPPING_RESPONSE),
    });
  }
  if (urlStr.includes('/api/tts/synthesize')) {
    return Promise.resolve({
      ok: true,
      blob: () => Promise.resolve(new Blob(['audio-bytes'], { type: 'audio/mpeg' })),
    });
  }
  return Promise.reject(new Error(`unexpected fetch: ${urlStr}`));
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
    value: {
      getVoices: () => [],
      cancel: vi.fn(),
      speak: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      onvoiceschanged: null,
    },
  });
  // useTtsPlayback's no-lessonId path warms up speechSynthesis synchronously
  // (inside the user gesture) BEFORE it fetches, by constructing a throwaway
  // utterance. jsdom has no SpeechSynthesisUtterance, so without this stub that
  // line throws and the fetch never runs — which looks exactly like "the button
  // did nothing". The v2 path returns before that warmup, so only tests that
  // exercise the fallback branch need it.
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
  // ttsApi.ts's _urlCache/_mappingCache are module-level singletons — clear
  // them between tests so a stale cache hit from a previous test's mock
  // response doesn't leak into the next test.
  ttsApiTestInternals.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every fetch call to /api/tts/synthesize, in order, with the request body text. */
function synthesizeCalls() {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes('/api/tts/synthesize'))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string).text as string);
}

function mappingCallCount() {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/tts/mapping/')).length;
}

describe('Intro AI 朗讀全文 — #2607 v2 (full lesson body, not the 課文簡介 teaser)', () => {
  it('renders "AI 朗讀全文" and "展開看全文" buttons (not the old teaser-only "AI 朗讀")', () => {
    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: /AI 朗讀全文/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /展開看全文/ })).toBeInTheDocument();
  });

  it('clicking "AI 朗讀全文" narrates paragraph 0 via the backend canonical-sentence cache — proves lessonId + paragraphIdx=0 resolve to story.content[0], not the 課文簡介 teaser', async () => {
    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀全文/ }));

    await waitFor(() => expect(mappingCallCount()).toBeGreaterThan(0));
    const [mappingUrl] = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/tts/mapping/'))!;
    expect(String(mappingUrl)).toContain(`/api/tts/mapping/${LESSON_ID}`);

    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0]));
  });

  it('falls back to speaking the ACTUAL paragraph text (story.content), never the 課文簡介 teaser, when the lesson has no canonical mapping entry', async () => {
    // No mocked mapping response can hide a bug here: when the canonical
    // lookup misses, ttsApi.ts falls back to regex-splitting whatever `text`
    // was actually passed to speakText() — so THIS is the path that proves the
    // real story.content paragraph (not introText) is what's threaded through,
    // independent of paragraphIdx/lessonId being correct.
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/tts/mapping/')) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
      }
      return defaultFetchImpl(url);
    });

    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀全文/ }));

    await waitFor(() => expect(synthesizeCalls()).toHaveLength(1));
    expect(synthesizeCalls()).toEqual([P0]);
    expect(synthesizeCalls()[0]).not.toContain('這是被截斷');
  });

  it('auto-advances to paragraph 1 when paragraph 0 finishes naturally, reusing the cached mapping (only ONE GET to /api/tts/mapping)', async () => {
    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀全文/ }));

    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0]));
    expect(mappingCallCount()).toBe(1);

    // Paragraph 0's audio finishes on its own (not a user-initiated stop).
    act(() => { audioInstances[0].onended?.(); });

    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0, CANON_P1]));
    // Second paragraph's lookup hit the cache populated by the first call — no 2nd GET.
    expect(mappingCallCount()).toBe(1);
  });

  it('returns to the idle "AI 朗讀全文" button after the last paragraph finishes', async () => {
    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀全文/ }));
    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0]));

    act(() => { audioInstances[0].onended?.(); });
    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0, CANON_P1]));

    act(() => { audioInstances[1].onended?.(); });
    await waitFor(() => expect(screen.getByRole('button', { name: /AI 朗讀全文/ })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /停止朗讀/ })).not.toBeInTheDocument();
  });

  it('auto-expands "展開看全文" when playback starts, showing story.content (not the 課文簡介 teaser)', async () => {
    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByText(P0)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀全文/ }));

    await waitFor(() => expect(screen.getByText(P0)).toBeInTheDocument());
    expect(screen.getByText(P1)).toBeInTheDocument();
  });

  it('"展開看全文" can be toggled closed manually', async () => {
    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /展開看全文/ }));
    expect(await screen.findByText(P0)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /收合全文/ }));
    expect(screen.queryByText(P0)).not.toBeInTheDocument();
  });

  it('the stop/cancel button stays ENABLED while loading (cold cache can take 8-15s — the user must be able to cancel, not be stuck waiting)', async () => {
    // Mapping fetch never resolves within this test — simulates the worst-case
    // cold-cache wait. isTtsLoading stays true the whole time.
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/tts/mapping/')) {
        return new Promise(() => {}); // never resolves
      }
      return defaultFetchImpl(url);
    });

    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀全文/ }));

    // Accessible name in the loading sub-state is 「AI 朗讀準備中，點擊取消」;
    // it becomes 「停止朗讀」 once playback actually starts.
    const cancelButton = await screen.findByRole('button', { name: /停止朗讀|準備中/ });
    expect(cancelButton).not.toBeDisabled();

    fireEvent.click(cancelButton);
    await waitFor(() => expect(screen.getByRole('button', { name: /AI 朗讀全文/ })).toBeInTheDocument());
  });

  it('clicking 停止朗讀 mid-paragraph prevents any further /api/tts/synthesize call — the queue does not advance after an explicit stop', async () => {
    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀全文/ }));
    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0]));

    // Stop BEFORE paragraph 0's audio ever fires onended — i.e. mid-playback,
    // not "the paragraph happened to finish right as I clicked".
    const stopButton = await screen.findByRole('button', { name: /停止朗讀/ });
    fireEvent.click(stopButton);

    await waitFor(() => expect(screen.getByRole('button', { name: /AI 朗讀全文/ })).toBeInTheDocument());

    // Even if the (now-stale) audio element fires onended late — e.g. a real
    // browser delivering a queued event after .pause() — the queue must NOT
    // treat that as "paragraph finished, advance to the next one".
    act(() => { audioInstances[0].onended?.(); });
    await new Promise((r) => setTimeout(r, 0));

    expect(synthesizeCalls()).toEqual([CANON_P0]); // never a 2nd call for CANON_P1
    expect(screen.getByRole('button', { name: /AI 朗讀全文/ })).toBeInTheDocument();
  });

  it('a TTS error aborts the sequence (does not advance to the next paragraph) and shows an alert', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/tts/mapping/')) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
      }
      if (String(url).includes('/api/tts/synthesize')) {
        return Promise.resolve({ ok: false, status: 503, blob: () => Promise.resolve(new Blob([])) });
      }
      return Promise.reject(new Error('unexpected fetch'));
    });

    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀全文/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/./); // non-empty error message shown

    // setTtsError (from .catch) and setIsTtsSpeaking(false)/activeParagraphIdx
    // reset (from .finally + the ttsError-abort effect) land in separate
    // microtask-driven renders, not one atomic batch — the alert can appear a
    // tick before the button visually settles back to idle. waitFor lets that
    // settle instead of asserting a synchronous-render guarantee that was never
    // actually part of the design (the important guarantee is "eventually
    // idle, never advances" — proven below).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /AI 朗讀全文/ })).toBeInTheDocument();
    });
    // Paragraph 0's synthesize attempt happened (and failed, since mapping also
    // 404'd so it fell back to a regex-split of the raw text) — that's expected.
    // What must NOT happen is a SECOND attempt for paragraph 1.
    expect(synthesizeCalls()).toHaveLength(1);
  });

  it('unmounting Intro while playing stops the audio (speechSynthesis.cancel invoked during cleanup)', async () => {
    const { unmount } = render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀全文/ }));
    await waitFor(() => expect(synthesizeCalls()).toEqual([CANON_P0]));

    unmount();

    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });

  it('clicking 開始學習 stops playback and still invokes onStartReading (existing navigation contract preserved)', async () => {
    const onStartReading = vi.fn();
    render(<Intro story={baseStory} onStartReading={onStartReading} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀全文/ }));
    await screen.findByRole('button', { name: /停止朗讀/ });

    fireEvent.click(screen.getByRole('button', { name: /開始學習/ }));
    expect(onStartReading).toHaveBeenCalledOnce();
  });

  // ── Review findings (PR #2608 independent review) ────────────────────────

  it('falls back to the 課文簡介 text when story.content is empty — and must NOT pair it with lessonId/paragraphIdx, because that text is not a canonical paragraph', async () => {
    // Today api.ts always populates story.content from detail.paragraphs, so this
    // fallback is unreachable — but speakParagraphAt passed lessonId+idx
    // unconditionally, so if a lesson ever arrives with empty paragraphs the
    // canonical cache would be asked for "paragraph 0" of a text that isn't one,
    // and play back unrelated audio. That is exactly the bug v1 (cd4b5f7d)
    // reasoned about and avoided; this locks it for the fallback branch too.
    const noContentStory: Story = { ...baseStory, content: [], paragraphs: [] };

    render(<Intro story={noContentStory} onStartReading={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀全文/ }));

    await waitFor(() => expect(synthesizeCalls().length).toBeGreaterThan(0));

    // It speaks the teaser text (that's all there is)…
    expect(synthesizeCalls()[0]).toContain('這是被截斷');
    // …but never consults the canonical mapping, because no paragraphIdx applies.
    expect(mappingCallCount()).toBe(0);
  });

  it('announces the loading sub-state to screen readers, not only visually', async () => {
    // Sighted users get three distinguishable states (idle / spinner+「AI 朗讀中…」/
    // 「停止朗讀」). With a hardcoded aria-label, AT users only got two.
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/tts/mapping/')) {
        return new Promise(() => {}); // never resolves — hold isTtsLoading true
      }
      return defaultFetchImpl(url);
    });

    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀全文/ }));

    // While loading, the accessible name must say it is preparing AND still
    // offer the cancel affordance — not claim playback already started.
    const loadingButton = await screen.findByRole('button', { name: /準備中/ });
    expect(loadingButton).toHaveAttribute('aria-busy', 'true');
    expect(loadingButton).not.toBeDisabled();
    // The plain "停止朗讀" name belongs to the speaking state only.
    expect(screen.queryByRole('button', { name: /^停止朗讀$/ })).toBeNull();
  });
});
