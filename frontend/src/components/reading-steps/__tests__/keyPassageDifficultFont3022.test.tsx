/**
 * #3022 — KeyPassageReading (重點朗讀 / 念順順).
 *
 * The commit named this as one of the three converted call sites, but
 * reverting the whole file to origin/staging left 552/552 tests green:
 * there was no lock on either the per-run font wiring or the container
 * narrowing. This is that lock.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { DIFFICULT_SPAN_START, DIFFICULT_SPAN_END } from '../../zhuyin/bopomoConstants';

const wrap = (s: string) => `${DIFFICULT_SPAN_START}${s}${DIFFICULT_SPAN_END}`;

// KeyPassageReading reads exactly { token, user } from useAuth (line 76).
// Mocking only those keeps the fixture honest, and keeps the full context
// shape's credential-sounding field names -- all nulls, none of them secrets
// -- out of the file, where the repo's secret scanner reads them as findings.
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// 'difficult' mode: isZhuyinAny true, zhuyinActive false, and
// processLinesSelective marks the one vocab character.
vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    zhuyinMode: 'difficult', zhuyinReady: true,
    zhuyinActive: false, isZhuyinAny: true, isZhuyinAll: false, isZhuyinNone: false,
    zhuyinEnabled: true,
    setZhuyinMode: vi.fn(), setZhuyinEnabled: vi.fn(), toggleZhuyin: vi.fn(),
    processZhuyin: (t: string) => t,
    processLines: () => null,
    processLinesSelective: (lines: string[]) => lines.map((l) => l.replace('龍', wrap('龍'))),
  }),
  ZhuyinProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../context/KaraokeContext', () => ({
  useKaraoke: () => ({ karaokeEnabled: false, setKaraokeEnabled: vi.fn(), toggleKaraoke: vi.fn() }),
  KaraokeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/', search: '', hash: '', state: null, key: 'k' }),
  useParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  NavLink: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import KeyPassageReading from '../KeyPassageReading';

const STORY = {
  id: 1,
  title: '龍的傳說',
  content: ['小明看見龍就跑走了', '第二段沒有生字'],
  vocab: ['龍'],
  sentences: [],
  intro: { author: '作者', background: '背景' },
  thumbnail: '/t.jpg',
  category: 'Fable',
} as never;

const fontBearers = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('*')).filter((el) =>
    ((el as HTMLElement).style?.fontFamily ?? '').includes('BpmfZihiSerif'),
  );

// Browser APIs this step touches at mount (mirrors __smoke__/render-smoke).
beforeAll(() => {
  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
    writable: true,
    configurable: true,
  });
  (global as Record<string, unknown>).SpeechRecognition = undefined;
  (global as Record<string, unknown>).webkitSpeechRecognition = undefined;
  Object.defineProperty(global.window, 'speechSynthesis', {
    value: { getVoices: () => [], cancel: vi.fn(), speak: vi.fn(), pause: vi.fn(), resume: vi.fn() },
    writable: true,
    configurable: true,
  });
  global.URL.createObjectURL = vi.fn(() => 'blob:x');
  global.URL.revokeObjectURL = vi.fn();
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('#3022 KeyPassageReading applies the zhuyin font per run, not page-wide', () => {
  it('puts the font on the vocab character', () => {
    const { container } = render(
      <KeyPassageReading story={STORY} onFinish={vi.fn()} onBack={vi.fn()} />,
    );
    const bearers = fontBearers(container);
    expect(bearers.length, 'expected at least one element in the zhuyin font').toBeGreaterThan(0);
    expect(bearers.map((el) => el.textContent).join('')).toContain('龍');
  });

  it('never puts it on a container holding whole paragraphs or interface text', () => {
    const { container } = render(
      <KeyPassageReading story={STORY} onFinish={vi.fn()} onBack={vi.fn()} />,
    );
    for (const el of fontBearers(container)) {
      const t = el.textContent ?? '';
      expect(t.length, `a font-bearing element held "${t.slice(0, 30)}"`).toBeLessThanOrEqual(4);
      expect(t).not.toContain('小明');
      expect(t).not.toContain('第二段');
    }
  });

  it('markers never reach what the student sees or copies', () => {
    const { container } = render(
      <KeyPassageReading story={STORY} onFinish={vi.fn()} onBack={vi.fn()} />,
    );
    expect(container.textContent).not.toContain(DIFFICULT_SPAN_START);
    expect(container.textContent).not.toContain(DIFFICULT_SPAN_END);
  });
});
