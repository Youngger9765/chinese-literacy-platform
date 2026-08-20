/**
 * questionReview.ts — Shared "first-try correctness → wrong-answer review" logic.
 *
 * Issue #2773: Young asked for the vocab-application "重做錯題 / 錯題解析" mechanism
 * (FillInBlankExercise.tsx `QuestionResult`) on 詞語理解 and 閱讀理解 too. 詞語理解
 * (VocabDefinitionMatch) already has an equivalent, independently-built mechanism
 * (`AnswerRecord` + `selectRetryIndices` in vocabDefinitionMatchLogic.ts) — this file
 * is NOT a refactor of either existing implementation (both are live and working;
 * touching them is out of scope and out of proportion to the ask).
 *
 * This is the generic version for the still-missing 閱讀理解 (comprehension) path,
 * built so it doesn't depend on any particular exercise-data shape (works for a
 * legacy `MultipleChoiceItem` index, a `LessonRenderer` exercise-block id, or
 * anything else that has a stable identifier). NO React imports, NO side effects.
 *
 * Design mirrors the two existing implementations on purpose:
 *   - a first-try result is recorded exactly once per question id (retries never
 *     overwrite it) — this is what makes "重做錯題" mean "only the ones you missed
 *     the FIRST time", not "currently wrong"
 *   - the correct answer is only ever read out of these records by UI that shows
 *     them post-submission (the review list) — this module holds no rendering logic
 *     and never decides visibility; see the 🔴 red line in issue #2773's body about
 *     not leaking answers pre-submission
 */

export interface FirstTryRecord<TId = string | number, TAnswer = string> {
  /** Stable identifier for the question within its exercise set (index, block id, ...). */
  id: TId;
  firstTryCorrect: boolean;
  /** The student's first pick. null when firstTryCorrect (never shown, but kept for symmetry). */
  studentFirstAnswer: TAnswer | null;
  correctAnswer: TAnswer;
}

/**
 * Append a first-try record, but only the FIRST time a given id is seen.
 * Subsequent calls for the same id (e.g. a retry-wrong replay re-answering the
 * same question) are no-ops — the original first-try verdict is what "重做錯題"
 * is computed from, so it must never be overwritten.
 */
export function recordFirstTry<TId, TAnswer>(
  prev: FirstTryRecord<TId, TAnswer>[],
  next: FirstTryRecord<TId, TAnswer>,
): FirstTryRecord<TId, TAnswer>[] {
  if (prev.some((r) => r.id === next.id)) return prev;
  return [...prev, next];
}

/** IDs answered wrong on the first try, in the order they were recorded. */
export function wrongFirstTryIds<TId, TAnswer>(
  records: FirstTryRecord<TId, TAnswer>[],
): TId[] {
  return records.filter((r) => !r.firstTryCorrect).map((r) => r.id);
}

/** First-try score — mirrors FillInBlankExercise's `firstTryScore`/`firstTryTotal` split. */
export function firstTryScore<TId, TAnswer>(
  records: FirstTryRecord<TId, TAnswer>[],
): { correct: number; total: number } {
  return {
    correct: records.filter((r) => r.firstTryCorrect).length,
    total: records.length,
  };
}

/** True once every question in `questionIds` has a first-try record. */
export function isFirstTryComplete<TId, TAnswer>(
  records: FirstTryRecord<TId, TAnswer>[],
  questionIds: TId[],
): boolean {
  const seen = new Set(records.map((r) => r.id));
  return questionIds.length > 0 && questionIds.every((id) => seen.has(id));
}
