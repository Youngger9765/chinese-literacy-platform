/**
 * useGamePoll — the one polling loop behind live-quiz, team-arena and PK
 * (#3671; previously three near-identical copies, see
 * docs/architecture/game-modules.md §2.3).
 *
 * The loop is shared; the cadence is NOT. Each game passes its own
 * `intervalFor`, so live-quiz/team-arena keep "1s, 3s after 5 unchanged
 * polls, 2.5s in lobby/ended" (external review #4, #3551) while PK keeps its
 * two-speed "1s while active, else 3s". gamePollCadence.test.ts locks all
 * three — changing PK's rhythm is its own behaviour change, not a refactor.
 *
 * Sends `after_version` on every call so an unchanged poll is the cheap
 * `{unchanged: true}` shape the backends return — the held state is only
 * replaced when the response is NOT that shortcut.
 */
import { useEffect, useRef, useState } from 'react';

const BASE_INTERVAL_MS = 1000;
const BACKOFF_INTERVAL_MS = 3000;
const SLOW_INTERVAL_MS = 2500; // lobby / ended — nothing time-critical
const UNCHANGED_STREAK_FOR_BACKOFF = 5;

/** live-quiz / team-arena cadence. */
export function streakBackoffInterval(isIdlePhase: boolean, unchangedStreak: number): number {
  if (isIdlePhase) return SLOW_INTERVAL_MS;
  return unchangedStreak >= UNCHANGED_STREAK_FOR_BACKOFF ? BACKOFF_INTERVAL_MS : BASE_INTERVAL_MS;
}

export interface GamePollConfig<T> {
  /** One poll. Bind token/code here; the loop only supplies after_version. */
  fetchState: (afterVersion: number | undefined) => Promise<T>;
  isUnchanged: (response: T) => boolean;
  versionOf: (state: T) => number;
  /** Delay before the next poll, given the held (never "unchanged") state. */
  intervalFor: (state: T | null, unchangedStreak: number) => number;
  errorRetryMs: number;
  jitterMs: number;
  /** The game's API error class; 403/404 from it stop the loop. */
  ApiError: abstract new (message: string, status: number) => Error & { status: number };
}

export interface GamePollResult<T> {
  state: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Pass `null` to stay idle (no token / no game yet). The loop restarts from
 * scratch whenever `config` changes identity, so callers memoize it on the
 * values it closes over (token, code / matchId).
 */
export function useGamePoll<T>(config: GamePollConfig<T> | null): GamePollResult<T> {
  const [state, setState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const versionRef = useRef<number | undefined>(undefined);
  const unchangedStreakRef = useRef(0);
  const stateRef = useRef<T | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!config) return undefined;
    cancelledRef.current = false;
    versionRef.current = undefined;
    unchangedStreakRef.current = 0;
    stateRef.current = null;
    setState(null);
    setLoading(true);

    // A single self-recursive function (not two mutually-referencing consts)
    // so textual declaration order can't trip no-use-before-define — see
    // rules/frontend-render-safety.md (#2279 postmortem) for why this repo
    // enforces that lint as `error`, not just `warn`.
    const poll = async () => {
      if (cancelledRef.current) return;

      const scheduleNext = (delay: number) => {
        if (cancelledRef.current) return;
        const jitter = Math.random() * config.jitterMs;
        timerRef.current = window.setTimeout(poll, delay + jitter);
      };

      try {
        const next = await config.fetchState(versionRef.current);
        if (cancelledRef.current) return;
        setError(null);
        setLoading(false);

        if (config.isUnchanged(next)) {
          unchangedStreakRef.current += 1;
        } else {
          unchangedStreakRef.current = 0;
          versionRef.current = config.versionOf(next);
          stateRef.current = next;
          setState(next);
        }

        scheduleNext(config.intervalFor(stateRef.current, unchangedStreakRef.current));
      } catch (err) {
        if (cancelledRef.current) return;
        setLoading(false);
        if (err instanceof config.ApiError) {
          setError(err.message);
          // 403/404 (not a member / game gone) — stop hammering a
          // request that will never succeed.
          if (err.status === 403 || err.status === 404) return;
        } else {
          setError('連線失敗，重新嘗試中…');
        }
        scheduleNext(config.errorRetryMs);
      }
    };

    void poll();

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [config]);

  return { state, error, loading };
}
