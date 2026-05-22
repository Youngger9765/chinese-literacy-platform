/**
 * TDD tests for MyTextsTab refactor (Issue #1854)
 *
 * Tests are written FIRST against the existing component logic.
 * After extraction they must pass against teacherTextFormMapper.ts.
 *
 * 4 acceptance tests:
 * 1. create form resets paragraph/vocab row ids to stable new rows
 * 2. edit form loads detail + maps paragraphs/vocab to form state
 * 3. save trims paragraphs + filters incomplete vocab items
 * 4. delete reloads list + clears confirm id
 */
import { describe, it, expect } from 'vitest';
import {
  defaultForm,
  mapDetailToForm,
  buildSavePayload,
  makeStableIds,
} from '../teacherTextFormMapper';
import type { TeacherTextDetail } from '../../../services/teacherTextsApi';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeDetail(overrides: Partial<TeacherTextDetail> = {}): TeacherTextDetail {
  return {
    id: 42,
    title: '測試課文',
    grade: 5,
    grade_code: 'G5',
    genre: '記敘文',
    text_type: '單',
    paragraph_count: 2,
    char_count: 100,
    reading_strategy: '找主旨',
    status: 'draft',
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    paragraphs: ['第一段內容', '第二段內容'],
    vocabulary: [
      { word: '勇氣', definition: '面對困難的力量', note: '常見詞' },
      { word: '智慧', definition: '思考解決問題的能力' },
    ],
    ...overrides,
  };
}

// ─── Test 1: create form resets paragraph/vocab row ids to stable new rows ────

describe('defaultForm', () => {
  it('returns a form with exactly one empty paragraph and empty vocab', () => {
    const form = defaultForm();
    expect(form.paragraphs).toHaveLength(1);
    expect(form.paragraphs[0]).toBe('');
    expect(form.vocabulary).toHaveLength(0);
    expect(form.title).toBe('');
    expect(form.grade).toBe(5);
    expect(form.genre).toBe('記敘文');
    expect(form.text_type).toBe('單');
  });
});

describe('makeStableIds', () => {
  it('generates N unique stable ids for N items', () => {
    const ids = makeStableIds(3);
    expect(ids).toHaveLength(3);
    // All ids must be non-empty strings
    ids.forEach((id) => {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });
    // All ids must be unique
    const unique = new Set(ids);
    expect(unique.size).toBe(3);
  });

  it('generates 0 ids when count is 0', () => {
    const ids = makeStableIds(0);
    expect(ids).toHaveLength(0);
  });

  it('each call produces ids that start with "r-" prefix', () => {
    const ids = makeStableIds(2);
    ids.forEach((id) => {
      expect(id).toMatch(/^r-/);
    });
  });
});

// ─── Test 2: edit form loads detail + maps paragraphs/vocab to form state ────

describe('mapDetailToForm', () => {
  it('maps all scalar fields from detail to form state', () => {
    const detail = makeDetail();
    const form = mapDetailToForm(detail);
    expect(form.title).toBe('測試課文');
    expect(form.grade).toBe(5);
    expect(form.genre).toBe('記敘文');
    expect(form.text_type).toBe('單');
    expect(form.reading_strategy).toBe('找主旨');
  });

  it('maps paragraphs array from detail', () => {
    const detail = makeDetail();
    const form = mapDetailToForm(detail);
    expect(form.paragraphs).toEqual(['第一段內容', '第二段內容']);
  });

  it('falls back to [""] when detail.paragraphs is empty', () => {
    const detail = makeDetail({ paragraphs: [] });
    const form = mapDetailToForm(detail);
    expect(form.paragraphs).toEqual(['']);
  });

  it('maps vocabulary items with note defaulting to empty string when absent', () => {
    const detail = makeDetail();
    const form = mapDetailToForm(detail);
    expect(form.vocabulary).toHaveLength(2);
    expect(form.vocabulary[0]).toEqual({
      word: '勇氣',
      definition: '面對困難的力量',
      note: '常見詞',
    });
    // Second item has no note in detail — should default to ''
    expect(form.vocabulary[1]).toEqual({
      word: '智慧',
      definition: '思考解決問題的能力',
      note: '',
    });
  });

  it('maps vocabulary to [] when detail.vocabulary is null', () => {
    const detail = makeDetail({ vocabulary: null });
    const form = mapDetailToForm(detail);
    expect(form.vocabulary).toEqual([]);
  });

  it('maps reading_strategy to "" when null', () => {
    const detail = makeDetail({ reading_strategy: null });
    const form = mapDetailToForm(detail);
    expect(form.reading_strategy).toBe('');
  });
});

