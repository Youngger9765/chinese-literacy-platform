/**
 * Tests for useDebouncedSearch (Issue #1847)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedSearch } from '../useDebouncedSearch';

describe('useDebouncedSearch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('initialises with empty query and page 0', () => {
    const { result } = renderHook(() => useDebouncedSearch());
    expect(result.current.query).toBe('');
    expect(result.current.debouncedQuery).toBe('');
    expect(result.current.page).toBe(0);
  });

  it('initialises with provided initialQuery', () => {
    const { result } = renderHook(() =>
      useDebouncedSearch({ initialQuery: 'hello' }),
    );
    expect(result.current.query).toBe('hello');
  });

  it('updates debouncedQuery after the delay', () => {
    const { result } = renderHook(() => useDebouncedSearch({ delay: 300 }));

    act(() => {
      result.current.setQuery('abc');
    });

    // Still old value before delay
    expect(result.current.debouncedQuery).toBe('');

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.debouncedQuery).toBe('abc');
  });

  it('resets page to 0 when debouncedQuery changes', () => {
    const { result } = renderHook(() => useDebouncedSearch({ delay: 200 }));

    // Manually advance to initial debounce
    act(() => { vi.advanceTimersByTime(200); });

    // Set page to 2
    act(() => { result.current.setPage(2); });
    expect(result.current.page).toBe(2);

    // Change query → debounce fires → page should reset
    act(() => { result.current.setQuery('search'); });
    act(() => { vi.advanceTimersByTime(200); });

    expect(result.current.debouncedQuery).toBe('search');
    expect(result.current.page).toBe(0);
  });

  it('allows manual page changes via setPage', () => {
    const { result } = renderHook(() => useDebouncedSearch());
    act(() => { result.current.setPage(5); });
    expect(result.current.page).toBe(5);
  });

  it('debounces rapid keystrokes — only fires once after the delay', () => {
    const { result } = renderHook(() => useDebouncedSearch({ delay: 400 }));

    act(() => { vi.advanceTimersByTime(400); }); // flush initial mount

    act(() => { result.current.setQuery('a'); });
    act(() => { vi.advanceTimersByTime(100); });
    act(() => { result.current.setQuery('ab'); });
    act(() => { vi.advanceTimersByTime(100); });
    act(() => { result.current.setQuery('abc'); });
    act(() => { vi.advanceTimersByTime(400); }); // final debounce fires

    expect(result.current.debouncedQuery).toBe('abc');
  });
});
