/**
 * useTeamArenaPoll — same polling-loop shape as live_quiz's
 * useLiveQuizPoll.ts (1s poll with jitter, back off to 3s after 5
 * unchanged polls, slower 2.5s cadence in lobby/ended — the same
 * external-review-driven tuning that hook documents, reused here rather
 * than reinvented).
 *
 * Sends `after_version` every call so an unchanged poll is the cheap
 * `{unchanged: true}` shape engine.get_state returns.
 */
import { useEffect, useRef, useState } from 'react';
import {
  getTeamArenaState,
  isUnchangedState,
  TeamArenaApiError,
  type TeamArenaState,
} from '../../services/teamArenaApi';

const BASE_INTERVAL_MS = 1000;
const BACKOFF_INTERVAL_MS = 3000;
const SLOW_INTERVAL_MS = 2500;
const JITTER_MS = 200;
const UNCHANGED_STREAK_FOR_BACKOFF = 5;

interface UseTeamArenaPollResult {
  state: TeamArenaState | null;
  error: string | null;
  loading: boolean;
}

export function useTeamArenaPoll(token: string | null, code: string | null): UseTeamArenaPollResult {
  const [state, setState] = useState<TeamArenaState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const versionRef = useRef<number | undefined>(undefined);
  const unchangedStreakRef = useRef(0);
  const stateRef = useRef<TeamArenaState | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!token || !code) return undefined;
    cancelledRef.current = false;
    versionRef.current = undefined;
    unchangedStreakRef.current = 0;
    stateRef.current = null;
    setState(null);
    setLoading(true);

    // Single self-recursive function, same no-use-before-define reasoning
    // as useLiveQuizPoll.ts (rules/frontend-render-safety.md, #2279).
    const poll = async () => {
      if (cancelledRef.current) return;

      const scheduleNext = (delay: number) => {
        if (cancelledRef.current) return;
        const jitter = Math.random() * JITTER_MS;
        timerRef.current = window.setTimeout(poll, delay + jitter);
      };

      try {
        const next = await getTeamArenaState(token, code, versionRef.current);
        if (cancelledRef.current) return;
        setError(null);
        setLoading(false);

        if (isUnchangedState(next)) {
          unchangedStreakRef.current += 1;
        } else {
          unchangedStreakRef.current = 0;
          versionRef.current = next.state_version;
          stateRef.current = next;
          setState(next);
        }

        const current = stateRef.current;
        const isIdlePhase =
          current && !isUnchangedState(current) ? current.status === 'lobby' || current.status === 'ended' : false;
        const interval = isIdlePhase
          ? SLOW_INTERVAL_MS
          : unchangedStreakRef.current >= UNCHANGED_STREAK_FOR_BACKOFF
            ? BACKOFF_INTERVAL_MS
            : BASE_INTERVAL_MS;
        scheduleNext(interval);
      } catch (err) {
        if (cancelledRef.current) return;
        setLoading(false);
        if (err instanceof TeamArenaApiError) {
          setError(err.message);
          if (err.status === 403 || err.status === 404) return;
        } else {
          setError('連線失敗，重新嘗試中…');
        }
        scheduleNext(BACKOFF_INTERVAL_MS);
      }
    };

    void poll();

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [token, code]);

  return { state, error, loading };
}
