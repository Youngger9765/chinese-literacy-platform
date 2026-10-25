/**
 * useTeamArenaPoll — same cadence as live_quiz's useLiveQuizPoll.ts (1s poll
 * with jitter, back off to 3s after 5 unchanged polls, slower 2.5s cadence
 * in lobby/ended — the same external-review-driven tuning, reused rather
 * than reinvented).
 *
 * The loop itself lives in the shared useGamePoll (#3671); this file only
 * binds team-arena's endpoint, payload shape (`state_version`, not
 * `version`) and cadence.
 */
import { useMemo } from 'react';
import {
  getTeamArenaState,
  isUnchangedState,
  TeamArenaApiError,
  type TeamArenaState,
} from '../../services/teamArenaApi';
import { streakBackoffInterval, useGamePoll, type GamePollConfig, type GamePollResult } from '../game/useGamePoll';

const ERROR_RETRY_MS = 3000;
const JITTER_MS = 200;

export function useTeamArenaPoll(token: string | null, code: string | null): GamePollResult<TeamArenaState> {
  const config = useMemo<GamePollConfig<TeamArenaState> | null>(() => {
    if (!token || !code) return null;
    return {
      fetchState: (afterVersion) => getTeamArenaState(token, code, afterVersion),
      isUnchanged: isUnchangedState,
      versionOf: (next) => next.state_version,
      intervalFor: (current, unchangedStreak) =>
        streakBackoffInterval(
          current && !isUnchangedState(current) ? current.status === 'lobby' || current.status === 'ended' : false,
          unchangedStreak,
        ),
      errorRetryMs: ERROR_RETRY_MS,
      jitterMs: JITTER_MS,
      ApiError: TeamArenaApiError,
    };
  }, [token, code]);

  return useGamePoll(config);
}
