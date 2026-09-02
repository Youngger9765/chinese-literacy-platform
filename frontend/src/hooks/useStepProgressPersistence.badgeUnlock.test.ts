/**
 * TDD tests for useStepProgressPersistence's #3024 midSessionBadgeUnlocks.
 *
 * useProgressSync is mocked (same pattern as the existing resetTutorStep
 * test) — this test's job is to verify useStepProgressPersistence correctly
 * WIRES the onXpAwarded option it passes to useProgressSync into its own
 * exposed midSessionBadgeUnlocks / dismissMidSessionBadgeUnlocks, not to
 * re-test useProgressSync's own network logic (that lives in
 * useProgressSync.xpAwarded.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let capturedOnXpAwarded: ((r: { xpAwarded: number; badgesUnlocked: string[] }) => void) | undefined;

vi.mock('./useProgressSync', () => ({
  useProgressSync: (opts: { onXpAwarded?: (r: { xpAwarded: number; badgesUnlocked: string[] }) => void }) => {
    capturedOnXpAwarded = opts.onXpAwarded;
    return {
      syncProgress: vi.fn(),
      flushProgress: vi.fn(),
      isProgressLoading: false,
    };
  },
}));

import { useStepProgressPersistence } from './useStepProgressPersistence';

function setup() {
  const setSession = vi.fn();
  const { result } = renderHook(() =>
    useStepProgressPersistence({
      storyId: '99',
      user: { id: 1 } as never,
      token: 'test-token',
      dbSessionId: 1,
      selectedStory: null,
      isAssignmentFlow: false,
      setSession,
    }),
  );
  return { result };
}

describe('useStepProgressPersistence — midSessionBadgeUnlocks (#3024)', () => {
  beforeEach(() => {
    localStorage.clear();
    capturedOnXpAwarded = undefined;
  });

  it('starts with no pending mid-session badge unlocks', () => {
    const { result } = setup();
    expect(result.current.midSessionBadgeUnlocks).toEqual([]);
  });

  it('surfaces newly-unlocked badges when useProgressSync reports them', () => {
    const { result } = setup();
    expect(capturedOnXpAwarded, 'useStepProgressPersistence must pass onXpAwarded to useProgressSync').toBeTypeOf('function');

    act(() => {
      capturedOnXpAwarded!({ xpAwarded: 3, badgesUnlocked: ['xp_500'] });
    });

    expect(result.current.midSessionBadgeUnlocks).toEqual(['xp_500']);
  });

  it('accumulates badges across multiple awards before being dismissed', () => {
    const { result } = setup();

    act(() => {
      capturedOnXpAwarded!({ xpAwarded: 3, badgesUnlocked: ['xp_500'] });
    });
    act(() => {
      capturedOnXpAwarded!({ xpAwarded: 3, badgesUnlocked: ['level_5'] });
    });

    expect(result.current.midSessionBadgeUnlocks).toEqual(['xp_500', 'level_5']);
  });

  it('does not add anything when the award had no badges (XP-only step completion)', () => {
    const { result } = setup();

    act(() => {
      capturedOnXpAwarded!({ xpAwarded: 3, badgesUnlocked: [] });
    });

    expect(result.current.midSessionBadgeUnlocks).toEqual([]);
  });

  it('dismissMidSessionBadgeUnlocks clears the pending list', () => {
    const { result } = setup();

    act(() => {
      capturedOnXpAwarded!({ xpAwarded: 3, badgesUnlocked: ['xp_500'] });
    });
    expect(result.current.midSessionBadgeUnlocks).toEqual(['xp_500']);

    act(() => {
      result.current.dismissMidSessionBadgeUnlocks();
    });
    expect(result.current.midSessionBadgeUnlocks).toEqual([]);
  });
});
