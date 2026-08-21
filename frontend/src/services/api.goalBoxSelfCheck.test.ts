/**
 * #2752 Phase 2 regression: fetchStory must carry goal_box / self_check_before_reading
 * through to the Story object — same class of bug as the 6 文言文 modules, but
 * spanning ~70/58 regular lessons instead of one genre.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

vi.mock('../config/assetBase', () => ({ ASSET_BASE: '' }));

import { fetchStory } from './api';

function mockJsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const BASE_DETAIL_FIELDS = {
  lesson_number: 49,
  id: 20049,
  title: '正太與小豬：武僧的養成之路',
  grade: '6',
  grade_code: 'G6-L0',
  genre: '記敘文',
  category: 'Fable',
  char_count: 500,
  reading_strategy: '讀出故事道理',
  intro: { author: '', background: '' },
  paragraphs: [],
  source_file: null,
};

describe('fetchStory — goal_box / self_check_before_reading (#2752 Phase 2)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('carries goal_box through to the Story object', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({
        ...BASE_DETAIL_FIELDS,
        goal_box: { title: '閱讀之旅的起點', strategy_line: '目標策略：讀出故事道理' },
        self_check_before_reading: null,
      }),
    );
    const story = await fetchStory('49');
    expect(story.goalBox?.strategy_line).toBe('目標策略：讀出故事道理');
    expect(story.selfCheckBeforeReading).toBeUndefined();
  });

  it('carries self_check_before_reading through to the Story object', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({
        ...BASE_DETAIL_FIELDS,
        goal_box: null,
        self_check_before_reading: {
          instruction: '※ 如果你有做到下列事項，請在□內打勾。',
          items: ['請在不太了解的字、詞或句做記號。'],
        },
      }),
    );
    const story = await fetchStory('49');
    expect(story.goalBox).toBeUndefined();
    expect(story.selfCheckBeforeReading?.items).toEqual(['請在不太了解的字、詞或句做記號。']);
  });

  it('a lesson with neither gets undefined for both, not null/empty objects', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({ ...BASE_DETAIL_FIELDS, goal_box: null, self_check_before_reading: null }),
    );
    const story = await fetchStory('49');
    expect(story.goalBox).toBeUndefined();
    expect(story.selfCheckBeforeReading).toBeUndefined();
  });
});
