/**
 * Calculate star rating (1–3) based on reading and comprehension performance.
 *
 * Scoring rules:
 *   1 star  — completed at least one learning step (participation)
 *   2 stars — reading accuracy >= 70% AND comprehension adequate (>= 50%)
 *   3 stars — reading accuracy >= 90% AND comprehension excellent (>= 80%)
 *
 * If comprehension data is unavailable, reading accuracy alone determines the grade.
 */
export function calcStarRating(params: {
  /** Reading accuracy 0–100 (from readingAttempt or fullReadingResult) */
  readingAccuracy: number | null;
  /** Comprehension score 0–100 (from comprehensionScores.comprehension_score) */
  comprehensionScore: number | null;
}): 1 | 2 | 3 {
  const { readingAccuracy, comprehensionScore } = params;

  // No reading data at all → 1 star (participation)
  if (readingAccuracy === null) return 1;

  const hasComprehension = comprehensionScore !== null;

  // 3 stars: reading >= 90% AND (no comprehension data OR comprehension >= 80%)
  if (
    readingAccuracy >= 90 &&
    (!hasComprehension || (comprehensionScore as number) >= 80)
  ) {
    return 3;
  }

  // 2 stars: reading >= 70% AND (no comprehension data OR comprehension >= 50%)
  if (
    readingAccuracy >= 70 &&
    (!hasComprehension || (comprehensionScore as number) >= 50)
  ) {
    return 2;
  }

  // 1 star: participated
  return 1;
}
