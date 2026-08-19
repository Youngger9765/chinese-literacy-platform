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
