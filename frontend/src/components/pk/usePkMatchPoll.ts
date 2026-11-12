/**
 * usePkMatchPoll — the polling loop for the PK battle screen. Same
 * "1s poll + after_version short-circuit" shape as live-quiz's
 * useLiveQuizPoll.ts (PRD §12 recommends reusing the proven pattern).
 *
 * The loop itself lives in the shared useGamePoll (#3671). PK's cadence is
 * deliberately still its own two-speed one — 1s while the match is active,
 * 3s otherwise, no unchanged-streak backoff, no 2.5s lobby tier. Aligning it
 * with live-quiz/team-arena is a separate behaviour change (#3671 step 1).
 */
import { useMemo } from 'react';
import { getPkMatchState, PkApiError, type PkMatchState } from '../../services/pkApi';
import { useGamePoll, type GamePollConfig, type GamePollResult } from '../game/useGamePoll';

const POLL_INTERVAL_MS = 1000;
const BACKOFF_INTERVAL_MS = 3000;
const JITTER_MS = 150;

export function usePkMatchPoll(token: string | null, matchId: number | null): GamePollResult<PkMatchState> {
  const config = useMemo<GamePollConfig<PkMatchState> | null>(() => {
    if (!token || !matchId) return null;
    return {
      fetchState: (afterVersion) => getPkMatchState(token, matchId, afterVersion),
      isUnchanged: (next) => 'unchanged' in next && Boolean(next.unchanged),
      versionOf: (next) => next.version,
      intervalFor: (current) => {
        const stillActive = current ? current.status === 'active' : true;
        return stillActive ? POLL_INTERVAL_MS : BACKOFF_INTERVAL_MS;
      },
      errorRetryMs: BACKOFF_INTERVAL_MS,
      jitterMs: JITTER_MS,
      ApiError: PkApiError,
    };
  }, [token, matchId]);

  return useGamePoll(config);
}
