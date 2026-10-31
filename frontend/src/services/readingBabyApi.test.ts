import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * readingBabyApi.ts — API client for 閱讀寶貝 phase 2 (#3780 reading-babies
 * PRD §2). Real backend contract (verified against
 * backend/app/routes/learning/reading_baby.py + backend/app/schemas/reading_baby.py,
 * not guessed):
 *
 *   GET /api/learning/students/{id}/reading-babies              -> ReadingBabyAtlasResponse
 *   GET /api/learning/students/{id}/reading-babies/{lesson_uid} -> ReadingBabyCardResponse
 *
 * This replaces the deleted v1 wordBabyApi.ts (fetchMyWordBabies/feedWordBaby —
 * v1 has no concept of "feeding" so there is no POST here at all).
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SAMPLE_BABY = {
  lesson_uid: 'L0001',
  title: '十秒的背後',
  ability_family: 'D',
  ability_family_name: '寫作鑑賞力',
  stage: 'intermediate' as const,
  assessable_total: 5,
  assessable_passed: 3,
  progress_ratio: 0.6,
  fragments_count: 3,
  next_step: {
    station: 'spotlight',
    station_label: null,
    building: '聚光閣',
    indicator_code: '5-Ⅱ-5',
  },
  all_cleared: false,
};

describe('fetchReadingBabyAtlas', () => {
  it('calls GET /api/learning/students/{id}/reading-babies with the auth header and returns the atlas', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        student_id: 4,
        total_lessons: 179,
        total_fragments: 12,
        babies: [SAMPLE_BABY],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchReadingBabyAtlas } = await import('./readingBabyApi');
    const result = await fetchReadingBabyAtlas(4, 'tok123');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/learning/students/4/reading-babies');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok123' });
    expect(result.total_lessons).toBe(179);
    expect(result.babies[0].lesson_uid).toBe('L0001');
  });

  it('throws ApiError with the response status on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchReadingBabyAtlas, } = await import('./readingBabyApi');
    const { ApiError } = await import('./apiConfig');
    await expect(fetchReadingBabyAtlas(4, 'tok')).rejects.toBeInstanceOf(ApiError);
    await expect(fetchReadingBabyAtlas(4, 'tok')).rejects.toMatchObject({ status: 403 });
  });
});

describe('fetchReadingBabyCard', () => {
  it('calls GET /api/learning/students/{id}/reading-babies/{lesson_uid} and returns one card', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => SAMPLE_BABY });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchReadingBabyCard } = await import('./readingBabyApi');
    const result = await fetchReadingBabyCard(4, 'L0001', 'tok123');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/learning/students/4/reading-babies/L0001');
    expect(result.stage).toBe('intermediate');
    expect(result.next_step?.building).toBe('聚光閣');
  });

  it('throws ApiError(404) when the lesson is not in the 179-lesson mapping', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchReadingBabyCard } = await import('./readingBabyApi');
    const { ApiError } = await import('./apiConfig');
    await expect(fetchReadingBabyCard(4, 'NOPE', 'tok')).rejects.toBeInstanceOf(ApiError);
    await expect(fetchReadingBabyCard(4, 'NOPE', 'tok')).rejects.toMatchObject({ status: 404 });
  });
});
