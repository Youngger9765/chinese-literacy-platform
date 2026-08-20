/**
 * Tests for Intro.tsx — #1913 CTA label fix
 *
 * TDD-first protocol:
 *   1. [RED]   Test for '開始逐段朗讀' label → PASSES on current buggy code
 *              Test for '開始學習' or '開始做記號' label → FAILS on current code
 *   2. [GREEN] Fix label → new test passes
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Intro imports react-router-dom useNavigate — mock it
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// Mock context providers used by Intro
vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    zhuyinActive: false,
    processZhuyin: (text: string) => text,
  }),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: null }),
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

const baseStory: Story = {
  id: 'L01',
  title: '測試課文',
  level: '3',
  content: ['課文段落一', '課文段落二'],
  thumbnail: '/test.jpg',
  category: 'Fable',
  filename: 'L01.yml',
  vocabulary: [],
  intro: {
    author: '測試作者',
    background: '這是課文背景介紹。',
  },
};

describe('Intro CTA label — #1913', () => {
  it('intro_cta_label_matches_next_step_navigation: CTA must NOT say 開始逐段朗讀 (wrong label)', () => {
    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);

    // The buggy label — after fix this should NOT appear as the primary CTA
    const wrongLabel = screen.queryByRole('button', { name: /開始逐段朗讀/ });
    // After fix: this button should not exist with that text
    expect(wrongLabel).toBeNull();
  });

  it('intro_cta_label_matches_next_step_navigation: CTA says 開始學習 (generic) or 開始做記號 (specific)', () => {
    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);

    // The fixed label — either generic or matching first real step
    const fixedButton =
      screen.queryByRole('button', { name: /開始學習/ }) ||
      screen.queryByRole('button', { name: /開始做記號/ });
    expect(fixedButton).toBeTruthy();
  });

  it('CTA button still calls onStartReading when clicked after label fix', () => {
    const onStartReading = vi.fn();
    render(<Intro story={baseStory} onStartReading={onStartReading} onBack={vi.fn()} />);

    const ctaButton =
      screen.queryByRole('button', { name: /開始學習/ }) ||
      screen.queryByRole('button', { name: /開始做記號/ });

    expect(ctaButton).toBeTruthy();
    ctaButton!.click();
    expect(onStartReading).toHaveBeenCalledOnce();
  });
});

describe('Intro — 導讀 box (#2752)', () => {
  it('renders introGuide.text in its own 導讀 box when present', () => {
    const storyWithGuide: Story = {
      ...baseStory,
      introGuide: { text: '導讀：這課講一個發生在2700年前的精采的故事。' },
    };
    render(<Intro story={storyWithGuide} onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText(/2700年前的精采的故事/)).toBeInTheDocument();
    expect(screen.getByText('導讀')).toBeInTheDocument();
  });

  it('renders nothing extra for a lesson with no introGuide (the other 165 lessons)', () => {
    render(<Intro story={baseStory} onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByText('導讀')).toBeNull();
  });
});

describe('Intro — goal_box feeds the 本課學習策略 box (#2752 Phase 2)', () => {
  it('shows the strategy line from goal_box when worksheetIntro/intro.author have nothing (the actual gap on the 70 goal_box lessons)', () => {
    const storyWithGoalBox: Story = {
      ...baseStory,
      intro: { author: '', background: '這是課文背景介紹。' }, // no ' · ' separator → rawStrategy stays empty without goal_box
      goalBox: { strategy_line: '目標策略：讀出故事道理' },
    };
    render(<Intro story={storyWithGoalBox} onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('讀出故事道理')).toBeInTheDocument();
  });

  it('renders goal_box.title as a small tagline when present (decorative, not shown elsewhere)', () => {
    const storyWithTitle: Story = {
      ...baseStory,
      intro: { author: '', background: '這是課文背景介紹。' },
      goalBox: { title: '閱讀之旅的起點', strategy_line: '目標策略：讀出故事道理' },
    };
    render(<Intro story={storyWithTitle} onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('閱讀之旅的起點')).toBeInTheDocument();
  });

  it('a multi-line strategy_line (embedded \\n from the worksheet) renders as one readable line, not literal \\n', () => {
    const storyWithMultilineStrategy: Story = {
      ...baseStory,
      intro: { author: '', background: 'x' },
      goalBox: { strategy_line: '目標策略：寫作手法──\n排比─從排比歸納重點' },
    };
    render(<Intro story={storyWithMultilineStrategy} onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('寫作手法──，排比─從排比歸納重點')).toBeInTheDocument();
  });

  it('worksheetIntro.target_strategy still wins over goal_box when both present (existing priority unchanged)', () => {
    const story: Story = {
      ...baseStory,
      worksheetIntro: { target_strategy: '既有優先策略' },
      goalBox: { strategy_line: '目標策略：不該顯示這個' },
    };
    render(<Intro story={story} onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('既有優先策略')).toBeInTheDocument();
    expect(screen.queryByText(/不該顯示這個/)).toBeNull();
  });
});
