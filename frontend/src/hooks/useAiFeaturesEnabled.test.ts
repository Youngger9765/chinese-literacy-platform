/**
 * Tests for useAiFeaturesEnabled / useAiChatbotEnabled (Issue #3838 — AI
 * kill switch, frontend half; #3861 — chatbot-only scope correction).
 *
 * Both hooks mirror GET /api/features so components can hide AI entry
 * points when the backend gate is off, instead of showing a button that
 * always 503s. useAiFeaturesEnabled reads the general gate (defaults ON
 * server-side); useAiChatbotEnabled reads the chatbot-only gate (defaults
 * OFF server-side) — but both hooks themselves still START as `false`
 * (hidden) on the frontend until the fetch resolves, fail-closed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useAiFeaturesEnabled,
  useAiChatbotEnabled,
  _resetAiFeaturesCacheForTests,
} from './useAiFeaturesEnabled';

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

describe('useAiChatbotEnabled', () => {
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
    const { result } = renderHook(() => useAiChatbotEnabled());
    expect(result.current).toBe(false);
  });

  it('stays false when the backend reports chatbot disabled (the production default)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ai_features_enabled: true, ai_chatbot_enabled: false }),
        }),
      ),
    );
    const { result } = renderHook(() => useAiChatbotEnabled());
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('flips to true only when the backend reports chatbot enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ai_features_enabled: true, ai_chatbot_enabled: true }),
        }),
      ),
    );
    const { result } = renderHook(() => useAiChatbotEnabled());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('fails closed (false) when the fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network error'))),
    );
    const { result } = renderHook(() => useAiChatbotEnabled());
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('shares one fetch with useAiFeaturesEnabled when both are mounted', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ai_features_enabled: true, ai_chatbot_enabled: true }),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const general = renderHook(() => useAiFeaturesEnabled());
    const chatbot = renderHook(() => useAiChatbotEnabled());

    await waitFor(() => expect(general.result.current).toBe(true));
    await waitFor(() => expect(chatbot.result.current).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('can independently report general-on + chatbot-off at the same time', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ai_features_enabled: true, ai_chatbot_enabled: false }),
        }),
      ),
    );
    const general = renderHook(() => useAiFeaturesEnabled());
    const chatbot = renderHook(() => useAiChatbotEnabled());

    await waitFor(() => expect(general.result.current).toBe(true));
    await waitFor(() => expect(chatbot.result.current).toBe(false));
  });
});
