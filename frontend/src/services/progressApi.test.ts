import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * #3719 — IAP-prep flips staging/preview to the same relative VITE_API_URL=""
 * that production's Firebase Hosting build already uses (apiConfig.ts's
 * `??` keeps the empty string rather than falling back to localhost).
 *
 * `getErrorPatterns` builds its URL with `new URL(...)` and no base.
 * `new URL('/api/...')` with a relative string and no base throws
 * ("Invalid URL") — it only happened to work before because every
 * environment that called it had an absolute API_BASE. Red -> Green.
 */
describe('getErrorPatterns with a relative (same-origin) API_BASE', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not throw and calls the relative /api path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error_patterns: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getErrorPatterns } = await import('./progressApi');
    await expect(getErrorPatterns('tok', 42)).resolves.toEqual({ error_patterns: [] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe('/api/learning/students/42/error-patterns');
  });

  it('still appends the story_slug query param when given one', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error_patterns: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getErrorPatterns } = await import('./progressApi');
    await getErrorPatterns('tok', 42, 'my-story');

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe('/api/learning/students/42/error-patterns?story_slug=my-story');
  });
});
