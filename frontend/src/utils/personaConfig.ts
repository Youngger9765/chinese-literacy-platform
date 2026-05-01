/**
 * Frontend persona thresholds — mirrors backend/app/services/persona.py
 * Issue #54: Unified "warm but firm" AI tutor persona across all steps.
 */

// LiveTutor per-line reading thresholds (frontend fallback defaults).
// Primary thresholds should come from backend /api/reading/evaluate response.
export const READING_EXCELLENT = 0.80; // ≥80%: 很棒
export const READING_PASS = 0.60; // ≥60%: 很好，過關
// <60%: 重唸

// FullReading fluency thresholds — FALLBACK DEFAULTS only.
// Bug B fix (#1378): These constants are now used ONLY when lesson YAML
// reading_benchmark is absent. The primary threshold should come from the
// lesson's reading_benchmark.levels (grade-aware) via getThresholdsFromBenchmark().
//
// Historical note: FULLREADING_CPM_PASS = 120 was previously the hardcoded
// pass threshold for ALL lessons, overriding per-lesson YAML values (e.g.
// G7 should be 251). This is now the ultimate global fallback only.
//
// Grade-based defaults (from lesson YAML research, Issue #1378):
//   G4: 190 | G5: 200 | G6: 210 | G7-G9: 220
// The floor of 120 is from 臺師大 Brain & Learning Lab (G2+ minimum).
export const FULLREADING_CPM_PASS = 120; // global fallback — prefer lesson YAML
export const FULLREADING_ACCURACY_PASS = 0.80;

// Grade-based CPM pass defaults (fallback when no lesson YAML present)
export const GRADE_CPM_DEFAULTS: Record<number, number> = {
  4: 190,
  5: 200,
  6: 210,
  7: 220,
  8: 220,
  9: 220,
};

// AssessmentReport CPM tiers
export const CPM_VERY_FAST = 180;
export const CPM_FAST = 130;
export const CPM_MEDIUM = 90;
export const CPM_SLOW = 50;

/**
 * Derive the CPM pass threshold from lesson reading_benchmark levels.
 *
 * Priority: lesson reading_benchmark → grade default → global fallback (120).
 *
 * For CPM benchmarks, use the lowest minCpm of the "mid" level (the second
 * level when sorted by minCpm) as the pass threshold.  This maps to
 * "191~220字" → pass at ≥191 for G4 lessons.
 *
 * Returns null for seconds-based benchmarks (G8 文言文) — caller should
 * skip CPM pass/fail and use getSecBenchmarkFeedback() instead.
 */
import type { ParsedBenchmark } from './fluencyAnalyzer';

export function getThresholdsFromBenchmark(
  benchmarkLevels: ParsedBenchmark[] | null | undefined,
  grade?: number
): { cpmPass: number; accuracyPass: number } | null {
  if (!benchmarkLevels || benchmarkLevels.length === 0) {
    // No lesson benchmark: use grade default or global fallback
    const cpmPass = (grade !== undefined ? GRADE_CPM_DEFAULTS[grade] : undefined) ?? FULLREADING_CPM_PASS;
    return { cpmPass, accuracyPass: FULLREADING_ACCURACY_PASS };
  }

  // Seconds-based benchmark: cannot compute CPM pass threshold
  if ('unit' in benchmarkLevels[0]) {
    return null;
  }

  // CPM benchmark: find the "mid" level — sort CPM levels by minCpm
  // The second level (index 1 after sort) is the "good" range.
  // Its minCpm becomes the pass threshold.
  const cpmLevels = benchmarkLevels
    .filter((l): l is import('./fluencyAnalyzer').BenchmarkLevel => !('unit' in l))
    .sort((a, b) => a.minCpm - b.minCpm);

  if (cpmLevels.length === 0) {
    const cpmPass = (grade !== undefined ? GRADE_CPM_DEFAULTS[grade] : undefined) ?? FULLREADING_CPM_PASS;
    return { cpmPass, accuracyPass: FULLREADING_ACCURACY_PASS };
  }

  // The mid-level threshold: second level if 3+ levels, else second or only level
  const midLevel = cpmLevels.length >= 2 ? cpmLevels[1] : cpmLevels[0];
  return {
    cpmPass: midLevel.minCpm,
    accuracyPass: FULLREADING_ACCURACY_PASS,
  };
}
