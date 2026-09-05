/**
 * lessonGrading.ts — the SINGLE grading authority for the block-based lesson renderer.
 *
 * Part of the 閱讀聚光燈 refactor Phase 2 (unified block renderer). This is the ONLY
 * place that decides whether a student answer is correct. Input widgets
 * (`inputs/*.tsx`) produce a raw student value; `ExerciseBlockView` feeds that value
 * plus the exercise here — no widget grades itself, so a "pretty but ungradable"
 * widget cannot exist (the widget-picker is exhaustive over the 8 kinds and every
 * branch returns a value in the same runtime shape as `exercise.answer`).
 *
 * Dispatch is on `exercise.grader` (the schema guarantees the grader↔answerSpace
 * pairing, so `grader` is a safe discriminant). The CJK normalization helpers are
 * REUSED from the legacy spotlight logic (`resolveFreeTextCorrect`/`resolveSingleCorrect`)
 * so free-text leniency stays byte-identical to today's behavior.
 *
 * Pure module — no React, unit-testable. See `__tests__/lessonGrading.test.ts`.
 */
import type { ExerciseBlockT } from '../../schema/lessonContent';
import {
  resolveFreeTextCorrect,
  resolveSingleCorrect,
} from '../reading-spotlight/spotlightBlockLogic';

/** Result of grading one exercise. `verdict === null` = not machine-gradable (manual). */
export interface GradeResult {
  verdict: boolean | null;
  needsReview: boolean;
}

const CORRECT: GradeResult = { verdict: true, needsReview: false };
const WRONG: GradeResult = { verdict: false, needsReview: false };
const MANUAL: GradeResult = { verdict: null, needsReview: true };

// ── letter/index helpers (Gap 3 — multiple_choice answer polymorphism) ─────────

const LETTER_A = 'A'.charCodeAt(0);

/** 'A' → 0, 'B' → 1, … ; returns null if not a single A-Z letter. */
export function letterToIndex(letter: string): number | null {
  if (typeof letter !== 'string' || letter.length !== 1) return null;
  const idx = letter.toUpperCase().charCodeAt(0) - LETTER_A;
  return idx >= 0 && idx < 26 ? idx : null;
}

/**
 * Normalize an `answer` that may be a numeric index OR a letter ('A') into a numeric
 * index. wen-L2 `ex-vocab-si` carries `answer: "A"` (letter) while every other choice
 * fixture uses an int index; grading is ALWAYS index-based, so callers funnel through
 * here. The adapter normalizes at load time; this belt-and-braces keeps the grading
 * authority correct even when a raw fixture answer flows straight in (fixture-driven test).
 */
export function normalizeChoiceAnswer(answer: unknown): number | null {
  if (typeof answer === 'number' && Number.isInteger(answer)) return answer;
  if (typeof answer === 'string') return letterToIndex(answer.trim());
  return null;
}

// ── set / order helpers ────────────────────────────────────────────────────────

function toNumberArray(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const out: number[] = [];
  for (const x of v) {
    if (typeof x === 'number' && Number.isInteger(x)) out.push(x);
    else return null;
  }
  return out;
}

