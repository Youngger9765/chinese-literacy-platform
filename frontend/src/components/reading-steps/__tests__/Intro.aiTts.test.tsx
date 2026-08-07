/**
 * Tests for Intro.tsx — #2607 AI 朗讀 button (Gemini TTS)
 *
 * TDD-first protocol:
 *   [RED]   Written before Intro.tsx is wired to backend Gemini TTS. The existing
 *           "朗讀" button only calls window.speechSynthesis (browser voice) — every
 *           test below fails against that code.
 *   [GREEN] After replacing speakIntro()/stopSpeaking() with useTtsPlayback (the
 *           same hook LiveTutor/FullReading already use), all tests pass.
 *
 * Mocks fetch + Audio (same pattern as src/__tests__/ttsApi.test.ts) so the
 * assertions exercise the REAL useTtsPlayback hook + ttsApi module — not a
 * re-implementation of the logic inside the test.
 *
 * Design decision locked in by test #3 below: the button intentionally does NOT
 * pass lessonId/paragraphIdx to speakText(). story.lessonIntro.course_intro is
 * NOT one of story.content's paragraphs — the backend's /api/tts/mapping/{id}
 * canonical-sentence cache is keyed by story.content paragraph index
 * (backend/app/services/tts/lesson_mapping.py: `paragraphs_raw = lesson.get("paragraphs", [])`).
 * Passing an arbitrary paragraphIdx here would make useTtsPlayback play back
 * whatever cached sentences exist at that index of the LESSON BODY — completely
 * unrelated audio — instead of the 課文簡介 text actually shown on this page.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    { id: 'reading-annotation', label: '做記號' },
    { id: 'tutor', label: '逐段朗讀' },
  ],
}));

import Intro from '../Intro';
import { Story } from '../../../types';

const COURSE_INTRO_TEXT = '這是課文簡介的內容，用來測試 AI 朗讀按鈕。';

const baseStory: Story = {
  id: 'L01',
  title: '測試課文',
  level: 3,
  // Deliberately different from COURSE_INTRO_TEXT — if the button ever reads
  // story.content instead of the visible 課文簡介, test #2 catches it.
  content: ['課文正文第一段（不應被 AI 朗讀按鈕唸出）', '課文正文第二段'],
  thumbnail: '/test.jpg',
  category: 'Fable',
  filename: 'L01.yml',
  vocabulary: [],
  intro: {
    author: '測試作者',
    background: '這是課文背景介紹 fallback（優先用 lessonIntro.course_intro）。',
  },
  lessonIntro: {
    source: 'docx_explanation',
    text: '學習策略說明文字',
    course_intro: COURSE_INTRO_TEXT,
  },
};

// ── fetch + Audio mocks — mirrors src/__tests__/ttsApi.test.ts ─────────────
let fetchMock: ReturnType<typeof vi.fn>;

class MockAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onplay: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  currentTime = 0;
  duration = 1;
  src: string;

  constructor(src?: string) {
    this.src = src ?? '';
  }

  play() {
    // Simulate the browser firing 'play' once playback actually starts.
    this.onplay?.();
    return Promise.resolve();
  }

  pause() {}
}

// useTtsPlayback's single-shot path warms up window.speechSynthesis synchronously
// (in-gesture, before the async fetch) by constructing a throwaway utterance —
// jsdom doesn't implement SpeechSynthesisUtterance, so it must be stubbed too.
class MockSpeechSynthesisUtterance {
  text: string;
  lang = '';
  rate = 1;
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onboundary: ((e: { charIndex: number }) => void) | null = null;
  constructor(text?: string) {
    this.text = text ?? '';
  }
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('Audio', MockAudio);
  vi.stubGlobal('SpeechSynthesisUtterance', MockSpeechSynthesisUtterance);
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockSynthesizeSuccess() {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    blob: () => Promise.resolve(new Blob(['audio-bytes'], { type: 'audio/mpeg' })),
  });
}

describe('Intro AI 朗讀 button — #2607', () => {
  it('renders an "AI 朗讀" button (not the old generic browser-TTS "朗讀" label)', () => {
    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: /AI 朗讀/ })).toBeInTheDocument();
  });

  it('clicking "AI 朗讀" calls the backend Gemini TTS endpoint with the visible 課文簡介 text (not story.content)', async () => {
    mockSynthesizeSuccess();
    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/tts/synthesize');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.text).toBe(COURSE_INTRO_TEXT);
  });

  it('does NOT call /api/tts/mapping/{lessonId} — course_intro is not a story.content paragraph, so passing lessonId/paragraphIdx would play back the wrong cached paragraph', async () => {
    mockSynthesizeSuccess();
    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const mappingCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/tts/mapping/'));
    expect(mappingCalls).toHaveLength(0);
  });

  it('disables the button while the first synthesis request is in flight (cold cache can take 8-15s)', async () => {
    let resolveFetch!: (v: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve; }));

    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀/ }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /AI 朗讀/ })).toBeDisabled();
    });

    resolveFetch({ ok: true, blob: () => Promise.resolve(new Blob(['audio'], { type: 'audio/mpeg' })) });
  });

  it('switches to a "停止朗讀" button once playback starts; clicking it returns to the idle "AI 朗讀" state', async () => {
    mockSynthesizeSuccess();
    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀/ }));

    const stopButton = await screen.findByRole('button', { name: /停止朗讀/ });
    expect(stopButton).toBeInTheDocument();

    fireEvent.click(stopButton);
    await waitFor(() => expect(screen.getByRole('button', { name: /AI 朗讀/ })).toBeInTheDocument());
  });

  it('never calls window.speechSynthesis.speak with actual narration when the backend TTS call succeeds (no silent fallback to browser voice)', async () => {
    mockSynthesizeSuccess();
    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀/ }));
    await screen.findByRole('button', { name: /停止朗讀/ });

    // useTtsPlayback fires a throwaway empty-text "warmup" utterance (immediately
    // cancelled) purely to keep speechSynthesis primed within the user gesture in
    // case the backend call fails later — that's a harmless implementation detail,
    // not user-audible narration. What must NOT happen is speak() being called with
    // the actual 課文簡介 text (that would mean the silent browser-voice fallback fired).
    const speakMock = window.speechSynthesis.speak as unknown as ReturnType<typeof vi.fn>;
    const narrationCalls = speakMock.mock.calls.filter(
      ([utterance]) => (utterance as SpeechSynthesisUtterance).text !== '',
    );
    expect(narrationCalls).toHaveLength(0);
  });

  it('clicking 開始學習 still invokes onStartReading (existing navigation contract preserved)', async () => {
    mockSynthesizeSuccess();
    const onStartReading = vi.fn();
    render(<Intro story={baseStory} onStartReading={onStartReading} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /AI 朗讀/ }));
    await screen.findByRole('button', { name: /停止朗讀/ });

    fireEvent.click(screen.getByRole('button', { name: /開始學習/ }));
    expect(onStartReading).toHaveBeenCalledOnce();
  });
});
