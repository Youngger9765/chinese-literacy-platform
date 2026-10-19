/**
 * Same reasoning as pkApi.errorMessage.test.ts (#3610): whatever detail the
 * server sends, the message a student/teacher sees must be Chinese.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { TeamArenaApiError, controlTeamArena } from '../teamArenaApi';

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

async function errorFor(status: number, body: unknown): Promise<TeamArenaApiError> {
  respond(status, body);
  try {
    await controlTeamArena('t', 'AB12CD', 'start');
  } catch (e) {
    return e as TeamArenaApiError;
  }
  throw new Error('expected controlTeamArena to throw');
}

const CJK = /[一-鿿]/;

describe('teamArenaApi error messages', () => {
  beforeEach(() => fetchMock.mockReset());

  it('keeps a Chinese server detail as-is', async () => {
    const err = await errorFor(409, { detail: '只能在等待室開始' });
    expect(err).toBeInstanceOf(TeamArenaApiError);
    expect(err.message).toBe('只能在等待室開始');
    expect(err.status).toBe(409);
  });

  it.each([
    [500, { detail: 'Internal Server Error' }],
    [422, { detail: [{ loc: ['body', 'action'], msg: 'field required' }] }],
    [502, 'not json at all'],
  ])('replaces a non-Chinese detail (%s) with a Chinese message', async (status, body) => {
    const err = await errorFor(status, body);
    expect(err.status).toBe(status);
    expect(err.message).toMatch(CJK);
    expect(err.message).not.toMatch(/Internal Server|field required|Request failed/);
  });
});
