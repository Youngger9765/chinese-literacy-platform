/**
 * `fetchStory` 必須把後端的 `lesson_uid` 帶到 `story.lessonUid`（#3218）
 *
 * ## 為什麼需要這一支
 *
 * `fetchStory` 不是走 `camelizeKeys`，是走 `apiDetailToStory()` 的**明確映射** ——
 * 沒列到的欄位會被靜靜丟掉。而 `story.lessonUid` 是整條注音查表路徑的入口：
 *
 *     story.lessonUid → useLessonZhuyin → GET /api/lessons/{uid}/zhuyin → 查表
 *
 * 少了那一行映射，`lessonUid` 永遠 undefined → 不 fetch → 回去走 fallback 自己算，
 * **而畫面上看不出任何異常**。
 *
 * ⚠️ `zhuyinAnswerTable3218.test.tsx` 抓不到這個 —— 它直接呼叫
 * `loadLessonZhuyin('L0001')`，繞過了這個映射。實際踩到過（2026-09-15）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchStory } from '../api';

/** 後端 `/api/stories/{id}` 真實回應的最小形狀（欄位名照後端 snake_case） */
function apiDetail(extra: Record<string, unknown> = {}) {
  return {
    id: 20011,
    lesson_number: 20011,
    lesson_uid: 'L0011',
    title: '十秒鐘你能做什麼',
    grade: '4',
    grade_code: 'G4-L1',
    genre: '記敘文',
    category: 'Daily',
    text_type: '記敘',
    paragraph_count: 6,
    char_count: 688,
    source_file: 'x.docx',
    thumbnail_url: null,
    reading_strategy: null,
    reading_strategy_explained: null,
    intro: null,
    paragraphs: ['十秒鐘你能做什麼？'],
    vocabulary: null,
    fill_in_blank: null,
    multiple_choice: null,
    reading_benchmark: null,
    key_reading: null,
    ...extra,
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => apiDetail(),
  }) as unknown as Response));
});

afterEach(() => vi.restoreAllMocks());

describe('#3218 lesson_uid 要一路到 story.lessonUid', () => {
  it('⭐ 後端給 lesson_uid → story.lessonUid 拿得到', async () => {
    const story = await fetchStory('20011');
    expect(story.lessonUid).toBe('L0011');
  });

  it('後端沒給（一修舊列）→ undefined，不是空字串也不是 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => {
        const d = apiDetail();
        delete (d as Record<string, unknown>).lesson_uid;
        return d;
      },
    }) as unknown as Response));
    const story = await fetchStory('20012');
    expect(story.lessonUid).toBeUndefined();
  });

  it('正向對照：這支測試真的在跑映射（別的欄位也對）', async () => {
    // 少了這條，「映射整個壞掉」也會讓上面第二條綠
    const story = await fetchStory('20013');
    expect(story.title).toBe('十秒鐘你能做什麼');
    expect(story.content).toEqual(['十秒鐘你能做什麼？']);
  });
});