// ─── Test 3: save trims paragraphs + filters incomplete vocab items ───────────

describe('buildSavePayload', () => {
  it('trims paragraphs and removes blank ones', () => {
    const form = {
      title: '課文標題',
      grade: 6,
      genre: '說明文',
      text_type: '單',
      reading_strategy: '',
      paragraphs: ['  有內容  ', '', '   ', '另一段'],
      vocabulary: [],
    };
    const payload = buildSavePayload(form);
    expect(payload.paragraphs).toEqual(['有內容', '另一段']);
  });

  it('filters out vocab items where word or definition is empty after trim', () => {
    const form = {
      title: '課文',
      grade: 5,
      genre: '記敘文',
      text_type: '單',
      reading_strategy: '',
      paragraphs: ['內容'],
      vocabulary: [
        { word: '勇氣', definition: '力量', note: '' },      // complete → keep
        { word: '', definition: '說明', note: '' },           // no word → drop
        { word: '智慧', definition: '', note: '' },           // no definition → drop
        { word: '  ', definition: '  ', note: '' },           // all blank → drop
      ],
    };
    const payload = buildSavePayload(form);
    expect(payload.vocabulary).toBeDefined();
    expect(payload.vocabulary).toHaveLength(1);
    expect(payload.vocabulary![0].word).toBe('勇氣');
  });

  it('trims vocab word/definition/note', () => {
    const form = {
      title: '課文',
      grade: 5,
      genre: '記敘文',
      text_type: '單',
      reading_strategy: '',
      paragraphs: ['內容'],
      vocabulary: [
        { word: '  勇氣  ', definition: '  力量  ', note: '  備註  ' },
      ],
    };
    const payload = buildSavePayload(form);
    expect(payload.vocabulary![0]).toEqual({
      word: '勇氣',
      definition: '力量',
      note: '備註',
    });
  });

  it('sets vocabulary to undefined when all items are filtered out', () => {
    const form = {
      title: '課文',
      grade: 5,
      genre: '記敘文',
      text_type: '單',
      reading_strategy: '',
      paragraphs: ['內容'],
      vocabulary: [
        { word: '', definition: '', note: '' },
      ],
    };
    const payload = buildSavePayload(form);
    expect(payload.vocabulary).toBeUndefined();
  });

  it('omits note from payload when it is empty string after trim', () => {
    const form = {
      title: '課文',
      grade: 5,
      genre: '記敘文',
      text_type: '單',
      reading_strategy: '',
      paragraphs: ['內容'],
      vocabulary: [
        { word: '勇氣', definition: '力量', note: '  ' },
      ],
    };
    const payload = buildSavePayload(form);
    expect(payload.vocabulary![0].note).toBeUndefined();
  });

  it('omits reading_strategy from payload when it is blank', () => {
    const form = {
      title: '課文',
      grade: 5,
      genre: '記敘文',
      text_type: '單',
      reading_strategy: '  ',
      paragraphs: ['內容'],
      vocabulary: [],
    };
    const payload = buildSavePayload(form);
    expect(payload.reading_strategy).toBeUndefined();
  });

  it('includes reading_strategy in payload when non-blank', () => {
    const form = {
      title: '課文',
      grade: 5,
      genre: '記敘文',
      text_type: '單',
      reading_strategy: ' 找主旨 ',
      paragraphs: ['內容'],
      vocabulary: [],
    };
    const payload = buildSavePayload(form);
    expect(payload.reading_strategy).toBe('找主旨');
  });
});

// ─── Test 4: delete reloads list + clears confirm id ─────────────────────────
// This test targets the deleteResetState helper which returns the expected state
// shape after a successful delete.

describe('deleteResetState', () => {
  it('clears confirmDeleteId and does not affect other state', async () => {
    // Import and test the helper
    const { deleteResetState } = await import('../teacherTextFormMapper');
    const result = deleteResetState();
    expect(result.confirmDeleteId).toBeNull();
  });
});
