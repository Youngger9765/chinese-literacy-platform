/**
 * lessonGrading.test.ts — truth table for the SINGLE grading authority `grade()`.
 *
 * Fixture-driven: exercises are parsed from the REAL shared fixtures
 * (backend/tests/fixtures/lesson_content/*.lesson.yml) through the SAME
 * camelizeKeys + LessonSchema.parse path as the contract parity gate, so grading stays
 * lock-step with the frozen contract (no self-authored shapes that could drift).
 *
 * This is the machine proof of "every exercise answer is machine-comparable": the final
 * coverage test walks all 4 fixtures and asserts every non-manual exercise `kind` gets a
 * real (non-null) verdict from `grade()` on its own correct answer.
 */
import { describe, expect, it } from 'vitest';

import type { ExerciseBlockT, Lesson } from '../../../schema/lessonContent';
import { loadFixture } from '../../../schema/testHelpers';
import { grade, letterToIndex, normalizeChoiceAnswer } from '../lessonGrading';

// ── fixture exercise lookup ──────────────────────────────────────────────────

const G5 = loadFixture('G5-L9.lesson.yml');
const G6 = loadFixture('G6-L22.lesson.yml');
const G7 = loadFixture('G7-L30.lesson.yml');
const WEN = loadFixture('wen-L2.lesson.yml');

function ex(lesson: Lesson, id: string): ExerciseBlockT {
  const block = lesson.blocks.find((b) => b.id === id);
  if (!block || block.type !== 'exercise') {
    throw new Error(`fixture exercise '${id}' not found in ${lesson.id}`);
  }
  return block;
}

// ── exact + choice (index) ────────────────────────────────────────────────────

describe('grade: exact + choice (index)', () => {
  it('G7 mcq answer:1 — correct on 1, wrong on 0', () => {
    const e = ex(G7, 'ex-mcq-1'); // answer: 1
    expect(grade(e, 1).verdict).toBe(true);
    expect(grade(e, 0).verdict).toBe(false);
  });

  it('G6 mcq answer:0 — correct on 0, wrong on 2', () => {
    const e = ex(G6, 'ex-mcq-3'); // answer: 0
    expect(grade(e, 0).verdict).toBe(true);
    expect(grade(e, 2).verdict).toBe(false);
  });
});

// ── polymorphic letter case (Gap G3, KEY) ─────────────────────────────────────

describe('grade: multiple_choice answer polymorphism (letter vs index)', () => {
  it('letterToIndex + normalizeChoiceAnswer map A/B → 0/1', () => {
    expect(letterToIndex('A')).toBe(0);
    expect(letterToIndex('B')).toBe(1);
    expect(letterToIndex('z')).toBe(25);
    expect(letterToIndex('好')).toBeNull();
    expect(normalizeChoiceAnswer('A')).toBe(0);
    expect(normalizeChoiceAnswer(2)).toBe(2);
  });

  it('wen-L2 ex-vocab-si answer:"A" — grades letter answer index-based (no silent mis-score)', () => {
    const e = ex(WEN, 'ex-vocab-si'); // fill_in_blank, answerSpace:choice, answer:"A"
    // "A" normalizes to index 0 → picking 0 is correct, picking 1 is wrong.
    expect(grade(e, 0).verdict).toBe(true);
    expect(grade(e, 1).verdict).toBe(false);
  });
});

// ── exact + keypoints_table (dict) ────────────────────────────────────────────

describe('grade: exact + keypoints_table (dict, free-fill + □-choice)', () => {
  const e = ex(G7, 'ex-keypoints');
  const correct = {
    'r1.b1': '黃色',
    'r1.b2': '象牙白色',
    'r2.b1': '末段白色',
    'r2.b2': '只有部分白色',
    'r3.b1': '外來種', // □-choice
    'r3.b2': '原生種', // □-choice
  };

  it('whole = all blanks correct → true', () => {
    expect(grade(e, correct).verdict).toBe(true);
  });

  it('one free-fill blank wrong → false', () => {
    expect(grade(e, { ...correct, 'r1.b1': '白色' }).verdict).toBe(false);
  });

  it('□-choice pick wrong → false', () => {
    expect(grade(e, { ...correct, 'r3.b1': '原生種' }).verdict).toBe(false);
  });

  it('free-fill lenient CJK: whitespace-insensitive equal', () => {
    expect(grade(e, { ...correct, 'r1.b1': ' 黃色 ' }).verdict).toBe(true);
  });

  it('missing a blank → false (empty is not a pass)', () => {
    const partial = { ...correct };
    delete (partial as Record<string, unknown>)['r2.b1'];
    expect(grade(e, partial).verdict).toBe(false);
  });
});

// ── exact + fill_in_blank slots (dict, mixed per-slot grader) ─────────────────

