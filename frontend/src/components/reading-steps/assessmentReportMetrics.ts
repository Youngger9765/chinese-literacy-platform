/**
 * Pure-logic utilities for AssessmentReport (#1845).
 *
 * Extracted so that characterization tests can run without React rendering,
 * and so the refactored sections can share a single computation source.
 *
 * NOTHING in this file has side effects — no localStorage, no fetch, no state.
 */

import type { LearningSession } from '../../types';
import type { ComprehensionScoreResult } from '../../services/learningApi';

// --------------------------------------------------------------------------
// Types re-exported so section components don't import from AssessmentReport
// --------------------------------------------------------------------------

export interface WrongToken {
  char: string;
  expected: string;
}

export interface SegmentStats {
  correct: number;
  wrong: number;
  missing: number;
  total: number;
}

export interface ReportMetrics {
  /** True when student view (hideScores = !readOnly) */
  hideScores: boolean;
  /** True when no reading or comprehension data exists */
  hasNoData: boolean;
  /** Number of the 6 key sections that have data */
  completedSections: number;
  /** Averaged score of whichever sub-scores exist, 0–100, or null */
  overallScore: number | null;
  /** Aggregated per-segment stats from lineBreakdown */
  segmentStats: SegmentStats;
  /** All wrong tokens deduplicated */
  wrongTokens: WrongToken[];
  /** All missing chars deduplicated */
  missingChars: string[];
  /** Best reading accuracy: fullReadingResult matchRate or readingAttempt.accuracy */
  bestReadingAccuracy: number | null;
  /** Comprehension % 0–100: from AI scores or dialogue result */
  comprehensionPct: number | null;
  /** True when any reading data exists (used to gate network calls) */
  hasReadingData: boolean;
}

// --------------------------------------------------------------------------
// Main computation
// --------------------------------------------------------------------------

export function computeReportMetrics(
  session: LearningSession | null,
  readOnly: boolean | undefined,
  comprehensionScores: ComprehensionScoreResult | null | undefined,
): ReportMetrics {
  const hideScores = !readOnly;

  if (!session) {
    return {
      hideScores,
      hasNoData: true,
      completedSections: 0,
      overallScore: null,
      segmentStats: { correct: 0, wrong: 0, missing: 0, total: 0 },
      wrongTokens: [],
      missingChars: [],
      bestReadingAccuracy: null,
      comprehensionPct: null,
      hasReadingData: false,
    };
  }

  const { readingAttempt, comprehensionResult, vocabResult, dictationResult, fullReadingResult } = session;

  const hasNoData =
    !readingAttempt && !comprehensionResult && !vocabResult && !fullReadingResult && !comprehensionScores;

  const completedSections = [
    !!(readingAttempt || fullReadingResult),
    !!(readingAttempt || fullReadingResult),
    !!(readingAttempt?.lineBreakdown?.length),
    !!(readingAttempt || fullReadingResult),
    !!readingAttempt,
    !!(comprehensionScores || comprehensionResult),
  ].filter(Boolean).length;

  // Overall score
  const scores: number[] = [];
  if (readingAttempt) scores.push(readingAttempt.accuracy);
  if (comprehensionResult)
    scores.push(
      Math.round(
        (comprehensionResult.understoodCount / Math.max(comprehensionResult.requiredCount, 1)) * 100,
      ),
    );
  if (dictationResult)
    scores.push(
      dictationResult.totalWords > 0
        ? Math.round((dictationResult.correctCount / dictationResult.totalWords) * 100)
        : 0,
    );
  if (fullReadingResult) scores.push(Math.round(fullReadingResult.matchRate * 100));
  const overallScore =
    scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  // Segment stats + diff tokens
  const lineBreakdown = readingAttempt?.lineBreakdown ?? [];
  const allLineDiffTokens = lineBreakdown.flatMap((l) => l.diffTokens ?? []);
  const segmentStats: SegmentStats = {
    correct: lineBreakdown.filter((l) => l.matchRate >= 0.95).length,
    wrong: lineBreakdown.filter((l) => l.matchRate < 0.95 && l.transcript).length,
    missing: lineBreakdown.filter((l) => !l.transcript).length,
    total: lineBreakdown.length,
  };

  // Wrong tokens (deduplicated)
  const wrongTokens: WrongToken[] = [];
  const seen = new Set<string>();
  for (const t of allLineDiffTokens) {
    if (t.type === 'wrong' && t.expected) {
      const key = `${t.char}->${t.expected}`;
      if (!seen.has(key)) {
        seen.add(key);
        wrongTokens.push({ char: t.char, expected: t.expected });
      }
    }
  }
  if (fullReadingResult?.diffTokens) {
    for (const t of fullReadingResult.diffTokens) {
      if (t.type === 'wrong' && t.expected) {
        const key = `${t.char}->${t.expected}`;
        if (!seen.has(key)) {
          seen.add(key);
          wrongTokens.push({ char: t.char, expected: t.expected });
        }
      }
    }
  }

  // Missing chars (deduplicated)
  const missingChars: string[] = [];
  const seenMissing = new Set<string>();
  for (const t of allLineDiffTokens) {
    if (t.type === 'missing' && !seenMissing.has(t.char)) {
      seenMissing.add(t.char);
      missingChars.push(t.char);
    }
  }

  // Best reading accuracy
  const fullMatchPct = fullReadingResult ? Math.round(fullReadingResult.matchRate * 100) : null;
  const bestReadingAccuracy = fullMatchPct !== null ? fullMatchPct : readingAttempt ? readingAttempt.accuracy : null;

  // Comprehension pct
  const comprehensionPct = comprehensionScores
    ? Math.round(comprehensionScores.comprehension_score)
    : comprehensionResult
    ? Math.round(
        (comprehensionResult.understoodCount / Math.max(comprehensionResult.requiredCount, 1)) * 100,
      )
    : null;

  const hasReadingData = !!(readingAttempt || fullReadingResult);

  return {
    hideScores,
    hasNoData,
    completedSections,
    overallScore,
    segmentStats,
    wrongTokens,
    missingChars,
    bestReadingAccuracy,
    comprehensionPct,
    hasReadingData,
  };
}

// --------------------------------------------------------------------------
// localStorage key helper (pure — just a string computation)
// --------------------------------------------------------------------------

/**
 * Returns the localStorage key used to record that the report was viewed.
 * Delegates to scopedStepStorageKey for scope isolation.
 */
export function reportViewedKey(
  scopedStepStorageKey: (prefix: string, storyId: string | number) => string,
  storyId: string | number,
): string {
  return scopedStepStorageKey('report_viewed_', storyId);
}
