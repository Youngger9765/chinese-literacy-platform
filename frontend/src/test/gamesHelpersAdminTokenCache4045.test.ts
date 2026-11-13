/**
 * Issue #4045 (E2E flakiness item) — `games/helpers.ts`'s `adminToken()`
 * must cache the token at module scope instead of logging in fresh every
 * call.
 *
 * Production evidence: two Playwright CI runs on
 * `games/league-season.spec.ts` (2026-11-12, run ids 43243534002 and
 * 43243563888) failed with:
 *
 *   Error: login failed for admin@test.com: 429
 *   {"detail":"Too many requests. Please try again later."}
 *
 * The backend's per-account login rate limit is 10 requests per 60s
 * window (`app/routes/auth.py`, `login:acct:{key}`). This suite runs
 * with Playwright `workers: 1` -- one process runs ~40 spec files
 * serially, and every file that calls `adminToken()` (this helper, plus
 * demo-path.spec.ts and full-qa.spec.ts) shares that same 60s budget for
 * the literal string `admin@test.com`. A single `league-season.spec.ts`
 * test alone calls `adminToken()` up to 3 times
 * (createOrgLinkedSchool + createClassroomForTeacher x2).
 *
 * TDD phases:
 *   RED   -> the pre-#4045 `adminToken()` calls `apiLogin` (and therefore
 *            `request.post`) once per invocation -- calling it twice
 *            produces two POSTs.
 *   GREEN -> the fixed version calls `request.post` exactly once no
 *            matter how many times `adminToken()` is awaited.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { APIRequestContext } from '@playwright/test';

// `tests/e2e/**` is excluded from vitest's own test glob (vite.config.ts) so
// this suite never collects Playwright specs, but importing a plain helper
// module FROM vitest is fine -- only `.spec.ts` discovery is excluded.
import { adminToken, __resetAdminTokenCacheForTests } from '../../tests/e2e/games/helpers';

function fakeRequestContext(responseBody: Record<string, unknown>) {
  const post = vi.fn().mockResolvedValue({
    ok: () => true,
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  });
  return { post } as unknown as APIRequestContext & { post: typeof post };
}

describe('games/helpers.ts adminToken() caching (#4045)', () => {
  beforeEach(() => {
    __resetAdminTokenCacheForTests();
  });

  it('only logs in once across multiple calls in the same worker', async () => {
    const request = fakeRequestContext({ access_token: 'fake-admin-jwt' });

    const first = await adminToken(request);
    const second = await adminToken(request);
    const third = await adminToken(request);

    expect(first).toBe('fake-admin-jwt');
    expect(second).toBe('fake-admin-jwt');
    expect(third).toBe('fake-admin-jwt');
    expect(request.post).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed login -- the next call retries instead of repeating the same failure forever', async () => {
    const failingPost = vi.fn().mockResolvedValue({
      ok: () => false,
      status: () => 429,
      json: async () => ({}),
      text: async () => '{"detail":"Too many requests. Please try again later."}',
    });
    const failingRequest = { post: failingPost } as unknown as APIRequestContext;

    await expect(adminToken(failingRequest)).rejects.toThrow(/login failed/);

    const succeedingPost = vi.fn().mockResolvedValue({
      ok: () => true,
      status: () => 200,
      json: async () => ({ access_token: 'recovered-jwt' }),
      text: async () => '{}',
    });
    const recoveredRequest = { post: succeedingPost } as unknown as APIRequestContext;

    const token = await adminToken(recoveredRequest);
    expect(token).toBe('recovered-jwt');
    expect(succeedingPost).toHaveBeenCalledTimes(1);
  });
});
