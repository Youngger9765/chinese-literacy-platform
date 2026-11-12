import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * #3719 — same bug class as progressApi.test.ts: `listMyTexts` builds its
 * URL with `new URL(...)` and no base, which throws on a relative
 * `API_BASE` (""). IAP-prep makes staging/preview use that same relative
 * value production's Firebase build already does. Red -> Green.
 */
describe('listMyTexts with a relative (same-origin) API_BASE', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not throw and calls the relative /api path with no params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ texts: [], total: 0 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { listMyTexts } = await import('./teacherTextsApi');
    await expect(listMyTexts('tok')).resolves.toEqual({ texts: [], total: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe('/api/teacher/my-texts');
  });

  it('still appends search/grade/genre query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ texts: [], total: 0 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { listMyTexts } = await import('./teacherTextsApi');
    await listMyTexts('tok', { search: 'xyz', grade: 4, genre: 'poem' });

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    const url = new URL(calledUrl, 'http://example.test');
    expect(url.pathname).toBe('/api/teacher/my-texts');
    expect(url.searchParams.get('search')).toBe('xyz');
    expect(url.searchParams.get('grade')).toBe('4');
    expect(url.searchParams.get('genre')).toBe('poem');
  });
});
