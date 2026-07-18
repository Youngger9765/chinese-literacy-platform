import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  stepSequenceFromWorksheet,
  resolveActiveSteps,
  STEP_REGISTRY,
  KNOWN_UNMAPPED_WORKSHEET_TYPES,
} from './stepConfig';

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

// ---------------------------------------------------------------------------
// #2526 regression — REAL parser vocabulary (not the fictional names above)
//
// The current curriculum SOT serves a worksheet `type` vocabulary that does NOT
// line up with STEP_REGISTRY ids after a plain `_`→`-` swap. Straight from real
// lesson data: backend/data/lessons/_parsed_2026-05-01/G8-L16.yml
// (structure_table/spotlight/mcq/word_search/vocab_definitions appear in 100+
// courses each). Under the old code these all `continue`-dropped SILENTLY, so
// ~74% of sections vanished on ~16 courses with no manual step_sequence.
// ---------------------------------------------------------------------------
const G8_L16_WORKSHEET = [
  { number: '二', name: '念順順', type: 'reading_timer' }, //     AMBIGUOUS → not mapped (warns)
  { number: '三', name: '語詞我最棒', type: 'vocab_definitions' }, // → vocab-definition
  { number: '四', name: '語詞應用', type: 'vocab_application' }, //  → vocab-application (dash only)
  { number: '五', name: '文章重點表', type: 'structure_table' }, //  → story-structure
  { number: '六', name: '知識補給站', type: 'knowledge_station' }, // → knowledge-station (dash only)
  { number: '七', name: '閱讀聚光燈', type: 'spotlight' }, //        → reading-strategy
  { number: '八', name: '閱讀理解', type: 'mcq' }, //               → comprehension
  { number: '九', name: '詞語複習', type: 'word_search' }, //        → vocab-word-search
];

describe('stepSequenceFromWorksheet — REAL parser vocabulary alias map (#2526)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Each of the 5 aliased types + the 2 that already worked via the dash
  // transform MUST resolve to a real STEP_REGISTRY id (no silent drop).
  it.each([
    ['vocab_definitions', 'vocab-definition'], //  ALIAS (plural → singular)
    ['structure_table', 'story-structure'], //     ALIAS
    ['spotlight', 'reading-strategy'], //          ALIAS
    ['mcq', 'comprehension'], //                   ALIAS
    ['word_search', 'vocab-word-search'], //       ALIAS
    ['vocab_application', 'vocab-application'], //  already worked (dash transform)
    ['knowledge_station', 'knowledge-station'], //  already worked (dash transform)
  ])('parser type "%s" resolves to registry id "%s"', (type, expectedId) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(STEP_REGISTRY[expectedId]).toBeDefined();
    const seq = stepSequenceFromWorksheet([{ number: '一', name: 'x', type }]);
    expect(seq).toContain(expectedId);
  });

  it('resolves a full real worksheet in order (reading_timer dropped, other 7 kept)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(stepSequenceFromWorksheet(G8_L16_WORKSHEET)).toEqual([
      'intro',
      'vocab-definition',
      'vocab-application',
      'story-structure',
      'knowledge-station',
      'reading-strategy',
      'comprehension',
      'vocab-word-search',
    ]);
  });

  it('warns (not silently drops) when a section type has no registry match', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stepSequenceFromWorksheet([{ number: '一', name: 'X', type: 'bogus_type' }]);
    expect(warnSpy).toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some((args) => args.some((a) => String(a).includes('bogus_type'))),
    ).toBe(true);
  });

  it('documents reading_timer as the single known-ambiguous unmapped type', () => {
    // Ambiguous: 逐段朗讀 (tutor) vs 全文朗讀 (full-reading). Do NOT guess —
    // needs 方大哥/Young product confirmation. Until then it hits the warn.
    expect([...KNOWN_UNMAPPED_WORKSHEET_TYPES]).toEqual(['reading_timer']);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seq = stepSequenceFromWorksheet([
      { number: '二', name: '念順順', type: 'reading_timer' },
      { number: '八', name: '閱讀理解', type: 'mcq' },
    ]);
    expect(seq).not.toContain('tutor'); //        not guessed
    expect(seq).not.toContain('full-reading'); // not guessed
    expect(seq).toContain('comprehension'); //    mcq still resolves alongside
    expect(
      warnSpy.mock.calls.some((args) => args.some((a) => String(a).includes('reading_timer'))),
    ).toBe(true);
  });
});
