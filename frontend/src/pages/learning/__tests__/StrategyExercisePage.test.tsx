/**
 * TDD tests for SpotlightPage empty-state (#1923)
 *
 * Bug A: When a lesson has no strategyExercise, the empty-state message
 * used to say「此課文尚未有閱讀聚光燈練習」which reads as apology/absence.
 * Fix: warm, reassuring copy + a "找其他課文" CTA that navigates to library.
 *
 * RED phase assertions:
 *   1. Old text "尚未有" must NOT appear.
 *   2. New text "本課暫無閱讀聚光燈練習" MUST appear.
 *   3. "找其他課文" CTA must be rendered and call the library navigation handler.
 *   4. Skip/next button still present (secondary style).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock dependencies ─────────────────────────────────────────────────────────

// SpotlightPage uses useLearningContext from LearningLayout
vi.mock('../../../layouts/LearningLayout', () => ({
  useLearningContext: vi.fn(),
}));

// ComprehensionLayout wraps the page — render children directly
vi.mock('../../../components/reading-steps/ComprehensionLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="comprehension-layout">{children}</div>
  ),
}));

// StrategyExercise and GraphicTextIntegrationExercise are not needed for empty-state tests
vi.mock('../../../components/reading-steps/StrategyExercise', () => ({
  default: () => <div data-testid="strategy-exercise" />,
}));

vi.mock('../../../components/reading-steps/GraphicTextIntegrationExercise', () => ({
  default: () => <div data-testid="graphic-text-exercise" />,
}));

// react-router-dom useNavigate for the "找其他課文" CTA
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

import { useLearningContext } from '../../../layouts/LearningLayout';
import SpotlightPage from '../SpotlightPage';
import type { Story } from '../../../types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseStory: Story = {
  id: 'L-test',
  title: '贏得喝采的輸家',
  level: 5,
  content: ['段落一', '段落二'],
  thumbnail: '/thumb.jpg',
  category: 'Fable',
  filename: 'L-test.yml',
  vocabulary: [],
  // No strategyExercise — this is the empty-state scenario
};

const mockHandleFinishReadingStrategy = vi.fn();
const mockSaveStepProgressPatch = vi.fn();

const makeContext = (story: Story | null = baseStory) => ({
  selectedStory: story,
  handleFinishReadingStrategy: mockHandleFinishReadingStrategy,
  dbSessionId: 'sess-123',
  saveStepProgressPatch: mockSaveStepProgressPatch,
  stepProgressData: { step_data: {} },
});

beforeEach(() => {
  vi.clearAllMocks();
  (useLearningContext as ReturnType<typeof vi.fn>).mockReturnValue(makeContext());
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SpotlightPage — empty state (no strategyExercise)', () => {
  it('does NOT show the old apology text「尚未有」', () => {
    render(<SpotlightPage />);
    expect(screen.queryByText(/尚未有/)).toBeNull();
  });

  it('shows the new warm copy「本課暫無閱讀聚光燈練習」', () => {
    render(<SpotlightPage />);
    expect(screen.getByText(/本課暫無閱讀聚光燈練習/)).toBeTruthy();
  });

  it('renders a「找其他課文練習」CTA button', () => {
    render(<SpotlightPage />);
    expect(screen.getByRole('button', { name: /找其他課文練習/ })).toBeTruthy();
  });

  it('「找其他課文練習」CTA navigates to library when clicked', () => {
    render(<SpotlightPage />);
    fireEvent.click(screen.getByRole('button', { name: /找其他課文練習/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/library');
  });

  it('still renders a skip/next button', () => {
    render(<SpotlightPage />);
    // The secondary skip button should still be present
    expect(screen.getByRole('button', { name: /跳過|下一關/ })).toBeTruthy();
  });
});

describe('SpotlightPage — with strategyExercise present', () => {
  it('renders the strategy exercise component, not the empty state', () => {
    const storyWithStrategy: Story = {
      ...baseStory,
      strategyExercise: {
        type: 'guided_steps',
        strategy_name: '自我提問',
        instruction: '練習。',
        steps: [],
      },
    };
    (useLearningContext as ReturnType<typeof vi.fn>).mockReturnValue(
      makeContext(storyWithStrategy),
    );

    render(<SpotlightPage />);
    expect(screen.queryByText(/本課暫無/)).toBeNull();
    expect(screen.getByTestId('strategy-exercise')).toBeTruthy();
  });
});
