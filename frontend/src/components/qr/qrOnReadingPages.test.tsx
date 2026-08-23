/**
 * #2886 — the QR button really is on the two learning pages.
 *
 * `lessonQr.test.tsx` locks the rule (which lessons, which URL). This locks
 * the wiring: that each page asks the rule and renders the button. A rule
 * nobody calls is the failure mode the gates around this feature keep missing
 * — the extraction gates all ask "was this computed correctly" and none asks
 * "does it reach the screen".
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { Story } from '../../types';

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async (v: string) => `data:image/png;base64,QR(${v})`) },
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, token: null, isAuthenticated: false, isLoading: false }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    zhuyinMode: 'none', zhuyinReady: true, zhuyinActive: false,
    isZhuyinAny: false, isZhuyinAll: false, isZhuyinNone: true, zhuyinEnabled: false,
    setZhuyinMode: vi.fn(), setZhuyinEnabled: vi.fn(), toggleZhuyin: vi.fn(),
    processZhuyin: (t: string) => t, processLines: () => null, processLinesSelective: () => null,
  }),
  ZhuyinProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../context/KaraokeContext', () => ({
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

// jsdom has no mediaDevices; KeyPassageReading asks for the mic on mount.
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
});

import FullTextAnnotate from '../reading-steps/FullTextAnnotate';
import KeyPassageReading from '../reading-steps/KeyPassageReading';

const STORY: Story = {
  id: '7',
  title: '測試課文',
  level: '4',
  content: ['這是第一段。', '這是第二段。'],
  thumbnail: '',
  category: 'Fable',
  filename: 'qr-test.yml',
  grade: '4',
  charCount: 10,
};

const qrButton = () => screen.queryByRole('button', { name: /QR code/ });

describe('#2886 讀全文-做記號：全文 QR', () => {
  it('renders for a grade the spec gives a 全文 code to', () => {
    render(<FullTextAnnotate story={STORY} onFinish={vi.fn()} />);
    const btn = qrButton();
    expect(btn).not.toBeNull();
    // The encoded target, not just "a button exists".
    expect(btn!.getAttribute('title')).toBe(`${window.location.origin}/learn/7/full-text-annotate`);
  });

  it.each(['8', '9', '文言文', '品格教育'])(
    'is absent for grade %s (spec R1: 8-9 段落 only)',
    (grade) => {
      render(<FullTextAnnotate story={{ ...STORY, grade }} onFinish={vi.fn()} />);
      expect(qrButton()).toBeNull();
    },
  );
});

describe('#2886 重點朗讀：段落 QR', () => {
  it('renders when the lesson has a 念順順段', () => {
    const withPassage: Story = {
      ...STORY,
      keyReading: { passage: '這是老師指定的重點段落。', extentChars: 12, source: 'docx-extract' },
    };
    render(<KeyPassageReading story={withPassage} onFinish={vi.fn()} onBack={vi.fn()} />);
    const btn = qrButton();
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('title')).toBe(`${window.location.origin}/learn/7/key-passage-reading`);
  });

  it('is absent when the lesson has no 念順順段', () => {
    // Same rule the admin table applies when it leaves passage_url blank.
    render(<KeyPassageReading story={STORY} onFinish={vi.fn()} onBack={vi.fn()} />);
    expect(qrButton()).toBeNull();
  });

  it('is absent when the passage is present but blank', () => {
    render(
      <KeyPassageReading
        story={{ ...STORY, keyReading: { passage: '   ' } }}
        onFinish={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(qrButton()).toBeNull();
  });
});
