/**
 * lessonContent.contract.test.ts — front/back contract parity gate.
 *
 * Part of the 閱讀聚光燈 refactor (SPOTLIGHT_REFACTOR_PLAN.md), Phase 0 + Phase 1.
 *
 * Loads the SHARED fixtures in backend/tests/fixtures/lesson_content/ (the same files
 * the pydantic tests use) and validates them through the zod contract. If the zod and
 * pydantic schemas drift, a fixture the backend accepts will fail here — that's the
 * whole point: one contract, two languages, one set of fixtures.
 *
 * Fixtures are authored in snake_case (matching pydantic + the repo YAML convention);
 * this test snake→camel-cases keys before parsing (the frontend contract is camelCase).
 * The KEY SET is intentionally identical between the two, only the casing differs.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  ExerciseBlock,
  LessonSchema,
  type Lesson,
} from '../lessonContent';

const HERE = dirname(fileURLToPath(import.meta.url));
// frontend/src/schema/__tests__ → repo root → backend/tests/fixtures/lesson_content
const FIXTURE_DIR = join(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'backend',
  'tests',
  'fixtures',
  'lesson_content',
);

const REGISTERED_KINDS = [
  'multiple_choice',
  'fill_in_blank',
  'ordering',
  'trait_inference',
  'guided_steps',
  'graphic_text_integration',
  'keypoints_table',
  'custom',
] as const;

function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Recursively camelCase object keys (arrays/scalars pass through). */
function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[toCamel(k)] = camelizeKeys(v);
    }
    return out;
  }
  return value;
}

function loadFixture(file: string): Lesson {
  const raw = parseYaml(readFileSync(join(FIXTURE_DIR, file), 'utf-8'));
  return LessonSchema.parse(camelizeKeys(raw));
}

const fixtureFiles = readdirSync(FIXTURE_DIR).filter((f) =>
  f.endsWith('.lesson.yml'),
);

