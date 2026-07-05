import { describe, it, expect } from 'vitest';
import { stepSequenceFromWorksheet, resolveActiveSteps } from './stepConfig';

// The authoritative per-lesson worksheet section order, straight from a real
// lesson YAML (backend/data/lessons/L43.yml worksheet_section_order).
const L43_WORKSHEET = [
  { number: '一', name: '讀全文-做記號', type: 'reading_annotation' },
  { number: '二', name: '逐段朗讀', type: 'tutor' },
  { number: '三', name: '全文朗讀', type: 'full_reading' },
  { number: '四', name: '詞語理解', type: 'vocab_definition' },
  { number: '五', name: '語詞應用', type: 'vocab_application' },
  { number: '六', name: '文章重點表', type: 'story_structure' },
  { number: '七', name: '閱讀聚光燈', type: 'reading_strategy' },
  { number: '八', name: '閱讀理解', type: 'comprehension' },
  { number: '九', name: '語詞複習', type: 'vocab_word_search' },
  { number: '十', name: '知識補給站', type: 'knowledge_station' },
  { number: '十一', name: '報告', type: 'report' },
];

describe('stepSequenceFromWorksheet — 學習步驟動態對應學習單', () => {
  it('maps section type (underscore) → step id (hyphen) and prepends intro', () => {
    expect(stepSequenceFromWorksheet(L43_WORKSHEET)).toEqual([
      'intro',
      'reading-annotation',
      'tutor',
      'full-reading',
      'vocab-definition',
      'vocab-application',
      'story-structure', // worksheet 六 — 文章重點表
      'reading-strategy', // worksheet 七 — 閱讀聚光燈 (AFTER 重點表)
      'comprehension',
      'vocab-word-search',
      'knowledge-station',
      'report',
    ]);
  });

  it('follows the worksheet order, which DIFFERS from the flat DEFAULT', () => {
    // DEFAULT_STEP_SEQUENCE orders reading-strategy BEFORE story-structure;
    // the paper worksheet is the opposite. The nav must follow the paper.
    const seq = stepSequenceFromWorksheet(L43_WORKSHEET)!;
    expect(seq.indexOf('story-structure')).toBeLessThan(seq.indexOf('reading-strategy'));
    const ids = resolveActiveSteps(seq).map((s) => s.id);
    expect(ids.indexOf('story-structure')).toBeLessThan(ids.indexOf('reading-strategy'));
  });

  it('returns null for empty/missing worksheet → caller falls back to DEFAULT', () => {
    expect(stepSequenceFromWorksheet(null)).toBeNull();
    expect(stepSequenceFromWorksheet(undefined)).toBeNull();
    expect(stepSequenceFromWorksheet([])).toBeNull();
  });

  it('skips unknown section types and never double-adds intro', () => {
    expect(
      stepSequenceFromWorksheet([
        { number: '一', name: 'X', type: 'bogus_type' },
        { number: '二', name: '閱讀理解', type: 'comprehension' },
      ]),
    ).toEqual(['intro', 'comprehension']);
  });
});
