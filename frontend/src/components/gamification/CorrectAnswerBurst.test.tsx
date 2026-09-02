/**
 * TDD tests for CorrectAnswerBurst (Issue #3024).
 *
 * BDD (from the #3024 PRD):
 *   - 答對當下有正向視覺回饋，一秒內出現
 *   - 這個回饋不會延遲或擋住進到下一題 (pointer-events-none)
 *   - 答錯不出現負向回饋 (component only ever renders on a positive trigger —
 *     covered here structurally: triggerKey never increments on wrong answers,
 *     and there is no "negative" variant of this component at all)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import CorrectAnswerBurst from './CorrectAnswerBurst';

describe('CorrectAnswerBurst', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when triggerKey is 0 (initial state, no answer yet)', () => {
    render(<CorrectAnswerBurst triggerKey={0} />);
    expect(screen.queryByTestId('correct-answer-burst')).toBeNull();
  });

  it('shows a positive message immediately when triggerKey increments', () => {
    const { rerender } = render(<CorrectAnswerBurst triggerKey={0} />);
    rerender(<CorrectAnswerBurst triggerKey={1} />);
    const burst = screen.getByTestId('correct-answer-burst');
    expect(burst).toBeTruthy();
    // Every configured message is an encouragement — never anything
    // resembling "wrong" / attempt-count framing (#3028 out of scope).
    expect(burst.textContent).toMatch(/答對了|太棒了|做得好|真厲害/);
  });

  it('never intercepts clicks — stays pointer-events-none so it cannot block "下一題"', () => {
    const { rerender } = render(<CorrectAnswerBurst triggerKey={0} />);
    rerender(<CorrectAnswerBurst triggerKey={1} />);
    const burst = screen.getByTestId('correct-answer-burst');
    expect(burst.className).toContain('pointer-events-none');
  });

  it('auto-dismisses on its own without any user action', () => {
    const { rerender } = render(<CorrectAnswerBurst triggerKey={0} />);
    rerender(<CorrectAnswerBurst triggerKey={1} />);
    expect(screen.getByTestId('correct-answer-burst')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.queryByTestId('correct-answer-burst')).toBeNull();
  });

  it('re-triggers on each new correct answer (repeated triggerKey bumps)', () => {
    const { rerender } = render(<CorrectAnswerBurst triggerKey={1} />);
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.queryByTestId('correct-answer-burst')).toBeNull();

    rerender(<CorrectAnswerBurst triggerKey={2} />);
    expect(screen.getByTestId('correct-answer-burst')).toBeTruthy();
  });

  it('uses aria-live="polite" (not "assertive") so it never steals focus/interrupts a screen reader', () => {
    const { rerender } = render(<CorrectAnswerBurst triggerKey={0} />);
    rerender(<CorrectAnswerBurst triggerKey={1} />);
    const burst = screen.getByTestId('correct-answer-burst');
    expect(burst.getAttribute('aria-live')).toBe('polite');
  });
});
