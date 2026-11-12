/**
 * Locks the polling cadence of the three live multiplayer modes (#3671).
 *
 * These are characterization tests: they were written against the three
 * hand-rolled hooks BEFORE they were folded into the shared useGamePoll, and
 * must stay green unchanged afterwards. The unification is a pure refactor —
 * each game keeps its own rhythm:
 *
 *   live-quiz / team-arena : 1s base, 3s after 5 unchanged polls in a row,
 *                            2.5s in lobby/ended, jitter 0–200ms
 *   pk                     : 1s while status === 'active', otherwise 3s;
 *                            NO unchanged-streak backoff, NO lobby slow-down,
 *                            jitter 0–150ms
 *   all three              : errors retry after 3s (+ jitter); 403/404 stop
 *
 * Bringing PK in line with the other two is a separate behaviour change
 * (issue #3671 step 1) and must NOT happen as a side effect of this refactor —
 * the PK cases below are what would go red if it did.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../../../services/liveQuizApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/liveQuizApi')>()),
  getLiveQuizState: vi.fn(),
}));
vi.mock('../../../services/teamArenaApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/teamArenaApi')>()),
  getTeamArenaState: vi.fn(),
}));
vi.mock('../../../services/pkApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/pkApi')>()),
  getPkMatchState: vi.fn(),
}));

import { getLiveQuizState, LiveQuizApiError } from '../../../services/liveQuizApi';
import { getTeamArenaState, TeamArenaApiError } from '../../../services/teamArenaApi';
import { getPkMatchState, PkApiError } from '../../../services/pkApi';
import { useLiveQuizPoll } from '../../live-quiz/useLiveQuizPoll';
import { useTeamArenaPoll } from '../../team-arena/useTeamArenaPoll';
import { usePkMatchPoll } from '../../pk/usePkMatchPoll';

type Fetch = Mock<(...args: unknown[]) => Promise<unknown>>;

/** Flush the in-flight poll's promise chain without advancing the clock. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/**
 * Asserts the next poll fires exactly `ms` after the previous one settled:
 * not at ms-1, but at ms. Leaves the clock at the moment of that call.
 */
async function expectNextPollAfter(fetch: Fetch, ms: number) {
  const before = fetch.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms - 1);
  });
  expect(fetch.mock.calls.length, `polled early (before ${ms}ms)`).toBe(before);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(fetch.mock.calls.length, `did not poll at ${ms}ms`).toBe(before + 1);
}

async function expectNoMorePolls(fetch: Fetch) {
  const before = fetch.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(fetch.mock.calls.length).toBe(before);
}

let random: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  // Zero jitter by default so intervals are exact; jitter has its own cases.
  random = vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  random.mockRestore();
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// live-quiz and team-arena share one cadence; only the payload shape differs.
// ---------------------------------------------------------------------------

interface StreakGame {
  name: string;
  fetch: () => Fetch;
  render: (token: string | null, code: string | null) => ReturnType<typeof renderHook<{ state: unknown; error: string | null; loading: boolean }, { token: string | null; code: string | null }>>;
  full: (version: number, status: string) => unknown;
  unchanged: (version: number) => unknown;
  apiError: (message: string, status: number) => Error;
}

const streakGames: StreakGame[] = [
  {
    name: 'live-quiz',
    fetch: () => getLiveQuizState as unknown as Fetch,
    render: (token, code) =>
      renderHook((p: { token: string | null; code: string | null }) => useLiveQuizPoll(p.token, p.code), {
        initialProps: { token, code },
      }),
    full: (version, status) => ({ version, status, code: '123456' }),
    unchanged: (version) => ({ version, unchanged: true }),
    apiError: (m, s) => new LiveQuizApiError(m, s),
  },
  {
    name: 'team-arena',
    fetch: () => getTeamArenaState as unknown as Fetch,
    render: (token, code) =>
      renderHook((p: { token: string | null; code: string | null }) => useTeamArenaPoll(p.token, p.code), {
        initialProps: { token, code },
      }),
    full: (version, status) => ({ state_version: version, status, code: '123456' }),
    unchanged: (version) => ({ state_version: version, unchanged: true }),
    apiError: (m, s) => new TeamArenaApiError(m, s),
  },
];

