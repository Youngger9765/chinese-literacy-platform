/**
 * #2752 Phase 3 regression: multi_text_parts / cross_text_banner /
 * keypoints_followup_questions / writing_practice must reach the Story object.
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
  lesson_number: 63,
  id: 20063,
  title: '物以稀為貴',
  grade: '6',
  grade_code: 'G6-L22',
  genre: '說明文',
  category: 'Science',
  char_count: 500,
  reading_strategy: 'x',
  intro: { author: '', background: '' },
  paragraphs: [],
  source_file: null,
};

describe('fetchStory — multi_text_parts / cross_text_banner / keypoints_followup_questions / writing_practice (#2752 Phase 3)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('carries all four fields through to the Story object', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({
        ...BASE_DETAIL_FIELDS,
        multi_text_parts: [{ lesson_heading: '第23課', body: { paragraphs: [{ idx: 1, text: '段落一' }] } }],
        cross_text_banner: { title_block: { title: '跨課文習作' } },
        keypoints_followup_questions: { questions: [{ answer: 'A', stem: '題目一' }] },
        writing_practice: { words: ['顫顫巍巍'] },
      }),
    );

    const story = await fetchStory('63');

    expect(story.multiTextParts).toHaveLength(1);
    expect(story.multiTextParts?.[0].lesson_heading).toBe('第23課');
    expect(story.crossTextBanner?.title_block?.title).toBe('跨課文習作');
    expect(story.keypointsFollowupQuestions?.questions).toHaveLength(1);
    expect(story.writingPractice?.words).toEqual(['顫顫巍巍']);
  });

  it('a lesson with none of the four gets undefined for all, not null', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({
        ...BASE_DETAIL_FIELDS,
        multi_text_parts: null,
        cross_text_banner: null,
        keypoints_followup_questions: null,
        writing_practice: null,
      }),
    );

    const story = await fetchStory('63');

    expect(story.multiTextParts).toBeUndefined();
    expect(story.crossTextBanner).toBeUndefined();
    expect(story.keypointsFollowupQuestions).toBeUndefined();
    expect(story.writingPractice).toBeUndefined();
  });
});
