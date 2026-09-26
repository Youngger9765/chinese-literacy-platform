/**
 * Frontend persona thresholds — mirrors backend/app/services/persona.py
 * Issue #54: Unified "warm but firm" AI tutor persona across all steps.
 */

// ParagraphReading per-line reading thresholds (frontend fallback defaults).
// Primary thresholds should come from backend /api/reading/evaluate response.
export const READING_EXCELLENT = 0.80; // ≥80%: 很棒
export const READING_PASS = 0.60; // ≥60%: 很好，過關
// <60%: 重唸

// KeyPassageReading fluency thresholds — FALLBACK DEFAULTS only.
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
// Issue #2131: CPM (speed) no longer contributes to pass/fail.
// analyzeFluency() now uses passed = accuracyPassed only.
//
// ⛔⛔ 2026-09-26（#3156 ④）—— 下面這兩個常數與 `getThresholdsFromBenchmark()`
//     **在正式環境沒有任何消費端**。讀到這裡不要以為朗讀判定是分年級的，它不是。
//
//     $ grep -rn "GRADE_CPM_DEFAULTS\|getThresholdsFromBenchmark" frontend/src \
//         --include="*.ts" --include="*.tsx" | grep -v "\.test\.\|__tests__\|personaConfig.ts"
//       → 0 筆（正向對照：同樣查法對 cleanChineseText 有 19 筆）
//
//     學生實際看到的過與不過在 `components/ui/GoalAchievementCard.tsx:37-39`：
//         cpmPassed && accPassed，對的是 **平的** DEFAULT_TARGET_CPM=150
//         與 DEFAULT_TARGET_ACCURACY=90.0（backend/app/schemas/assignment.py:6-7）
//     而 `analyzeFluency` 回的 `passed` **也沒有人讀**（兩個呼叫端都丟掉）。
//
//     ⛔ 而且不要順手把 getThresholdsFromBenchmark 接上去：它取的是三段式評量表
//        **中間那段的下界**（191/201/221），拿中位數當及格線；prod 真實資料實測
//        （47 筆全文朗讀 / 19 人）接上去之後通過數會從 16 掉到 6，14 筆改判
//        **全部是「本來過、改完不過」**。原因是每個年級的常模（190~220）都比
//        現行那條平線 150 高 —— 分年級不是把線拉得更貼身，是整條往上搬。
//
//     這幾個常數留著不刪，是因為將來真要做分年級時它們是起點；
//     但在有人真的接線之前，它們是**死的**。詳見 #3156 ④。
export const FULLREADING_CPM_PASS = 120; // 死的：沒有正式消費端（#3156 ④，2026-09-26 實查）
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
