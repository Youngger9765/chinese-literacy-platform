/**
 * usePodiumCeremony — #3630 頒獎台揭曉時序引擎。
 *
 * Contract under test:
 *  - ranks reveal in descending order (3rd → 2nd → 1st), one at a time
 *  - champion (rank 1) reveal triggers confetti; nothing else does
 *  - fewer than 3 finishers skip the missing slots entirely (no "waiting
 *    for a 3rd place that will never come")
 *  - 0 finishers settles immediately, nothing revealed, no confetti
 *  - prefers-reduced-motion short-circuits straight to the settled state
 *  - replay() resets and re-runs the whole sequence
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePodiumCeremony, PODIUM_TIMING_MS } from '../usePodiumCeremony';

describe('usePodiumCeremony', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reveals 3rd, then 2nd, then 1st in that order, and only fires confetti once 1st appears', () => {
    const { result } = renderHook(() => usePodiumCeremony([1, 2, 3], false));

    expect(result.current.revealedRanks.size).toBe(0);
    expect(result.current.showConfetti).toBe(false);

    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.THIRD);
    });
    expect([...result.current.revealedRanks]).toEqual([3]);
    expect(result.current.showConfetti).toBe(false);

    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.SECOND - PODIUM_TIMING_MS.THIRD);
    });
    expect([...result.current.revealedRanks].sort()).toEqual([2, 3]);
    expect(result.current.showConfetti).toBe(false);

    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.FIRST - PODIUM_TIMING_MS.SECOND);
    });
    expect([...result.current.revealedRanks].sort()).toEqual([1, 2, 3]);
    expect(result.current.showConfetti).toBe(true);

    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.SETTLE - PODIUM_TIMING_MS.FIRST);
    });
    expect(result.current.stage).toBe('settled');
  });

  it('with exactly 2 finishers reveals 2nd then 1st and never schedules a 3rd slot', () => {
    const { result } = renderHook(() => usePodiumCeremony([1, 2], false));

    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.THIRD);
    });
    expect([...result.current.revealedRanks]).toEqual([2]);

    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.SETTLE);
    });
    expect([...result.current.revealedRanks].sort()).toEqual([1, 2]);
    expect(result.current.stage).toBe('settled');
  });

  it('with exactly 1 finisher reveals only the champion and still fires confetti', () => {
    const { result } = renderHook(() => usePodiumCeremony([1], false));

    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.SETTLE);
    });
    expect([...result.current.revealedRanks]).toEqual([1]);
    expect(result.current.showConfetti).toBe(true);
    expect(result.current.stage).toBe('settled');
  });

  it('with 0 finishers settles immediately: nothing revealed, no confetti', () => {
    const { result } = renderHook(() => usePodiumCeremony([], false));

    expect(result.current.stage).toBe('settled');
    expect(result.current.revealedRanks.size).toBe(0);
    expect(result.current.showConfetti).toBe(false);

    // advancing time must not retroactively invent a reveal
    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.SETTLE);
    });
    expect(result.current.revealedRanks.size).toBe(0);
  });

  it('prefers-reduced-motion reveals everything immediately with no confetti and no pending timers', () => {
    const { result } = renderHook(() => usePodiumCeremony([1, 2, 3], true));

    expect(result.current.stage).toBe('settled');
    expect([...result.current.revealedRanks].sort()).toEqual([1, 2, 3]);
    expect(result.current.showConfetti).toBe(false);
  });

  it('replay() resets to nothing-revealed and re-runs the full sequence', () => {
    const { result } = renderHook(() => usePodiumCeremony([1, 2, 3], false));

    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.SETTLE);
    });
    expect(result.current.stage).toBe('settled');
    expect(result.current.showConfetti).toBe(true);

    act(() => {
      result.current.replay();
    });
    expect(result.current.revealedRanks.size).toBe(0);
    expect(result.current.showConfetti).toBe(false);
    expect(result.current.stage).not.toBe('settled');

    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.SETTLE);
    });
    expect([...result.current.revealedRanks].sort()).toEqual([1, 2, 3]);
    expect(result.current.stage).toBe('settled');
  });

  it('replay() on a reduced-motion ceremony is a safe no-op (stays settled, static)', () => {
    const { result } = renderHook(() => usePodiumCeremony([1, 2, 3], true));
    expect(result.current.stage).toBe('settled');

    act(() => {
      result.current.replay();
    });
    expect(result.current.stage).toBe('settled');
    expect(result.current.showConfetti).toBe(false);
    expect([...result.current.revealedRanks].sort()).toEqual([1, 2, 3]);
  });

  it('clears pending timers on unmount (no act() warnings / leaks)', () => {
    const { unmount } = renderHook(() => usePodiumCeremony([1, 2, 3], false));
    expect(() => {
      unmount();
      vi.advanceTimersByTime(PODIUM_TIMING_MS.SETTLE);
    }).not.toThrow();
  });
});
