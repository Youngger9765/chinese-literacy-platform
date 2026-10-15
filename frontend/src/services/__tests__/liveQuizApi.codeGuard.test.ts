/**
 * External security review on the #3551 PR: `code` reaches this API client
 * from a raw URL segment (`/live/:code`, `/teacher/live/:code`) — a caller
 * can put anything in it, including a traversal-shaped value like
 * `..%2F..%2Fsomething`. Every function below that builds a fetch path from
 * `code` must reject anything that isn't the 6-digit shape BEFORE calling
 * fetch at all, so a crafted deep-link can never turn into a request
 * against some other endpoint carrying the caller's bearer token
 * (client-side path traversal / CSPT).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import {
  joinLiveQuizGame,
  removeLiveQuizPlayer,
  getLiveQuizState,
  submitLiveQuizAnswer,
  startLiveQuizGame,
  revealLiveQuizRound,
  nextLiveQuizRound,
  endLiveQuizGame,
  getLiveQuizResults,
  isValidLiveQuizCode,
  LiveQuizApiError,
} from '../liveQuizApi';

const MALICIOUS_CODES = [
  '../x',
  '123/../',
  '%2e%2e',
  '1234567', // 7 digits
  'abcdef', // letters
  '', // empty
];

// One call per exported function that builds a path from `code` — if any
// of these stopped validating, this list is how a mutation test catches it.
const CALLS: Array<[string, (code: string) => Promise<unknown>]> = [
  ['joinLiveQuizGame', (code) => joinLiveQuizGame('tok', code)],
  ['removeLiveQuizPlayer', (code) => removeLiveQuizPlayer('tok', code, 1)],
  ['getLiveQuizState', (code) => getLiveQuizState('tok', code)],
  ['submitLiveQuizAnswer', (code) => submitLiveQuizAnswer('tok', code, { choice_key: 'A' })],
  ['startLiveQuizGame', (code) => startLiveQuizGame('tok', code)],
  ['revealLiveQuizRound', (code) => revealLiveQuizRound('tok', code)],
  ['nextLiveQuizRound', (code) => nextLiveQuizRound('tok', code)],
  ['endLiveQuizGame', (code) => endLiveQuizGame('tok', code)],
  ['getLiveQuizResults', (code) => getLiveQuizResults('tok', code)],
];

describe('isValidLiveQuizCode', () => {
  it('accepts exactly 6 digits', () => {
    expect(isValidLiveQuizCode('123456')).toBe(true);
  });

  it.each(MALICIOUS_CODES)('rejects %p', (code) => {
    expect(isValidLiveQuizCode(code)).toBe(false);
  });

  it('rejects null/undefined without throwing', () => {
    expect(isValidLiveQuizCode(null)).toBe(false);
    expect(isValidLiveQuizCode(undefined)).toBe(false);
  });
});

describe('every live-quiz API function guards its code param', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  for (const [name, call] of CALLS) {
    for (const bad of MALICIOUS_CODES) {
      it(`${name} rejects "${bad}" before calling fetch`, async () => {
        await expect(call(bad)).rejects.toThrow(LiveQuizApiError);
        expect(fetchMock).not.toHaveBeenCalled();
      });
    }

    it(`${name} builds the expected URL for a valid code (and only calls fetch once)`, async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      await call('123456');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0] as [string, unknown];
      // The valid code appears verbatim in the URL, and never anything
      // else a malicious code could have smuggled in.
      expect(url).toContain('/games/123456');
      expect(url).not.toMatch(/\.\./);
    });
  }
});