describe('lesson content contract (zod ↔ pydantic parity)', () => {
  it('has the 4 layered hard-case fixtures', () => {
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of fixtureFiles) {
    it(`validates ${file} through the zod contract`, () => {
      const lesson = loadFixture(file);
      expect(lesson.blocks.length).toBeGreaterThan(0);
    });
  }

  it('exercises all 8 registered question types across the corpus', () => {
    const seen = new Set<string>();
    for (const file of fixtureFiles) {
      for (const b of loadFixture(file).blocks) {
        if (b.type === 'exercise') seen.add(b.question.kind);
      }
    }
    for (const k of REGISTERED_KINDS) expect(seen.has(k)).toBe(true);
  });
});

describe('the answer invariant rejects bad lessons (zod)', () => {
  const base = () => ({
    id: 'neg',
    lessonCode: 'NEG-1',
    blocks: [
      { id: 'p1', type: 'paragraph', text: 'some passage' },
      {
        id: 'ex1',
        type: 'exercise',
        question: { kind: 'multiple_choice', question: 'q?', options: ['a', 'b'] },
        answerSpace: 'choice',
        answer: 0,
        grader: 'exact',
        anchors: [{ blockId: 'p1' }],
      },
    ],
  });

  it('rejects a null answer without needsReview', () => {
    const d = base();
    (d.blocks[1] as Record<string, unknown>).answer = null;
    expect(LessonSchema.safeParse(d).success).toBe(false);
  });

  it('rejects custom without needsReview', () => {
    const d = base();
    const ex = d.blocks[1] as Record<string, unknown>;
    ex.question = { kind: 'custom', prompt: 'do the thing' };
    ex.answerSpace = 'text';
    ex.answer = '42';
    ex.grader = 'exact';
    expect(LessonSchema.safeParse(d).success).toBe(false);
  });

  it('rejects an incoherent answerSpace/grader pair', () => {
    const d = base();
    const ex = d.blocks[1] as Record<string, unknown>;
    ex.answerSpace = 'free_text';
    ex.grader = 'exact';
    expect(LessonSchema.safeParse(d).success).toBe(false);
  });

  it('rejects an anchor to a missing block', () => {
    const d = base();
    (d.blocks[1] as Record<string, unknown>).anchors = [{ blockId: 'nope' }];
    expect(LessonSchema.safeParse(d).success).toBe(false);
  });

  it('accepts custom when it carries an answer + needsReview', () => {
    const d = base();
    const ex = d.blocks[1] as Record<string, unknown>;
    ex.question = { kind: 'custom', prompt: 'do the thing' };
    ex.answerSpace = 'text';
    ex.answer = '42';
    ex.grader = 'exact';
    ex.needsReview = true;
    const parsed = LessonSchema.safeParse(d);
    expect(parsed.success).toBe(true);
  });

  it('ExerciseBlock parses a well-formed exercise directly', () => {
    const parsed = ExerciseBlock.safeParse((base().blocks[1]));
    expect(parsed.success).toBe(true);
  });
});

// ── Gap 1: multi_select guided step ──────────────────────────────────────────
describe('Gap 1 — multi_select guided step (zod)', () => {
  const guided = (steps: unknown[]) => ({
    id: 'g',
    lessonCode: 'G-1',
    blocks: [
      { id: 'p1', type: 'paragraph', text: 'passage' },
      {
        id: 'ex1',
        type: 'exercise',
        question: { kind: 'guided_steps', strategyName: 's', instruction: 'i', steps },
        answerSpace: 'free_text',
        answer: [0],
        grader: 'rubric_ai',
        anchors: [{ blockId: 'p1' }],
      },
    ],
  });

  it('accepts a multi_select step', () => {
    const d = guided([
      { prompt: 'p', type: 'multi_select', options: ['a', 'b', 'c'], answer: [0, 2] },
      { prompt: 'q', type: 'free_text' },
    ]);
    expect(LessonSchema.safeParse(d).success).toBe(true);
  });

  it('rejects multi_select step out-of-range', () => {
    const d = guided([
      { prompt: 'p', type: 'multi_select', options: ['a', 'b'], answer: [0, 9] },
    ]);
    expect(LessonSchema.safeParse(d).success).toBe(false);
  });

  it('rejects a select step with a list answer', () => {
    const d = guided([
      { prompt: 'p', type: 'select', options: ['a', 'b'], answer: [0, 1] },
    ]);
    expect(LessonSchema.safeParse(d).success).toBe(false);
  });

  it('rejects a free_text step with an answer', () => {
    const d = guided([{ prompt: 'p', type: 'free_text', answer: 0 }]);
    expect(LessonSchema.safeParse(d).success).toBe(false);
  });

  it('rejects a select step with a negative index (parity with pydantic)', () => {
    // 0-based option index has no negative slot. The pydantic mirror rejects this in
    // GuidedStep._check_shape; zod rejects it via the field-level `.min(0)`. Both must
    // agree so a -1 sentinel / off-by-one lesson is not accepted by one and not the other.
    const d = guided([
      { prompt: 'p', type: 'select', options: ['a', 'b'], answer: -1 },
    ]);
    expect(LessonSchema.safeParse(d).success).toBe(false);
  });

  it('rejects a graphic_text_integration select step with a negative index', () => {
    const d = {
      id: 'g',
      lessonCode: 'G-1',
      blocks: [
        { id: 'p1', type: 'paragraph', text: 'passage' },
        {
          id: 'ex1',
          type: 'exercise',
          question: {
            kind: 'graphic_text_integration',
            strategyName: 's',
            instruction: 'i',
            steps: [{ prompt: 'p', type: 'select', options: ['a', 'b'], answer: -1 }],
          },
          answerSpace: 'free_text',
          answer: [-1],
          grader: 'rubric_ai',
          needsReview: true,
          anchors: [{ blockId: 'p1' }],
        },
      ],
    };
    expect(LessonSchema.safeParse(d).success).toBe(false);
  });
});

// ── Gap 2: merged-cell grid + keypoints_table ────────────────────────────────
describe('Gap 2 — table grid overlay + keypoints_table (zod)', () => {
  const withTable = (grid: unknown) => ({
    id: 't',
    lessonCode: 'T-1',
    blocks: [
      { id: 'tbl', type: 'table', headers: ['a', 'b', 'c'], grid },
      { id: 'p1', type: 'paragraph', text: 'x' },
    ],
  });

  it('accepts a table grid overlay', () => {
    const d = withTable([
      [{ text: 'section', colspan: 3, isSectionLabel: true }],
      [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
    ]);
    expect(LessonSchema.safeParse(d).success).toBe(true);
  });

  it('rejects a grid width mismatch (via superRefine)', () => {
    const d = withTable([[{ text: 'x', colspan: 2 }]]); // sum 2 != headers 3
    expect(LessonSchema.safeParse(d).success).toBe(false);
  });

  const withKeypoints = (rows: unknown[], blanks: unknown[], answer: unknown) => ({
    id: 'k',
    lessonCode: 'K-1',
    blocks: [
      { id: 'p1', type: 'paragraph', text: 'x' },
      {
        id: 'ex1',
        type: 'exercise',
        question: { kind: 'keypoints_table', structure: 'nested', rows, blanks },
        answerSpace: 'text',
        answer,
        grader: 'exact',
        anchors: [{ blockId: 'p1' }],
      },
    ],
  });

  it('accepts keypoints_table with a dict answer', () => {
    const d = withKeypoints(
      [{ label: 'L', subLabel: 'S', blankIds: ['b1', 'b2'] }],
      [{ id: 'b1', answer: 'x' }, { id: 'b2', answer: 'y' }],
      { b1: 'x', b2: 'y' },
    );
    expect(LessonSchema.safeParse(d).success).toBe(true);
  });

  it('rejects keypoints_table unknown blank id (via superRefine)', () => {
    const d = withKeypoints(
      [{ label: 'L', blankIds: ['nope'] }],
      [{ id: 'b1', answer: 'x' }],
      { b1: 'x' },
    );
    expect(LessonSchema.safeParse(d).success).toBe(false);
  });

  it('rejects keypoints_table duplicate blank id (via superRefine)', () => {
    const d = withKeypoints(
      [{ label: 'L' }],
      [{ id: 'b1', answer: 'x' }, { id: 'b1', answer: 'y' }],
      { b1: 'x' },
    );
    expect(LessonSchema.safeParse(d).success).toBe(false);
  });
});

// ── Gap 3: fill_in_blank slots ────────────────────────────────────────────────
describe('Gap 3 — fill_in_blank slots (zod)', () => {
  const withFib = (question: unknown, answer: unknown) => ({
    id: 'f',
    lessonCode: 'F-1',
    blocks: [
      { id: 'p1', type: 'paragraph', text: 'x' },
      {
        id: 'ex1',
        type: 'exercise',
        question,
        answerSpace: 'text',
        answer,
        grader: 'exact',
        anchors: [{ blockId: 'p1' }],
      },
    ],
  });

  it('accepts fill_in_blank with slots', () => {
    const d = withFib(
      {
        kind: 'fill_in_blank',
        sentence: 'a__b__',
        slots: [
          { id: 'b1', answer: 'x', grader: 'exact' },
          { id: 'b2', answer: ['a', 'b'], grader: 'set' },
        ],
      },
      { b1: 'x', b2: ['a', 'b'] },
    );
    expect(LessonSchema.safeParse(d).success).toBe(true);
  });

  it('rejects duplicate slot id (via superRefine)', () => {
    const d = withFib(
      {
        kind: 'fill_in_blank',
        sentence: 'a__b__',
        slots: [{ id: 'b1', answer: 'x' }, { id: 'b1', answer: 'y' }],
      },
      { b1: 'x' },
    );
    expect(LessonSchema.safeParse(d).success).toBe(false);
  });

  it('rejects a set slot with a scalar answer (via superRefine)', () => {
    const d = withFib(
      {
        kind: 'fill_in_blank',
        sentence: 'a__',
        slots: [{ id: 'b1', answer: 'x', grader: 'set' }],
      },
      { b1: 'x' },
    );
    expect(LessonSchema.safeParse(d).success).toBe(false);
  });
});

// ── Gap 5: parallel_passage block ─────────────────────────────────────────────
describe('Gap 5 — parallel_passage block (zod)', () => {
  const withParallel = (rows: unknown[], anchorPp = false) => {
    const blocks: unknown[] = [
      { id: 'pp', type: 'parallel_passage', rows },
      { id: 'p1', type: 'paragraph', text: 'x' },
    ];
    if (anchorPp) {
      blocks.push({
        id: 'ex1',
        type: 'exercise',
        question: { kind: 'fill_in_blank', sentence: 'count? __' },
        answerSpace: 'text',
        answer: '148',
        grader: 'exact',
        anchors: [{ blockId: 'pp' }],
      });
    }
    return { id: 'pp', lessonCode: 'PP-1', blocks };
  };

  it('accepts a parallel_passage block', () => {
    const d = withParallel([{ left: 'l', right: 'r' }]);
    expect(LessonSchema.safeParse(d).success).toBe(true);
  });

  it('rejects a parallel_passage with empty rows', () => {
    const d = withParallel([]);
    expect(LessonSchema.safeParse(d).success).toBe(false);
  });

  it('accepts an exercise anchoring a parallel_passage', () => {
    const d = withParallel([{ left: 'l', right: 'r' }], true);
    expect(LessonSchema.safeParse(d).success).toBe(true);
  });
});
