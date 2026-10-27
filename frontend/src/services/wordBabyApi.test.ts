import { describe, it, expect, vi, afterEach } from 'vitest';
import captures from './__fixtures__/wordBabyApiCaptures.json';

/**
 * wordBabyApi contract tests (#3780).
 *
 * The mocked fetch responses below are byte-for-byte copies of REAL backend
 * responses, captured by running backend/app/routes/learning/word_babies.py
 * through a FastAPI TestClient (see the capture script referenced in the
 * PR description) — not hand-typed guesses of what the fields might be
 * called. If the backend's response shape ever drifts, re-capture
 * `__fixtures__/wordBabyApiCaptures.json` rather than hand-editing it.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchMyWordBabies', () => {
  it('calls the real endpoint path and returns the exact backend shape (empty collection)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => captures.get_my_pets_empty,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchMyWordBabies } = await import('./wordBabyApi');
    const result = await fetchMyWordBabies(1, 'tok');

    expect(result).toEqual(captures.get_my_pets_empty);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/learning\/students\/1\/word-babies$/);
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('round-trips a populated response including the wallet and hatch_days_remaining fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => captures.get_my_pets_with_one_healthy_baby,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchMyWordBabies } = await import('./wordBabyApi');
    const result = await fetchMyWordBabies(1, 'tok');

    expect(result.babies).toHaveLength(1);
    expect(result.babies[0].baby_id).toBe('wb-071');
    expect(result.babies[0].hatch_days_remaining).toBeNull();
    expect(result.wallet['朗讀表達']).toBe(2);
    expect(result.wallet['文言文']).toBe(0);
    expect(result.fragments_in_wallet).toBe(2);
  });

  it('round-trips a structured-feeding (epic/legendary) baby with a real non-null fed_by_flavor', async () => {
    // team-lead 2026-10-27: the contract fixture previously only recorded
    // fed_by_flavor=null (a shared-pool species) — this exercises the actual
    // non-null shape so the contract test can't silently drift from it.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => captures.get_my_pets_with_structured_feeding_baby,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchMyWordBabies } = await import('./wordBabyApi');
    const result = await fetchMyWordBabies(1, 'tok');

    expect(result.babies).toHaveLength(1);
    expect(result.babies[0].baby_id).toBe('wb-041');
    expect(result.babies[0].fed_by_flavor).toEqual({ 語文基礎: 1 });
  });

  it('throws ApiError with the status code on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchMyWordBabies } = await import('./wordBabyApi');
    const { ApiError } = await import('./apiConfig');
    await expect(fetchMyWordBabies(1, 'tok')).rejects.toBeInstanceOf(ApiError);
    await expect(fetchMyWordBabies(1, 'tok')).rejects.toMatchObject({ status: 403 });
  });
});

describe('feedWordBaby', () => {
  it('posts to the real endpoint path and returns the exact backend shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => captures.feed_baby_success,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { feedWordBaby } = await import('./wordBabyApi');
    const result = await feedWordBaby(1, 'wb-071', 'tok');

    expect(result).toEqual(captures.feed_baby_success);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/learning\/students\/1\/word-babies\/wb-071\/feed$/);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('throws ApiError(404) matching the real "not owned" response shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: captures.feed_baby_404.status,
      json: async () => captures.feed_baby_404.body,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { feedWordBaby } = await import('./wordBabyApi');
    await expect(feedWordBaby(1, 'wb-does-not-exist', 'tok')).rejects.toMatchObject({ status: 404 });
  });
});