describe.each(streakGames)('$name poll cadence', (game) => {
  it('polls immediately with no after_version, then sends the held version', async () => {
    const fetch = game.fetch();
    fetch.mockResolvedValue(game.full(7, 'active'));
    const { result } = game.render('tok', '123456');
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual(['tok', '123456', undefined]);
    expect(result.current.state).toEqual(game.full(7, 'active'));
    expect(result.current.loading).toBe(false);

    await expectNextPollAfter(fetch, 1000);
    expect(fetch.mock.calls[1]).toEqual(['tok', '123456', 7]);
  });

  it('stays at 1s for 4 unchanged polls, backs off to 3s on the 5th, resets on change', async () => {
    const fetch = game.fetch();
    fetch.mockResolvedValueOnce(game.full(1, 'active'));
    for (let i = 0; i < 5; i += 1) fetch.mockResolvedValueOnce(game.unchanged(1));
    fetch.mockResolvedValueOnce(game.full(2, 'active'));
    fetch.mockResolvedValue(game.unchanged(2));
    game.render('tok', '123456');
    await settle(); // poll 1: full

    for (let i = 0; i < 4; i += 1) await expectNextPollAfter(fetch, 1000); // unchanged 1..4
    await expectNextPollAfter(fetch, 1000); // unchanged #5 fires on the 1s cadence…
    await expectNextPollAfter(fetch, 3000); // …and the poll after it is backed off
    await expectNextPollAfter(fetch, 1000); // a change resets the streak
  });

  it('keeps the held state across unchanged polls', async () => {
    const fetch = game.fetch();
    fetch.mockResolvedValueOnce(game.full(1, 'active'));
    fetch.mockResolvedValue(game.unchanged(1));
    const { result } = game.render('tok', '123456');
    await settle();
    await expectNextPollAfter(fetch, 1000);
    expect(result.current.state).toEqual(game.full(1, 'active'));
  });

  it.each(['lobby', 'ended'])('polls at 2.5s in %s, even before any backoff', async (status) => {
    const fetch = game.fetch();
    fetch.mockResolvedValueOnce(game.full(1, status));
    fetch.mockResolvedValue(game.unchanged(1));
    game.render('tok', '123456');
    await settle();
    await expectNextPollAfter(fetch, 2500);
    // the slow cadence wins over the streak backoff too
    for (let i = 0; i < 6; i += 1) await expectNextPollAfter(fetch, 2500);
  });

  it('adds up to 200ms of jitter', async () => {
    random.mockReturnValue(0.5);
    const fetch = game.fetch();
    fetch.mockResolvedValue(game.full(1, 'active'));
    game.render('tok', '123456');
    await settle();
    await expectNextPollAfter(fetch, 1100);
  });

  it('retries an API error after 3s and surfaces its message', async () => {
    const fetch = game.fetch();
    fetch.mockRejectedValueOnce(game.apiError('伺服器忙碌', 500));
    fetch.mockResolvedValue(game.full(1, 'active'));
    const { result } = game.render('tok', '123456');
    await settle();
    expect(result.current.error).toBe('伺服器忙碌');
    expect(result.current.loading).toBe(false);
    await expectNextPollAfter(fetch, 3000);
    expect(result.current.error).toBeNull();
  });

  it('retries a network error after 3s with the generic message', async () => {
    const fetch = game.fetch();
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetch.mockResolvedValue(game.full(1, 'active'));
    const { result } = game.render('tok', '123456');
    await settle();
    expect(result.current.error).toBe('連線失敗，重新嘗試中…');
    await expectNextPollAfter(fetch, 3000);
  });

  it.each([403, 404])('stops polling on %i', async (status) => {
    const fetch = game.fetch();
    fetch.mockRejectedValue(game.apiError('不在這場遊戲', status));
    const { result } = game.render('tok', '123456');
    await settle();
    expect(result.current.error).toBe('不在這場遊戲');
    await expectNoMorePolls(fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not poll without a token or code', async () => {
    const fetch = game.fetch();
    const a = game.render(null, '123456');
    const b = game.render('tok', null);
    await expectNoMorePolls(fetch);
    expect(fetch).not.toHaveBeenCalled();
    expect(a.result.current.loading).toBe(true);
    expect(b.result.current.state).toBeNull();
  });

  it('stops on unmount', async () => {
    const fetch = game.fetch();
    fetch.mockResolvedValue(game.full(1, 'active'));
    const { unmount } = game.render('tok', '123456');
    await settle();
    unmount();
    await expectNoMorePolls(fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('restarts from scratch when the code changes', async () => {
    const fetch = game.fetch();
    fetch.mockResolvedValue(game.full(9, 'active'));
    const { result, rerender } = game.render('tok', '111111');
    await settle();
    expect(result.current.state).not.toBeNull();

    fetch.mockImplementation(() => new Promise(() => {})); // hold the next poll
    rerender({ token: 'tok', code: '222222' });
    expect(result.current.state).toBeNull();
    expect(result.current.loading).toBe(true);
    await settle();
    expect(fetch).toHaveBeenLastCalledWith('tok', '222222', undefined);
    // the old loop's pending timer is gone: nothing else fires
    await expectNoMorePolls(fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// PK keeps its own two-speed cadence.
// ---------------------------------------------------------------------------

describe('pk poll cadence', () => {
  const fetch = () => getPkMatchState as unknown as Fetch;
  const full = (version: number, status: string) => ({ version, status, match_id: 5 });
  const unchanged = (version: number) => ({ version, unchanged: true });
  const render = (token: string | null, matchId: number | null) =>
    renderHook((p: { token: string | null; matchId: number | null }) => usePkMatchPoll(p.token, p.matchId), {
      initialProps: { token, matchId },
    });

  it('polls immediately with no after_version, then sends the held version', async () => {
    fetch().mockResolvedValue(full(4, 'active'));
    const { result } = render('tok', 5);
    await settle();
    expect(fetch().mock.calls[0]).toEqual(['tok', 5, undefined]);
    expect(result.current.state).toEqual(full(4, 'active'));
    await expectNextPollAfter(fetch(), 1000);
    expect(fetch().mock.calls[1]).toEqual(['tok', 5, 4]);
  });

  it('never backs off on an unchanged streak while active', async () => {
    fetch().mockResolvedValueOnce(full(1, 'active'));
    fetch().mockResolvedValue(unchanged(1));
    const { result } = render('tok', 5);
    await settle();
    for (let i = 0; i < 10; i += 1) await expectNextPollAfter(fetch(), 1000);
    expect(result.current.state).toEqual(full(1, 'active'));
  });

  it.each(['waiting', 'lobby', 'ended', 'finished'])('polls at 3s once status is %s (no 2.5s tier)', async (status) => {
    fetch().mockResolvedValueOnce(full(1, status));
    fetch().mockResolvedValue(unchanged(1));
    render('tok', 5);
    await settle();
    await expectNextPollAfter(fetch(), 3000);
    await expectNextPollAfter(fetch(), 3000);
  });

  it('returns to 1s when the match becomes active again', async () => {
    fetch().mockResolvedValueOnce(full(1, 'waiting'));
    fetch().mockResolvedValueOnce(full(2, 'active'));
    fetch().mockResolvedValue(unchanged(2));
    render('tok', 5);
    await settle();
    await expectNextPollAfter(fetch(), 3000);
    await expectNextPollAfter(fetch(), 1000);
  });

  it('adds up to 150ms of jitter (not 200)', async () => {
    random.mockReturnValue(0.5);
    fetch().mockResolvedValue(full(1, 'active'));
    render('tok', 5);
    await settle();
    await expectNextPollAfter(fetch(), 1075);
  });

  it('retries an API error after 3s and surfaces its message', async () => {
    fetch().mockRejectedValueOnce(new PkApiError('對戰忙碌', 500));
    fetch().mockResolvedValue(full(1, 'active'));
    const { result } = render('tok', 5);
    await settle();
    expect(result.current.error).toBe('對戰忙碌');
    await expectNextPollAfter(fetch(), 3000);
    expect(result.current.error).toBeNull();
  });

  it('retries a network error after 3s with the generic message', async () => {
    fetch().mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetch().mockResolvedValue(full(1, 'active'));
    const { result } = render('tok', 5);
    await settle();
    expect(result.current.error).toBe('連線失敗，重新嘗試中…');
    await expectNextPollAfter(fetch(), 3000);
  });

  it.each([403, 404])('stops polling on %i', async (status) => {
    fetch().mockRejectedValue(new PkApiError('不是你的對戰', status));
    render('tok', 5);
    await settle();
    await expectNoMorePolls(fetch());
    expect(fetch()).toHaveBeenCalledTimes(1);
  });

  it('does not poll without a token or with matchId 0/null', async () => {
    render(null, 5);
    render('tok', null);
    render('tok', 0);
    await expectNoMorePolls(fetch());
    expect(fetch()).not.toHaveBeenCalled();
  });

  it('stops on unmount', async () => {
    fetch().mockResolvedValue(full(1, 'active'));
    const { unmount } = render('tok', 5);
    await settle();
    unmount();
    await expectNoMorePolls(fetch());
    expect(fetch()).toHaveBeenCalledTimes(1);
  });
});
