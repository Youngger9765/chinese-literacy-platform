/**
 * useGamePoll — the shared polling loop (#3671). The per-game cadences are
 * locked in gamePollCadence.test.ts; this file covers the loop's own contract
 * with a fake game so a policy bug and a loop bug fail in different places.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { streakBackoffInterval, useGamePoll, type GamePollConfig } from '../useGamePoll';

class FakeApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface FakeState {
  v: number;
  unchanged?: boolean;
}

function makeConfig(overrides: Partial<GamePollConfig<FakeState>> = {}): GamePollConfig<FakeState> {
  return {
    fetchState: vi.fn<(after: number | undefined) => Promise<FakeState>>(),
    isUnchanged: (s) => s.unchanged === true,
    versionOf: (s) => s.v,
    intervalFor: vi.fn(() => 500),
    errorRetryMs: 4000,
    jitterMs: 100,
    ApiError: FakeApiError,
    ...overrides,
  };
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useGamePoll', () => {
  it('does nothing while config is null', async () => {
    const { result } = renderHook(() => useGamePoll<FakeState>(null));
    await tick(10_000);
    expect(result.current).toEqual({ state: null, error: null, loading: true });
  });

  it('asks intervalFor with the held state and the unchanged streak', async () => {
    const config = makeConfig();
    const fetchState = config.fetchState as ReturnType<typeof vi.fn>;
    fetchState.mockResolvedValueOnce({ v: 1 });
    fetchState.mockResolvedValue({ v: 1, unchanged: true });
    const { result } = renderHook(() => useGamePoll(config));
    await tick(0);
    await tick(500);
    await tick(500);
    expect(config.intervalFor).toHaveBeenNthCalledWith(1, { v: 1 }, 0);
    expect(config.intervalFor).toHaveBeenNthCalledWith(2, { v: 1 }, 1);
    expect(config.intervalFor).toHaveBeenNthCalledWith(3, { v: 1 }, 2);
    expect(fetchState.mock.calls).toEqual([[undefined], [1], [1]]);
    expect(result.current.state).toEqual({ v: 1 });
  });

  it('scales jitter by jitterMs', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const config = makeConfig();
    (config.fetchState as ReturnType<typeof vi.fn>).mockResolvedValue({ v: 1 });
    renderHook(() => useGamePoll(config));
    await tick(0);
    await tick(549);
    expect(config.fetchState).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(config.fetchState).toHaveBeenCalledTimes(2);
  });

  it('retries errors after errorRetryMs and stops on the ApiError 403/404', async () => {
    const config = makeConfig();
    const fetchState = config.fetchState as ReturnType<typeof vi.fn>;
    fetchState.mockRejectedValueOnce(new Error('boom'));
    fetchState.mockRejectedValueOnce(new FakeApiError('gone', 404));
    const { result } = renderHook(() => useGamePoll(config));
    await tick(0);
    expect(result.current.error).toBe('連線失敗，重新嘗試中…');
    await tick(3999);
    expect(fetchState).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(fetchState).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe('gone');
    await tick(60_000);
    expect(fetchState).toHaveBeenCalledTimes(2);
  });

  it('does not restart while the config object is the same', async () => {
    const config = makeConfig();
    (config.fetchState as ReturnType<typeof vi.fn>).mockResolvedValue({ v: 1 });
    const { rerender } = renderHook(() => useGamePoll(config));
    await tick(0);
    rerender();
    rerender();
    await tick(0);
    expect(config.fetchState).toHaveBeenCalledTimes(1);
  });
});

describe('streakBackoffInterval', () => {
  it('is 2.5s when idle, 3s from 5 unchanged polls, else 1s', () => {
    expect(streakBackoffInterval(true, 0)).toBe(2500);
    expect(streakBackoffInterval(true, 99)).toBe(2500);
    expect(streakBackoffInterval(false, 0)).toBe(1000);
    expect(streakBackoffInterval(false, 4)).toBe(1000);
    expect(streakBackoffInterval(false, 5)).toBe(3000);
  });
});
