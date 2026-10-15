/**
 * #3437: the report page marks the session completed via PATCH but never read the
 * response body. Over HTTP/3, Chromium keeps such a request open until the body is
 * consumed (CDP: responseReceived 200, then no loadingFinished), so `networkidle`
 * never arrives and E2E A9 timed out in ~half of all runs.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { completeSelfPracticeSession } from '../session';

afterEach(() => vi.unstubAllGlobals());

describe('completeSelfPracticeSession (#3437)', () => {
  it('reads the response body so the request can finish', async () => {
    const res = new Response(JSON.stringify({ id: 1, status: 'completed' }), { status: 200 });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(res)));
    await completeSelfPracticeSession(1, 't');
    expect(res.bodyUsed).toBe(true);
  });

  it('still throws on a failed response (and does not hang on the body)', async () => {
    const res = new Response('nope', { status: 500 });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(res)));
    await expect(completeSelfPracticeSession(1, 't')).rejects.toThrow(/500/);
  });
});
