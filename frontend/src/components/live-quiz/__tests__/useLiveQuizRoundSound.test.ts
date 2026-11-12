/**
 * useLiveQuizRoundSound — wires liveQuizRoundSound's three chimes to game
 * state transitions (lobby loop / countdown ticks / reveal sting), issue
 * #3631 P0 #6.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LiveQuizState } from '../../../services/liveQuizApi';

const playLobbyTick = vi.fn();
const playCountdownTick = vi.fn();
const playRevealSting = vi.fn();

vi.mock('../liveQuizRoundSound', () => ({
  playLobbyTick: (...args: unknown[]) => playLobbyTick(...args),
  playCountdownTick: (...args: unknown[]) => playCountdownTick(...args),
  playRevealSting: (...args: unknown[]) => playRevealSting(...args),
  // muted=false, reducedMotion ignored for these tests (tested directly in
  // podiumSound.test.ts / liveQuizRoundSound.test.ts — this hook just
  // needs *a* toggle function to exist).
  useLiveQuizSoundMute: () => [false, vi.fn()],
}));

vi.mock('../../pk/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => false,
}));

// Imported AFTER the mocks above so the hook picks them up.
// eslint-disable-next-line import/first -- intentional, see comment above
import { useLiveQuizRoundSound } from '../useLiveQuizRoundSound';

function baseState(overrides: Partial<LiveQuizState>): LiveQuizState {
  return {
    code: '123456',
    status: 'lobby',
    version: 1,
    server_now: new Date().toISOString(),
    round_index: -1,
    rounds_total: 3,
    question_started_at: null,
    answer_open_at: null,
    reading_seconds: 0,
    round: null,
    answered_count: null,
    players_count: 1,
    is_host: true,
    classroom_id: null,
    settings: {
      seconds: 30,
      question_count_mode: 'all',
      shuffle: false,
      show_leaderboard_after_each: true,
      double_points_last: false,
      streak_bonus: false,
      practice_mode: false,
      source_modules: ['comprehension'],
    },
    ended_reason: null,
    ended_by_host: false,
    ...overrides,
  } as LiveQuizState;
}

describe('useLiveQuizRoundSound', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    playLobbyTick.mockClear();
    playCountdownTick.mockClear();
    playRevealSting.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('plays the lobby tick while status is lobby and stops once the game starts', () => {
    const { rerender } = renderHook(({ state }) => useLiveQuizRoundSound(state), {
      initialProps: { state: baseState({ status: 'lobby' }) },
    });
    expect(playLobbyTick).toHaveBeenCalledTimes(1); // immediate tick on entering lobby
    vi.advanceTimersByTime(2500);
    expect(playLobbyTick.mock.calls.length).toBeGreaterThanOrEqual(2);

    const callsSoFar = playLobbyTick.mock.calls.length;
    rerender({ state: baseState({ status: 'question', round_index: 0 }) });
    vi.advanceTimersByTime(10_000);
    expect(playLobbyTick.mock.calls.length).toBe(callsSoFar); // no more ticks once left the lobby
  });

  it('plays the reveal sting exactly once per round entering reveal', () => {
    const { rerender } = renderHook(({ state }) => useLiveQuizRoundSound(state), {
      initialProps: { state: baseState({ status: 'question', round_index: 0 }) },
    });
    expect(playRevealSting).not.toHaveBeenCalled();

    rerender({ state: baseState({ status: 'reveal', round_index: 0 }) });
    expect(playRevealSting).toHaveBeenCalledTimes(1);

    // A re-render with the SAME round still revealed must not re-fire.
    rerender({ state: baseState({ status: 'reveal', round_index: 0 }) });
    expect(playRevealSting).toHaveBeenCalledTimes(1);

    // Next round reaching reveal fires again.
    rerender({ state: baseState({ status: 'reveal', round_index: 1 }) });
    expect(playRevealSting).toHaveBeenCalledTimes(2);
  });

  it('ticks the countdown only in the final seconds of an open answer window', () => {
    const now = new Date('2026-10-19T00:00:00.000Z');
    vi.setSystemTime(now);
    const answerOpenAt = new Date(now.getTime() - 27_000).toISOString(); // 27s into a 30s window -> 3s left
    renderHook(() =>
      useLiveQuizRoundSound(
        baseState({
          status: 'question',
          round_index: 0,
          answer_open_at: answerOpenAt,
          server_now: now.toISOString(),
          round: {
            item_id: 'x', source_module: 'comprehension', lesson_uid: 'L1', lesson_title: 't',
            stem: 's', options: [{ key: 'A', text: 'a' }], seconds: 30, reading_seconds: 2,
          },
        }),
      ),
    );
    vi.advanceTimersByTime(3_200);
    expect(playCountdownTick.mock.calls.length).toBeGreaterThan(0);
  });

  it('never ticks the countdown during the reading phase (no options yet)', () => {
    const now = new Date('2026-10-19T00:00:00.000Z');
    vi.setSystemTime(now);
    renderHook(() =>
      useLiveQuizRoundSound(
        baseState({
          status: 'question',
          round_index: 0,
          answer_open_at: new Date(now.getTime() + 2000).toISOString(), // opens in the future
          server_now: now.toISOString(),
          round: {
            item_id: 'x', source_module: 'comprehension', lesson_uid: 'L1', lesson_title: 't',
            stem: 's', seconds: 30, reading_seconds: 2, // no `options` -> reading phase
          },
        }),
      ),
    );
    vi.advanceTimersByTime(5000);
    expect(playCountdownTick).not.toHaveBeenCalled();
  });

  it('returns a stable muted/toggle pair from the shared mute hook', () => {
    const { result } = renderHook(() => useLiveQuizRoundSound(baseState({ status: 'lobby' })));
    expect(result.current.muted).toBe(false);
    expect(typeof result.current.toggleMuted).toBe('function');
  });
});
