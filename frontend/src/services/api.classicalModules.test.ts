/**
 * #2752 regression: fetchStory must carry the 6 文言文專屬模組 fields through
 * to the Story object the rest of the app consumes — not drop them the way
 * `_uid_tree_lessons()` used to silently drop them server-side (see
 * backend/tests/test_classical_modules_entry_2752.py for the backend half of
 * this lock).
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
  lesson_number: 20155,
  id: 20155,
  title: '不流血的戰爭',
  grade: '文言文',
  grade_code: '文-L12',
  genre: '文言文',
  category: 'History',
  char_count: 500,
  reading_strategy: '文言聚光燈：倒裝句',
  intro: { author: '', background: '' },
  paragraphs: [],
  source_file: null,
};

describe('fetchStory — classical modules (#2752)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('carries all 6 modules through to the Story object', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({
        ...BASE_DETAIL_FIELDS,
        step_sequence: ['lesson-intro', 'classical-text', 'classical-word-matching'],
        classical_text: { paragraphs: ['桓公曰'], annotations: [{ term: '綈', text: '絲織品' }] },
        modern_translation: { paragraphs: ['齊桓公說'] },
        word_matching: { items: [{ index: 1, classical: 'x', vernacular: 'y', blanks: [{ answer: 'z' }] }] },
        sentence_matching: { reference_sentences: { '1': 'a' }, segments: [{ index: 1, classical: 'x', answer: 1 }] },
        self_challenge: { passage: '弈秋，通國之善弈者也。' },
        intro_guide: { text: '導讀文字' },
      }),
    );

    const story = await fetchStory('20155');

    expect(story.classicalText?.paragraphs).toEqual(['桓公曰']);
    expect(story.modernTranslation?.paragraphs).toEqual(['齊桓公說']);
    expect(story.wordMatching?.items).toHaveLength(1);
    expect(story.sentenceMatching?.segments).toHaveLength(1);
    expect(story.selfChallenge?.passage).toBe('弈秋，通國之善弈者也。');
    expect(story.introGuide?.text).toBe('導讀文字');
    expect(story.stepSequence).toEqual(['lesson-intro', 'classical-text', 'classical-word-matching']);
  });

  it('a regular (non-文言文) lesson gets undefined for all 6 fields, not null/empty objects', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({
        ...BASE_DETAIL_FIELDS,
        lesson_number: 1,
        grade: '4',
        genre: '記敘文',
        step_sequence: null,
        classical_text: null,
        modern_translation: null,
        word_matching: null,
        sentence_matching: null,
        self_challenge: null,
        intro_guide: null,
      }),
    );

    const story = await fetchStory('1');

    expect(story.classicalText).toBeUndefined();
    expect(story.modernTranslation).toBeUndefined();
    expect(story.wordMatching).toBeUndefined();
    expect(story.sentenceMatching).toBeUndefined();
    expect(story.selfChallenge).toBeUndefined();
    expect(story.introGuide).toBeUndefined();
    expect(story.stepSequence).toBeUndefined();
  });
});