describe('grade: exact + fill_in_blank slots (per-slot exact/set)', () => {
  const e = ex(G5, 'ex-fill-slots'); // b1 exact 羽球訓練菜單 / b2 set [規律,自律]

  it('both slots correct (b2 any-order set) → true', () => {
    expect(grade(e, { b1: '羽球訓練菜單', b2: ['自律', '規律'] }).verdict).toBe(true);
  });

  it('b1 exact wrong → false', () => {
    expect(grade(e, { b1: '重量訓練', b2: ['規律', '自律'] }).verdict).toBe(false);
  });

  it('b2 set with an extra element → false', () => {
    expect(grade(e, { b1: '羽球訓練菜單', b2: ['規律', '自律', '謙虛'] }).verdict).toBe(false);
  });
});

// ── set (multi_choice + fill list) ────────────────────────────────────────────

describe('grade: set (order-insensitive, NOT ordered)', () => {
  it('G5 ex-multi answer:[0,2,3] — shuffled selection still correct', () => {
    const e = ex(G5, 'ex-multi');
    expect(grade(e, [0, 2, 3]).verdict).toBe(true);
    expect(grade(e, [3, 0, 2]).verdict).toBe(true); // shuffled → still true (set, not ordered)
    expect(grade(e, [0, 1, 2, 3]).verdict).toBe(false); // extra element
    expect(grade(e, [0, 2]).verdict).toBe(false); // missing element
  });

  it('G5 ex-fill list [自律,謙虛] — any order set-equal', () => {
    const e = ex(G5, 'ex-fill');
    expect(grade(e, ['自律', '謙虛']).verdict).toBe(true);
    expect(grade(e, ['謙虛', '自律']).verdict).toBe(true);
    expect(grade(e, ['自律']).verdict).toBe(false);
  });
});

// ── ordered ───────────────────────────────────────────────────────────────────

describe('grade: ordered (order-sensitive)', () => {
  const e = ex(G5, 'ex-order'); // answer [0,1,2,3]
  it('exact order → true', () => {
    expect(grade(e, [0, 1, 2, 3]).verdict).toBe(true);
  });
  it('shuffled order → false', () => {
    expect(grade(e, [0, 2, 1, 3]).verdict).toBe(false);
  });
});

// ── rubric_ai + manual defer to null (graded out-of-band / by human) ──────────

describe('grade: rubric_ai and manual are not synchronously auto-passed', () => {
  it('G6 guided_steps (rubric_ai) → verdict null (deferred to widget)', () => {
    const e = ex(G6, 'ex-spotlight');
    const r = grade(e, {});
    expect(r.verdict).toBeNull();
  });

  it('G7 graphic_text_integration (rubric_ai) → verdict null', () => {
    const e = ex(G7, 'ex-spotlight');
    expect(grade(e, {}).verdict).toBeNull();
  });

  it('wen custom (manual) → verdict null + needsReview, never auto-pass', () => {
    const e = ex(WEN, 'ex-custom-annotate');
    const r = grade(e, '任何字');
    expect(r.verdict).toBeNull();
    expect(r.needsReview).toBe(true);
  });
});

// ── trait_inference ───────────────────────────────────────────────────────────

describe('grade: trait_inference (index exact)', () => {
  it('G5 ex-trait answer:0 → true on 0, false on 1', () => {
    const e = ex(G5, 'ex-trait');
    expect(grade(e, 0).verdict).toBe(true);
    expect(grade(e, 1).verdict).toBe(false);
  });
});

// ── coverage: every non-manual exercise kind gets a real verdict ─────────────

describe('coverage: every fixture exercise is machine-gradable (no kind falls through)', () => {
  const all: Lesson[] = [G5, G6, G7, WEN];

  it('each non-rubric/non-manual exercise yields a boolean verdict on its own answer', () => {
    const kindsSeen = new Set<string>();
    for (const lesson of all) {
      for (const b of lesson.blocks) {
        if (b.type !== 'exercise') continue;
        kindsSeen.add(b.question.kind);

        // rubric_ai + manual are graded out-of-band → null is the CORRECT verdict here.
        if (b.grader === 'rubric_ai' || b.grader === 'manual') {
          expect(grade(b, {}).verdict).toBeNull();
          continue;
        }

        // Build the "correct" student value from the fixture answer for each shape.
        const studentValue = correctStudentValue(b);
        const r = grade(b, studentValue);
        expect(
          r.verdict,
          `exercise ${lesson.id}/${b.id} (${b.question.kind}) produced null verdict`,
        ).toBe(true);
      }
    }
    // Every registered machine-gradable kind was exercised somewhere in the corpus.
    for (const k of ['multiple_choice', 'ordering', 'trait_inference', 'fill_in_blank', 'keypoints_table']) {
      expect(kindsSeen.has(k)).toBe(true);
    }
  });
});

/** Reconstruct the correct student value for a gradable exercise from its fixture answer. */
function correctStudentValue(e: ExerciseBlockT): unknown {
  if (e.answerSpace === 'choice') return normalizeChoiceAnswer(e.answer);
  // keypoints_table dict / fill-slot dict / list / ordered array all match `answer` shape.
  return e.answer;
}
