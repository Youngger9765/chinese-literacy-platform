/**
 * Locks the step ids to their Chinese labels.
 *
 * Five names existed for one thing and no two agreed: 念順順 on the paper
 * worksheet, `reading_timer` in the data, `full-reading` in the URL, 重點朗讀 on
 * screen, `ParagraphReading` in code. That cost real time twice in one day — a feature
 * was wired to `tutor`, disabled since 2026-07-20, and the 「全文」 QR codes point
 * at the intro page because no whole-text reading step exists at all.
 *
 * Two ids were outright inverted: `full-reading` read a single key passage,
 * while `reading-annotation` was the one that actually read the whole text.
 */
import { describe, it, expect } from 'vitest';
import { STEP_REGISTRY, WORKSHEET_TYPE_ALIASES, LEGACY_STEP_ID_ALIASES, resolveStepId } from './stepConfig';

/** id → label. The id must say what the label says. */
const EXPECTED_NAMING: Record<string, string> = {
  'lesson-intro': '課程簡介',
  'full-text-annotate': '讀全文-做記號',
  'paragraph-reading': '逐段朗讀',
  'key-passage-reading': '重點朗讀',
  listening: '聽力理解',
  'character-practice': '生字練習',
  'vocab-definition': '詞語理解',
  'vocab-application': '語詞應用',
  'keypoints-table': '文章重點表',
  spotlight: '閱讀聚光燈',
  'sentence-practice': '造句練習',
  comprehension: '閱讀理解',
  'vocab-review': '語詞複習',
  dictation: '聽寫練習',
  'knowledge-station': '知識補給站',
  report: '報告',
  // 文言文專屬 (#2752) — only ever reached via a lesson's own step_sequence,
  // never DEFAULT_STEP_SEQUENCE (see stepConfig.ts's comment on these entries).
  'classical-text': '原文',
  'classical-sentence-matching': '文白句子比對',
  'classical-word-matching': '文白詞語比對',
  'classical-self-challenge': '自我挑戰',
};

/**
 * Student progress is stored as an integer (`current_step: Mapped[int]` in
 * backend/app/models/session.py), never as the id string. Freezing these numbers
 * is what makes the rename a no-migration change — if one moves, existing
 * progress rows start pointing at a different step.
 */
const FROZEN_DB_STEP_NUMBERS: Record<string, number> = {
  'lesson-intro': 1,
  'paragraph-reading': 2,
  comprehension: 3,
  'character-practice': 4,
  dictation: 5,
  'key-passage-reading': 6,
  report: 7,
  'full-text-annotate': 8,
  'vocab-application': 9,
  'vocab-review': 10,
  'knowledge-station': 11,
  'vocab-definition': 12,
  listening: 13,
  'sentence-practice': 14,
  'keypoints-table': 15,
  spotlight: 16,
};

describe('step id 必須說出它的中文意思', () => {
  it('every registered step has the expected id→label pairing', () => {
    const actual = Object.fromEntries(
      Object.entries(STEP_REGISTRY).map(([id, cfg]) => [id, cfg.label]),
    );
    expect(actual).toEqual(EXPECTED_NAMING);
  });

  it('no id survives that contradicts its label', () => {
    // The two that were inverted. Named explicitly so a partial rename cannot
    // pass by leaving the worst offenders behind.
    expect(STEP_REGISTRY).not.toHaveProperty('full-reading');
    expect(STEP_REGISTRY).not.toHaveProperty('tutor');
  });
});

describe('dbStepNumber 凍結 — 這是免 migration 的保證', () => {
  it.each(Object.entries(FROZEN_DB_STEP_NUMBERS))(
    '%s keeps dbStepNumber %i',
    (id, num) => {
      expect(STEP_REGISTRY[id]?.dbStepNumber).toBe(num);
    },
  );
});

describe('舊 id 仍然解析得到 — 已發出的連結與 QR 不能 404', () => {
  it.each([
    ['full-reading', 'key-passage-reading'],
    ['tutor', 'paragraph-reading'],
    ['intro', 'lesson-intro'],
    ['reading-annotation', 'full-text-annotate'],
    ['reading-strategy', 'spotlight'],
    ['story-structure', 'keypoints-table'],
    ['vocab', 'character-practice'],
    ['vocab-word-search', 'vocab-review'],
  ])('%s → %s', (oldId, newId) => {
    expect(LEGACY_STEP_ID_ALIASES[oldId]).toBe(newId);
    expect(resolveStepId(oldId)).toBe(newId);
  });

  it('a current id resolves to itself', () => {
    expect(resolveStepId('key-passage-reading')).toBe('key-passage-reading');
  });
});

describe('念順順 仍然接得回平台', () => {
  it('reading_timer maps to the key-passage step', () => {
    // The one thing the 2026-07-20 expert review settled: 朗讀 practises the
    // teacher-marked passage, not the whole text. Break this and the paper
    // worksheet stops connecting to the platform.
    expect(WORKSHEET_TYPE_ALIASES.reading_timer).toBe('key-passage-reading');
  });
});

describe('文言文專屬 steps (#2752) 沒有動到既有 16 個 step 的 dbStepNumber', () => {
  // Self-contained frozen snapshot — deliberately NOT reusing
  // FROZEN_DB_STEP_NUMBERS above, so this test stands on its own as the
  // negative control for #2752's registry additions: it only fails if THIS
  // change (adding 4 new STEP_REGISTRY entries) altered one of the 16
  // pre-existing numbers, independent of whatever else might edit the table
  // above later.
  const PRE_2752_DB_STEP_NUMBERS: Record<string, number> = {
    'lesson-intro': 1,
    'paragraph-reading': 2,
    comprehension: 3,
    'character-practice': 4,
    dictation: 5,
    'key-passage-reading': 6,
    report: 7,
    'full-text-annotate': 8,
    'vocab-application': 9,
    'vocab-review': 10,
    'knowledge-station': 11,
    'vocab-definition': 12,
    listening: 13,
    'sentence-practice': 14,
    'keypoints-table': 15,
    spotlight: 16,
  };

  it.each(Object.entries(PRE_2752_DB_STEP_NUMBERS))(
    '%s still keeps dbStepNumber %i after the 4 new classical steps were added',
    (id, num) => {
      expect(STEP_REGISTRY[id]?.dbStepNumber).toBe(num);
    },
  );

  it('the 4 new classical steps use dbStepNumbers 17-20 — no collision with any of the 16 above', () => {
    const newIds = [
      'classical-text',
      'classical-sentence-matching',
      'classical-word-matching',
      'classical-self-challenge',
    ];
    const newNumbers = newIds.map((id) => STEP_REGISTRY[id]?.dbStepNumber);
    expect(newNumbers).toEqual([17, 18, 19, 20]);
  });

  it('every dbStepNumber across the whole registry is unique (old 16 + new 4)', () => {
    const allNumbers = Object.values(STEP_REGISTRY).map((s) => s.dbStepNumber);
    expect(new Set(allNumbers).size).toBe(allNumbers.length);
  });
});
