/**
 * usePkMatchPoll — the polling loop for the PK battle screen. Same
 * "1s poll + after_version short-circuit" shape as live-quiz's
 * useLiveQuizPoll.ts (PRD §12 recommends reusing the proven pattern).
 */
import { useEffect, useRef, useState } from 'react';
import { getPkMatchState, PkApiError, type PkMatchState } from '../../services/pkApi';

const POLL_INTERVAL_MS = 1000;
const BACKOFF_INTERVAL_MS = 3000;
const JITTER_MS = 150;

interface UsePkMatchPollResult {
  state: PkMatchState | null;
  error: string | null;
  loading: boolean;
}

export function usePkMatchPoll(token: string | null, matchId: number | null): UsePkMatchPollResult {
  const [state, setState] = useState<PkMatchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const versionRef = useRef<number | undefined>(undefined);
  const stateRef = useRef<PkMatchState | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!token || !matchId) return undefined;
    cancelledRef.current = false;
    versionRef.current = undefined;
    stateRef.current = null;
    setState(null);
    setLoading(true);

    const poll = async () => {
      if (cancelledRef.current) return;

      const scheduleNext = (delay: number) => {
        if (cancelledRef.current) return;
        const jitter = Math.random() * JITTER_MS;
        timerRef.current = window.setTimeout(poll, delay + jitter);
      };

      try {
        const next = await getPkMatchState(token, matchId, versionRef.current);
        if (cancelledRef.current) return;
        setError(null);
        setLoading(false);

        if (!('unchanged' in next) || !next.unchanged) {
          versionRef.current = next.version;
          stateRef.current = next;
          setState(next);
        }

        const current = stateRef.current;
        const stillActive = current ? current.status === 'active' : true;
        scheduleNext(stillActive ? POLL_INTERVAL_MS : BACKOFF_INTERVAL_MS);
      } catch (err) {
        if (cancelledRef.current) return;
        setLoading(false);
        if (err instanceof PkApiError) {
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
  }, [token, matchId]);

  return { state, error, loading };
}
