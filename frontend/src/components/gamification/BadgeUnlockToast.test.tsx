/**
 * TDD tests for BadgeUnlockToast (Issue #3024).
 *
 * BDD: 「課程進行中達成的徽章立即顯示...學生在同一個步驟內看到徽章解鎖提示，
 * 不需要等到報告頁」
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import BadgeUnlockToast from './BadgeUnlockToast';

describe('BadgeUnlockToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when badgeKeys is empty', () => {
    render(<BadgeUnlockToast badgeKeys={[]} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('badge-unlock-toast')).toBeNull();
  });

  it('shows the badge name for a known badge key', () => {
    render(<BadgeUnlockToast badgeKeys={['xp_500']} onDismiss={vi.fn()} />);
    const toast = screen.getByTestId('badge-unlock-toast');
    expect(toast.textContent).toContain('積分達人');
  });

  it('falls back to the raw key for an unknown badge key (never throws)', () => {
    render(<BadgeUnlockToast badgeKeys={['some_future_badge']} onDismiss={vi.fn()} />);
    const toast = screen.getByTestId('badge-unlock-toast');
    expect(toast.textContent).toContain('some_future_badge');
  });

  it('renders every badge when multiple unlock in the same event', () => {
    render(<BadgeUnlockToast badgeKeys={['xp_500', 'level_5']} onDismiss={vi.fn()} />);
    const toast = screen.getByTestId('badge-unlock-toast');
    expect(toast.textContent).toContain('積分達人');
    expect(toast.textContent).toContain('思考者');
  });

  it('calls onDismiss when the 好的 button is clicked', () => {
    const onDismiss = vi.fn();
    render(<BadgeUnlockToast badgeKeys={['xp_500']} onDismiss={onDismiss} />);
    screen.getByRole('button', { name: /好的/ }).click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses on its own after a delay', () => {
    const onDismiss = vi.fn();
    render(<BadgeUnlockToast badgeKeys={['xp_500']} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('uses aria-live="polite" — never interrupts what the student is doing', () => {
    render(<BadgeUnlockToast badgeKeys={['xp_500']} onDismiss={vi.fn()} />);
    const toast = screen.getByTestId('badge-unlock-toast');
    expect(toast.getAttribute('aria-live')).toBe('polite');
  });
});
