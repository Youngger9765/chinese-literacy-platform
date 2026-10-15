/**
 * useLiveQuizPoll — the one polling loop both the host and player screens
 * use. External review #4 (#3551): "1s poll with jitter, back off to 3s
 * when version unchanged for 5 polls; lobby/finished states poll slower."
 *
 * Sends `after_version` on every call so an unchanged poll is the cheap
 * `{unchanged: true}` shape the backend returns (see
 * engine.build_state) — this hook only replaces its held state when the
 * response is NOT the "unchanged" shortcut.
 */
import { useEffect, useRef, useState } from 'react';
import { getLiveQuizState, LiveQuizApiError, type LiveQuizState } from '../../services/liveQuizApi';

const BASE_INTERVAL_MS = 1000;
const BACKOFF_INTERVAL_MS = 3000;
const SLOW_INTERVAL_MS = 2500; // lobby / ended — nothing time-critical
const JITTER_MS = 200;
const UNCHANGED_STREAK_FOR_BACKOFF = 5;

interface UseLiveQuizPollResult {
  state: LiveQuizState | null;
  error: string | null;
  loading: boolean;
}

export function useLiveQuizPoll(token: string | null, code: string | null): UseLiveQuizPollResult {
  const [state, setState] = useState<LiveQuizState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const versionRef = useRef<number | undefined>(undefined);
  const unchangedStreakRef = useRef(0);
  const stateRef = useRef<LiveQuizState | null>(null);
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

    // A single self-recursive function (not two mutually-referencing consts)
    // so textual declaration order can't trip no-use-before-define — see
    // rules/frontend-render-safety.md (#2279 postmortem) for why this repo
    // enforces that lint as `error`, not just `warn`.
    const poll = async () => {
      if (cancelledRef.current) return;

      const scheduleNext = (delay: number) => {
        if (cancelledRef.current) return;
        const jitter = Math.random() * JITTER_MS;
        timerRef.current = window.setTimeout(poll, delay + jitter);
      };

      try {
        const next = await getLiveQuizState(token, code, versionRef.current);
        if (cancelledRef.current) return;
        setError(null);
        setLoading(false);

        if (next.unchanged) {
          unchangedStreakRef.current += 1;
        } else {
          unchangedStreakRef.current = 0;
          versionRef.current = next.version;
          stateRef.current = next;
          setState(next);
        }

        const current = stateRef.current;
        const isIdlePhase = current ? current.status === 'lobby' || current.status === 'ended' : false;
        const interval = isIdlePhase
          ? SLOW_INTERVAL_MS
          : unchangedStreakRef.current >= UNCHANGED_STREAK_FOR_BACKOFF
            ? BACKOFF_INTERVAL_MS
            : BASE_INTERVAL_MS;
        scheduleNext(interval);
      } catch (err) {
        if (cancelledRef.current) return;
        setLoading(false);
        if (err instanceof LiveQuizApiError) {
          setError(err.message);
          // 403/404 (not a member / game gone) — stop hammering a
          // request that will never succeed.
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
