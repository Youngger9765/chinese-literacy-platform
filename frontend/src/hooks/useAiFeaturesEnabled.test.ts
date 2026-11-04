/**
 * Tests for useAiFeaturesEnabled (Issue #3838 — AI kill switch, frontend half).
 *
 * The hook mirrors GET /api/features so components can hide AI entry points
 * when the backend kill switch is off, instead of showing a button that
 * always 503s.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAiFeaturesEnabled, _resetAiFeaturesCacheForTests } from './useAiFeaturesEnabled';

describe('useAiFeaturesEnabled', () => {
  beforeEach(() => {
    _resetAiFeaturesCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetAiFeaturesCacheForTests();
  });

  it('starts as false (hidden) before the fetch resolves', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})), // never resolves
    );
    const { result } = renderHook(() => useAiFeaturesEnabled());
    expect(result.current).toBe(false);
  });

  it('flips to true when the backend reports AI enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ai_features_enabled: true }),
        }),
      ),
    );
    const { result } = renderHook(() => useAiFeaturesEnabled());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('stays false when the backend reports AI disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ai_features_enabled: false }),
        }),
      ),
    );
    const { result } = renderHook(() => useAiFeaturesEnabled());
    await waitFor(() => {
      // Resolve a tick so we know the fetch promise actually settled, not
      // just that the initial render value happens to already be false.
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining('/api/features'));
    });
    expect(result.current).toBe(false);
  });

  it('fails closed (false) when the fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network error'))),
    );
    const { result } = renderHook(() => useAiFeaturesEnabled());
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('fails closed (false) when the response is not ok (e.g. 500)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })),
    );
    const { result } = renderHook(() => useAiFeaturesEnabled());
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('shares one fetch across multiple components mounted at once', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ai_features_enabled: true }),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = renderHook(() => useAiFeaturesEnabled());
    const second = renderHook(() => useAiFeaturesEnabled());

    await waitFor(() => expect(first.result.current).toBe(true));
    await waitFor(() => expect(second.result.current).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
