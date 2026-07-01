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

  it('exercises all 7 registered question types across the corpus', () => {
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
