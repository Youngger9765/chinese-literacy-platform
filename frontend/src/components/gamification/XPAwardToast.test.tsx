/**
 * Tests for XPAwardToast (Issue #3024).
 *
 * Locks two things touched by #3024:
 *  1. The BADGE_ICONS/BADGE_NAMES extraction into ./badgeMeta didn't change
 *     rendered output (a pure refactor — badge name/icon still show).
 *  2. The new honest disclosure caption answers the teacher's literal
 *     question ("是達成目標的當下就跑出來嗎？") on the report page, since some
 *     badges here can only ever be judged at full-session completion.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import XPAwardToast, { type XPAwardResult } from './XPAwardToast';

function makeResult(overrides: Partial<XPAwardResult> = {}): XPAwardResult {
  return {
    xp_earned: 20,
    new_total_xp: 20,
    level_info: {
      level: 1,
      level_name: '初學者',
      total_xp: 20,
      progress_pct: 20,
      next_level_xp: 100,
      xp_to_next: 80,
      current_level_xp: 20,
    },
    streak: { current: 1, longest: 1 },
    badges_unlocked: [],
    ...overrides,
  };
}

describe('XPAwardToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders XP earned', () => {
    render(<XPAwardToast result={makeResult()} onDismiss={vi.fn()} />);
    expect(screen.getByText('+20 XP')).toBeTruthy();
  });

  it('renders the badge icon + name via the shared badgeMeta module', () => {
    render(
      <XPAwardToast
        result={makeResult({ badges_unlocked: ['xp_500'] })}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('積分達人')).toBeTruthy();
  });

  it('shows the honest "结算在最后" disclosure caption (#3024)', () => {
    render(<XPAwardToast result={makeResult()} onDismiss={vi.fn()} />);
    expect(
      screen.getByText(/需完成整堂課才會結算/),
      '教師問「是達成目標的當下就跑出來嗎？」——報告頁必須誠實回答',
    ).toBeTruthy();
  });

  it('shows the disclosure caption even when badges WERE unlocked (still applies to the ones that were not)', () => {
    render(
      <XPAwardToast
        result={makeResult({ badges_unlocked: ['first_story'] })}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/需完成整堂課才會結算/)).toBeTruthy();
  });
});