/** Order-insensitive equality of two index sets (distinct ints). */
export function setEqualIndices(a: unknown, b: unknown): boolean {
  const aa = toNumberArray(a);
  const bb = toNumberArray(b);
  if (!aa || !bb) return false;
  const sa = new Set(aa);
  const sb = new Set(bb);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/** Order-insensitive equality of two string sets (space-normalized). */
export function setEqualStrings(a: unknown, b: unknown): boolean {
  const norm = (s: unknown) => String(s).replace(/\s+/g, '').trim();
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const sa = new Set(a.map(norm));
  const sb = new Set(b.map(norm));
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/** Deep, order-SENSITIVE equality of two index permutations. */
export function orderedEqual(a: unknown, b: unknown): boolean {
  const aa = toNumberArray(a);
  const bb = toNumberArray(b);
  if (!aa || !bb || aa.length !== bb.length) return false;
  return aa.every((x, i) => x === bb[i]);
}

// ── exact grader (choice / text / keypoints_table dict / fill slots dict) ───────

function gradeExact(exercise: ExerciseBlockT, studentValue: unknown): GradeResult {
  const q = exercise.question;

  // choice-space: index (or letter) equality.
  if (exercise.answerSpace === 'choice') {
    const expected = normalizeChoiceAnswer(exercise.answer);
    const got = normalizeChoiceAnswer(studentValue);
    if (expected == null) return MANUAL;
    // 一題多正解：選集合裡的任何一個都對（不是要學生全選中 —— 那是 multi_choice）。
    const accepted = exercise.acceptedAnswers;
    if (accepted != null && accepted.length > 0) {
      return got != null && accepted.includes(got) ? CORRECT : WRONG;
    }
    return got === expected ? CORRECT : WRONG;
  }

  // keypoints_table: dict{blankId: value}, per-blank normalized equality; □-choice
  // blanks (options present) grade by pick-equality against the offered options.
  if (q.kind === 'keypoints_table') {
    const answerDict = exercise.answer as Record<string, unknown> | null;
    if (answerDict == null || typeof answerDict !== 'object') return MANUAL;
    const studentDict = (studentValue ?? {}) as Record<string, unknown>;
    const blankById = new Map(q.blanks.map((bl) => [bl.id, bl]));
    let allCorrect = true;
    for (const [blankId, correctRaw] of Object.entries(answerDict)) {
      const blank = blankById.get(blankId);
      const student = studentDict[blankId];
      if (blank?.options != null) {
        // □-choice: exact (space-normalized) pick equality against the correct option.
        const ok =
          String(student ?? '').replace(/\s+/g, '').trim() ===
          String(correctRaw).replace(/\s+/g, '').trim();
        if (!ok) allCorrect = false;
      } else {
        // free fill: EXACT (space-normalized) equality — grader is 'exact', so "光合" must NOT
        // pass for "光合作用" (the lenient substring helper allowed it). Matches □-choice above.
        const ok =
          String(student ?? '').replace(/\s+/g, '').trim() ===
          String(correctRaw).replace(/\s+/g, '').trim();
        if (!ok) allCorrect = false;
      }
    }
    return allCorrect ? CORRECT : WRONG;
  }

  // fill_in_blank with per-slot dict answer + per-slot grader (mixed exact/set).
  if (q.kind === 'fill_in_blank' && q.slots != null && q.slots.length > 0) {
    const studentDict = (studentValue ?? {}) as Record<string, unknown>;
    let allCorrect = true;
    for (const slot of q.slots) {
      const student = studentDict[slot.id];
      if (slot.grader === 'set') {
        if (!setEqualStrings(student, slot.answer)) allCorrect = false;
      } else {
        const ok = resolveFreeTextCorrect(String(student ?? ''), String(slot.answer));
        if (!ok || String(student ?? '').trim() === '') allCorrect = false;
      }
    }
    return allCorrect ? CORRECT : WRONG;
  }

  // text-space scalar: lenient CJK equality.
  const expectedText = exercise.answer;
  if (expectedText == null) return MANUAL;
  const studentText = String(studentValue ?? '');
  if (studentText.trim() === '') return WRONG;
  return resolveFreeTextCorrect(studentText, String(expectedText)) ? CORRECT : WRONG;
}

// ── set grader (multi_choice index set / fill_in_blank whole-set list) ──────────

function gradeSet(exercise: ExerciseBlockT, studentValue: unknown): GradeResult {
  // multi_choice: index set equality.
  if (exercise.answerSpace === 'multi_choice') {
    return setEqualIndices(studentValue, exercise.answer) ? CORRECT : WRONG;
  }
  // fill_in_blank whole-set (any-order string list), e.g. G5 [自律, 謙虛].
  return setEqualStrings(studentValue, exercise.answer) ? CORRECT : WRONG;
}

// ── ordered grader (ordering permutation) ──────────────────────────────────────

function gradeOrdered(exercise: ExerciseBlockT, studentValue: unknown): GradeResult {
  return orderedEqual(studentValue, exercise.answer) ? CORRECT : WRONG;
}

/**
 * grade — the single grading authority. Given an exercise block and the raw student
 * value produced by its input widget, returns a verdict.
 *
 * `rubric_ai` is intentionally NOT graded here: it needs the async AI call (or the
 * local fallback) that lives in the widget/ExerciseBlockView, with fail-closed
 * behavior (#2279: don't let an AI outage block a student). Callers that hit a
 * rubric_ai exercise resolve it there and record the verdict directly.
 */
export function grade(exercise: ExerciseBlockT, studentValue: unknown): GradeResult {
  // custom / manual escape hatch — never auto-pass, always needs a human.
  if (exercise.grader === 'manual' || exercise.question.kind === 'custom') {
    return MANUAL;
  }
  switch (exercise.grader) {
    case 'exact':
      return gradeExact(exercise, studentValue);
    case 'set':
      return gradeSet(exercise, studentValue);
    case 'ordered':
      return gradeOrdered(exercise, studentValue);
    case 'rubric_ai':
      // Resolved out-of-band (async AI + fail-closed local fallback). Grading is
      // deferred to ExerciseBlockView; treat as manual here so an accidental sync
      // call never silently passes/fails.
      return MANUAL;
    default:
      return MANUAL;
  }
}

/**
 * Local (offline / fail-closed) grade for a rubric_ai free_text step. Mirrors the
 * legacy `resolveFreeTextCorrect` reference-answer comparison. Used by GuidedStepsInput
 * when there is no auth token (no AI call possible) — lenient by design.
 */
export function gradeRubricLocal(
  studentText: string,
  referenceAnswer: string | null | undefined,
): boolean {
  return resolveFreeTextCorrect(studentText, referenceAnswer);
}

export { resolveFreeTextCorrect, resolveSingleCorrect };
