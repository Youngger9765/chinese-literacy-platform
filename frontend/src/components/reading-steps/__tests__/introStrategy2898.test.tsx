/**
 * #2898 — the strategy box must show the explanation, not just the label.
 *
 * What owner saw was one line: 「推論策略──推論代名詞」. 「就這麼短嗎？」
 * The explanation is generated once per lesson and stored in
 * `metadata.strategy_explained`; this locks the last hop, which is the one
 * that keeps getting missed — the gates around extraction all ask "was this
 * produced correctly" and none asks "does it reach the student".
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { Story } from '../../../types';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, token: null, isAuthenticated: false, isLoading: false }),
}));
vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    zhuyinMode: 'none', zhuyinReady: true, zhuyinActive: false, isZhuyinAny: false,
    isZhuyinAll: false, isZhuyinNone: true, zhuyinEnabled: false,
    setZhuyinMode: vi.fn(), setZhuyinEnabled: vi.fn(), toggleZhuyin: vi.fn(),
    processZhuyin: (t: string) => t, processLines: () => null, processLinesSelective: () => null,
  }),
}));
vi.mock('../../../context/KaraokeContext', () => ({
  useKaraoke: () => ({ karaokeEnabled: false, setKaraokeEnabled: vi.fn(), toggleKaraoke: vi.fn() }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/', search: '', hash: '', state: null, key: 'k' }),
  useParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import Intro from '../Intro';

const NAME = '推論策略──推論代名詞';
const EXPLAINED = '這一課我們要練習從句子裡找出線索\n讀的時候可以試著想想看每個「意思」在說什麼';

const STORY: Story = {
  id: '16', title: '這是什麼「意思」？', level: '4',
  content: ['第一段。'], thumbnail: '', category: 'Fable',
  filename: 't.yml', grade: '4', charCount: 10,
  readingStrategy: NAME,
};

describe('#2898 本課學習策略', () => {
  it('shows the explanation under the strategy name', () => {
    render(<Intro story={{ ...STORY, readingStrategyExplained: EXPLAINED }}
                  onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText(NAME)).toBeTruthy();
    // Assert on the <p> itself, not on any ancestor whose textContent happens to
    // contain the string — every wrapper up to <body> does.
    const own = screen.getAllByText(
      (_, n) => n?.tagName === 'P' && (n.textContent ?? '').includes('每個「意思」在說什麼'),
    );
    expect(own.length).toBeGreaterThan(0);
    // The whole thing, not a prefix: a truncated render still contains line one.
    expect(own[0].textContent).toContain('這一課我們要練習從句子裡找出線索');
  });

  it('still shows the bare name when a lesson has no explanation', () => {
    // 15 of 175 have neither source. Those keep the label rather than losing the box.
    render(<Intro story={STORY} onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText(NAME)).toBeTruthy();
  });

  it('renders no strategy box at all when there is no strategy', () => {
    // Positive control for the two above: without it, "always render the box"
    // would satisfy them both.
    render(<Intro story={{ ...STORY, readingStrategy: undefined }}
                  onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByText(NAME)).toBeNull();
  });
});
