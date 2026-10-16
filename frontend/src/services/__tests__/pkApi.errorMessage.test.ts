/**
 * #3610: PK screens show `PkApiError.message` to the student verbatim. The
 * backend's grade-3 path used to return `No lessons found for grade '3'`,
 * which reached a 3rd-grader's screen as raw English. Whatever detail the
 * server sends, the message a student sees must be Chinese.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { challengePkAi, PkApiError } from '../pkApi';

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

async function errorFor(status: number, body: unknown): Promise<PkApiError> {
  respond(status, body);
  try {
    await challengePkAi('t', { scope_type: 'grade_pool', scope_ref: '3', bot_tier: 1 });
  } catch (e) {
    return e as PkApiError;
  }
  throw new Error('expected challengePkAi to throw');
}

const CJK = /[一-鿿]/;

describe('pkApi error messages shown to students', () => {
  beforeEach(() => fetchMock.mockReset());

  it('keeps a Chinese server detail as-is', async () => {
    const err = await errorFor(400, { detail: '這個年級目前還沒有題目，請改選其他範圍' });
    expect(err).toBeInstanceOf(PkApiError);
    expect(err.message).toBe('這個年級目前還沒有題目，請改選其他範圍');
    expect(err.status).toBe(400);
  });

  it.each([
    [400, { detail: "No lessons found for grade '3'" }],
    [500, { detail: 'Internal Server Error' }],
    [422, { detail: [{ loc: ['body', 'bot_tier'], msg: 'field required' }] }],
    [502, 'not json at all'],
  ])('replaces a non-Chinese detail (%s) with a Chinese message', async (status, body) => {
    const err = await errorFor(status, body);
    expect(err.status).toBe(status);
    expect(typeof err.message).toBe('string');
    expect(err.message).toMatch(CJK);
    expect(err.message).not.toMatch(/No lessons|Internal Server|field required|Request failed/);
  });
});
