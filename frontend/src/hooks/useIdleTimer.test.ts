/**
 * Unit tests for useIdleTimer hook (Issue #408)
 * Tests idle detection, reset on activity, and enable/disable behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdleTimer } from './useIdleTimer';

describe('useIdleTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onIdle after the specified timeout with no activity', () => {
    const onIdle = vi.fn();
    renderHook(() =>
      useIdleTimer({ timeout: 5000, onIdle, enabled: true }),
    );

    expect(onIdle).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onIdle before the timeout elapses', () => {
    const onIdle = vi.fn();
    renderHook(() =>
      useIdleTimer({ timeout: 5000, onIdle, enabled: true }),
    );

    act(() => {
      vi.advanceTimersByTime(4999);
    });

    expect(onIdle).not.toHaveBeenCalled();
  });

  it('resets timer when reset() is called', () => {
    const onIdle = vi.fn();
    const { result } = renderHook(() =>
      useIdleTimer({ timeout: 5000, onIdle, enabled: true }),
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Reset — timer should restart from 0
    act(() => {
      result.current.reset();
    });

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Only 3s passed since last reset, so onIdle should NOT fire yet
    expect(onIdle).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Now 5s have passed since reset — onIdle should fire
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('does not start timer when enabled is false', () => {
    const onIdle = vi.fn();
    renderHook(() =>
      useIdleTimer({ timeout: 5000, onIdle, enabled: false }),
    );

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(onIdle).not.toHaveBeenCalled();
  });

  it('clears timer on unmount', () => {
    const onIdle = vi.fn();
    const { unmount } = renderHook(() =>
      useIdleTimer({ timeout: 5000, onIdle, enabled: true }),
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onIdle).not.toHaveBeenCalled();
  });
});
