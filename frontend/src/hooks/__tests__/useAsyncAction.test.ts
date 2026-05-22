/**
 * Tests for useAsyncAction (Issue #1847)
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAsyncAction } from '../useAsyncAction';

describe('useAsyncAction', () => {
  it('initialises with isLoading=false and empty error', () => {
    const { result } = renderHook(() => useAsyncAction());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe('');
  });

  it('returns true when the function resolves successfully', async () => {
    const { result } = renderHook(() => useAsyncAction());
    let outcome: boolean | undefined;

    await act(async () => {
      outcome = await result.current.run(async () => {/* no-op */});
    });

    expect(outcome).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe('');
  });

  it('returns false and sets error when the function throws', async () => {
    const { result } = renderHook(() => useAsyncAction());
    let outcome: boolean | undefined;

    await act(async () => {
      outcome = await result.current.run(async () => {
        throw new Error('API 失敗');
      });
    });

    expect(outcome).toBe(false);
    expect(result.current.error).toBe('API 失敗');
    expect(result.current.isLoading).toBe(false);
  });

  it('sets a generic error for non-Error throws', async () => {
    const { result } = renderHook(() => useAsyncAction());

    await act(async () => {
      await result.current.run(async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'string error';
      });
    });

    expect(result.current.error).toBe('發生錯誤，請稍後再試');
  });

  it('clears error via clearError', async () => {
    const { result } = renderHook(() => useAsyncAction());

    await act(async () => {
      await result.current.run(async () => { throw new Error('oops'); });
    });

    expect(result.current.error).toBe('oops');

    act(() => { result.current.clearError(); });

    expect(result.current.error).toBe('');
  });

  it('sets isLoading=false after execution completes', async () => {
    const { result } = renderHook(() => useAsyncAction());

    // Before run, isLoading is false
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      await result.current.run(async () => {/* no-op */});
    });

    // After run, isLoading must be false again
    expect(result.current.isLoading).toBe(false);
  });

  it('isLoading resets to false even on error', async () => {
    const { result } = renderHook(() => useAsyncAction());

    await act(async () => {
      await result.current.run(async () => { throw new Error('fail'); });
    });

    expect(result.current.isLoading).toBe(false);
  });
});
