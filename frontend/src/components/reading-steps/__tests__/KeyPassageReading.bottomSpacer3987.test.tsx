/**
 * Regression lock for #3987 UI-4: `pb-48` left too little clearance under
 * the fixed bottom controls (AI朗讀/開始朗讀, or the speed-picker row above
 * them) so the passage's last line could sit under them. Bumped to `pb-56`.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// KeyPassageReading reads exactly { token, user } from useAuth.
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    zhuyinMode: 'off', zhuyinReady: true,
    zhuyinActive: false, isZhuyinAny: false, isZhuyinAll: false, isZhuyinNone: true,
    zhuyinEnabled: false,
    setZhuyinMode: vi.fn(), setZhuyinEnabled: vi.fn(), toggleZhuyin: vi.fn(),
    processZhuyin: (t: string) => t,
    processLines: () => null,
    processLinesSelective: (lines: string[]) => lines,
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
  vocab: [],
  sentences: [],
  intro: { author: '作者', background: '背景' },
  thumbnail: '/t.jpg',
  category: 'Fable',
} as never;

// Browser APIs this step touches at mount (mirrors __smoke__/render-smoke
// and keyPassageDifficultFont3022.test.tsx).
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

describe('KeyPassageReading scroll-container bottom clearance (#3987 UI-4)', () => {
  it('scroll container carries pb-56, not the old pb-48', () => {
    const { container } = render(
      <KeyPassageReading story={STORY} onFinish={vi.fn()} onBack={vi.fn()} />,
    );
    const scrollArea = container.querySelector('.custom-scrollbar');
    expect(scrollArea).toBeTruthy();
    const classes = scrollArea!.className.split(/\s+/);
    expect(classes).toContain('pb-56');
    expect(classes).not.toContain('pb-48');
  });
});
