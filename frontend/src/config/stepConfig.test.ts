import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  stepSequenceFromManifest,
  resolveActiveSteps,
  STEP_REGISTRY,
  KNOWN_UNMAPPED_WORKSHEET_TYPES,
} from './stepConfig';

// The authoritative per-lesson worksheet section order, straight from a real
// lesson YAML (backend/data/lessons/L43.yml manifest_sections).
const L43_WORKSHEET = [
  { no: '一', name: '讀全文-做記號', module: 'reading_annotation' },
  { no: '二', name: '逐段朗讀', module: 'paragraph-reading' },
  { no: '三', name: '全文朗讀', module: 'full_reading' },
  { no: '四', name: '詞語理解', module: 'vocab_definition' },
  { no: '五', name: '語詞應用', module: 'vocab_application' },
  { no: '六', name: '文章重點表', module: 'story_structure' },
  { no: '七', name: '閱讀聚光燈', module: 'reading_strategy' },
  { no: '八', name: '閱讀理解', module: 'comprehension' },
  { no: '九', name: '語詞複習', module: 'vocab_word_search' },
  { no: '十', name: '知識補給站', module: 'knowledge_station' },
  { no: '十一', name: '報告', module: 'report' },
];

describe('stepSequenceFromManifest — 學習步驟動態對應學習單', () => {
  it('maps section type (underscore) → step id (hyphen) and prepends intro', () => {
    expect(stepSequenceFromManifest(L43_WORKSHEET)).toEqual([
      'lesson-intro',
      'full-text-annotate',
      'paragraph-reading',
      'key-passage-reading',
      'vocab-definition',
      'vocab-application',
      'keypoints-table', // worksheet 六 — 文章重點表
      'spotlight', // worksheet 七 — 閱讀聚光燈 (AFTER 重點表)
      'comprehension',
      'vocab-review',
      'knowledge-station',
      'report',
    ]);
  });

  it('follows the worksheet order, which DIFFERS from the flat DEFAULT', () => {
    // DEFAULT_STEP_SEQUENCE orders reading-strategy BEFORE story-structure;
    // the paper worksheet is the opposite. The nav must follow the paper.
    const seq = stepSequenceFromManifest(L43_WORKSHEET)!;
    expect(seq.indexOf('keypoints-table')).toBeLessThan(seq.indexOf('spotlight'));
    const ids = resolveActiveSteps(seq).map((s) => s.id);
    expect(ids.indexOf('keypoints-table')).toBeLessThan(ids.indexOf('spotlight'));
  });

  it('returns null for empty/missing worksheet → caller falls back to DEFAULT', () => {
    expect(stepSequenceFromManifest(null)).toBeNull();
    expect(stepSequenceFromManifest(undefined)).toBeNull();
    expect(stepSequenceFromManifest([])).toBeNull();
  });

  it('skips unknown section types and never double-adds intro', () => {
    expect(
      stepSequenceFromManifest([
        { no: '一', name: 'X', module: 'bogus_type' },
        { no: '二', name: '閱讀理解', module: 'comprehension' },
      ]),
    ).toEqual(['lesson-intro', 'comprehension']);
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
  { no: '二', name: '念順順', module: 'reading_timer' }, //     → full-reading (重點朗讀, 2026-07-20)
  { no: '三', name: '語詞我最棒', module: 'vocab_definitions' }, // → vocab-definition
  { no: '四', name: '語詞應用', module: 'vocab_application' }, //  → vocab-application (dash only)
  { no: '五', name: '文章重點表', module: 'structure_table' }, //  → story-structure
  { no: '六', name: '知識補給站', module: 'knowledge_station' }, // → knowledge-station (dash only)
  { no: '七', name: '閱讀聚光燈', module: 'spotlight' }, //        → reading-strategy
  { no: '八', name: '閱讀理解', module: 'mcq' }, //               → comprehension
  { no: '九', name: '詞語複習', module: 'word_search' }, //        → vocab-word-search
];

describe('stepSequenceFromManifest — REAL parser vocabulary alias map (#2526)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Each of the 5 aliased types + the 2 that already worked via the dash
  // transform MUST resolve to a real STEP_REGISTRY id (no silent drop).
  it.each([
    ['vocab_definitions', 'vocab-definition'], //  ALIAS (plural → singular)
    ['structure_table', 'keypoints-table'], //     ALIAS
    ['spotlight', 'spotlight'], //          ALIAS
    ['mcq', 'comprehension'], //                   ALIAS
    ['word_search', 'vocab-review'], //       ALIAS
    ['vocab_application', 'vocab-application'], //  already worked (dash transform)
    ['knowledge_station', 'knowledge-station'], //  already worked (dash transform)
  ])('parser type "%s" resolves to registry id "%s"', (type, expectedId) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(STEP_REGISTRY[expectedId]).toBeDefined();
    const seq = stepSequenceFromManifest([{ no: '一', name: 'x', module: type }]);
    expect(seq).toContain(expectedId);
  });

  it('resolves a full real worksheet in order (reading_timer → full-reading, all 8 kept)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(stepSequenceFromManifest(G8_L16_WORKSHEET)).toEqual([
      'lesson-intro',
      'key-passage-reading', //  念順順 → 重點朗讀 (full-reading 改造, 2026-07-20 教授審查定調)
      'vocab-definition',
      'vocab-application',
      'keypoints-table',
      'knowledge-station',
      'spotlight',
      'comprehension',
      'vocab-review',
    ]);
  });

  it('warns (not silently drops) when a section type has no registry match', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stepSequenceFromManifest([{ no: '一', name: 'X', module: 'bogus_type' }]);
    expect(warnSpy).toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some((args) => args.some((a) => String(a).includes('bogus_type'))),
    ).toBe(true);
  });

  it('maps reading_timer → full-reading (重點朗讀); no known unmapped types remain', () => {
    // 2026-07-20 教授審查會議解決了唯一歧義：念順順 (reading_timer) = 1 分鐘計時流暢朗讀。
    // 做法＝把 full-reading step 改造成「重點朗讀」(保留 id 避免完成-識別 bug)，reading_timer 對應過去。
    expect([...KNOWN_UNMAPPED_WORKSHEET_TYPES]).toEqual([]);
    expect(STEP_REGISTRY['key-passage-reading']).toBeDefined();
    expect(STEP_REGISTRY['key-passage-reading'].label).toBe('重點朗讀');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seq = stepSequenceFromManifest([
      { no: '二', name: '念順順', module: 'reading_timer' },
      { no: '八', name: '閱讀理解', module: 'mcq' },
    ]);
    expect(seq).toContain('key-passage-reading'); //     念順順 now resolves (重點朗讀)
    expect(seq).not.toContain('paragraph-reading'); //        逐段 hidden from nav
    expect(seq).toContain('comprehension'); //    mcq still resolves alongside
    expect(
      warnSpy.mock.calls.some((args) => args.some((a) => String(a).includes('reading_timer'))),
    ).toBe(false); //                             no longer warns — it's mapped
  });
});
