/**
 * useLiveQuizPoll — the one polling loop both the host and player screens
 * use. External review #4 (#3551): "1s poll with jitter, back off to 3s
 * when version unchanged for 5 polls; lobby/finished states poll slower."
 *
 * The loop itself lives in the shared useGamePoll (#3671); this file only
 * binds live-quiz's endpoint, payload shape and cadence.
 */
import { useMemo } from 'react';
import { getLiveQuizState, LiveQuizApiError, type LiveQuizState } from '../../services/liveQuizApi';
import { streakBackoffInterval, useGamePoll, type GamePollConfig, type GamePollResult } from '../game/useGamePoll';

const ERROR_RETRY_MS = 3000;
const JITTER_MS = 200;

export function useLiveQuizPoll(token: string | null, code: string | null): GamePollResult<LiveQuizState> {
  const config = useMemo<GamePollConfig<LiveQuizState> | null>(() => {
    if (!token || !code) return null;
    return {
      fetchState: (afterVersion) => getLiveQuizState(token, code, afterVersion),
      isUnchanged: (next) => Boolean(next.unchanged),
      versionOf: (next) => next.version,
      intervalFor: (current, unchangedStreak) =>
        streakBackoffInterval(current ? current.status === 'lobby' || current.status === 'ended' : false, unchangedStreak),
      errorRetryMs: ERROR_RETRY_MS,
      jitterMs: JITTER_MS,
      ApiError: LiveQuizApiError,
    };
  }, [token, code]);

  return useGamePoll(config);
}
