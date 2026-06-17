/**
 * Unified fluency analysis engine.
 * Centralizes CPM calculation, pass/fail determination, and feedback messages.
 */
import type { DiffToken } from '../types';
import { diffCharacters } from './textDiff';
import { correctHomophones } from './pinyin';
import { normalizeForComparison, cleanChineseText } from './textDiff';
import { FULLREADING_CPM_PASS, FULLREADING_ACCURACY_PASS } from './personaConfig';

export interface FluencyThresholds {
  cpmPass: number;
  accuracyPass: number;
}

export const DEFAULT_THRESHOLDS: FluencyThresholds = {
  cpmPass: FULLREADING_CPM_PASS,
  accuracyPass: FULLREADING_ACCURACY_PASS,
};

export interface ErrorBreakdown {
  correct: number;
  wrong: number;
  missing: number;
  extra: number;
}

export interface FluencyResult {
  accuracy: number;
  cpm: number;
  correctCount: number;
  durationMs: number;
  passed: boolean;
  speedPassed: boolean;
  accuracyPassed: boolean;
  errorBreakdown: ErrorBreakdown;
  diffTokens: DiffToken[];
  thresholds: FluencyThresholds;
  feedback: string;
}

export interface BenchmarkLevel {
  minCpm: number;
  maxCpm: number;
  feedback: string;
}

/**
 * Benchmark level for lessons measured in seconds (G8 文言文).
 * Lower seconds = better (inverse of CPM).
 * maxSec: upper bound (inclusive); Infinity = no upper bound (student is too slow)
 * minSec: lower bound (inclusive); 0 = no lower bound (student is very fast)
 */
export interface BenchmarkLevelSec {
  unit: 'sec';
  minSec: number;
  maxSec: number;
  feedback: string;
}

export type ParsedBenchmark = BenchmarkLevel | BenchmarkLevelSec;

/**
 * Encouragement-first feedback (Issue #2131).
 * Speed (CPM) is no longer a pass/fail criterion and never appears in feedback —
 * it stays display-only on the score card. Feedback tiers are accuracy-based only:
 *   - accuracy >= 0.75: top tier, very fluent
 *   - accuracy >= 0.55: mid tier, decent
 *   - else: encourage to keep practising
 */
function generateFeedback(accuracy: number): string {
  if (accuracy >= 0.75) {
    return '讀得很流暢！繼續保持，越來越棒！';
  }
  if (accuracy >= 0.55) {
    return '讀得不錯！多練幾次，準確度會越來越高。';
  }
  return '沒關係，多練幾次就會進步！先把每一段練熟，再挑戰全文。';
}

export function analyzeFluency(input: {
  spoken: string;
  target: string;
  durationMs: number;
  thresholds?: FluencyThresholds;
}): FluencyResult {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const targetNorm = normalizeForComparison(input.target);
  const cleaned = cleanChineseText(input.spoken);
  const corrected = correctHomophones(cleaned, targetNorm);
  const diffResult = diffCharacters(corrected, input.target, { useHomophone: true });

  const durationSec = Math.max(input.durationMs / 1000, 0.5);
  const cpm = Math.round((diffResult.correctCount / durationSec) * 60);

  const accuracyPassed = diffResult.matchRate >= thresholds.accuracyPass;
  const speedPassed = cpm >= thresholds.cpmPass;
  // Issue #2131: passed is accuracy-only; speedPassed is kept for display reference only.
  const passed = accuracyPassed;

  const errorBreakdown: ErrorBreakdown = {
    correct: diffResult.correctCount,
    wrong: diffResult.wrongCount,
    missing: diffResult.missingCount,
    extra: diffResult.extraCount,
  };

  return {
    accuracy: diffResult.matchRate,
    cpm,
    correctCount: diffResult.correctCount,
    durationMs: input.durationMs,
    passed,
    speedPassed,
    accuracyPassed,
    errorBreakdown,
    diffTokens: diffResult.tokens,
    thresholds,
    feedback: generateFeedback(diffResult.matchRate),
  };
}

/**
 * Parse reading benchmark levels from OCR strings.
 * Supports:
 *   - CPM format (字): "□＜190字", "□ 191~220字", "□＞221字"
 *   - Seconds format (秒): "□20秒以下", "□ 20~30秒", "□30秒以上"
 *   - Full-width tilde ～ (U+FF5E) and half-width ~ both supported
 *   - Inconsistent spacing after □ (trimmed)
 *
 * Returns an array of either BenchmarkLevel (CPM) or BenchmarkLevelSec (seconds).
 * Previously returned [] for 秒 format — Bug A fix: now handles G8 文言文 correctly.
 */
export function parseReadingBenchmark(
  levels: { threshold: string; feedback: string }[]
): ParsedBenchmark[] {
  if (levels.length === 0) return [];

  // Detect unit from first non-empty level
  const firstRaw = levels[0].threshold.replace(/□\s*/, '').trim();
  const isSecFormat = firstRaw.includes('秒');

  if (isSecFormat) {
    return parseSecBenchmark(levels);
  }
  return parseCpmBenchmark(levels);
}

/**
 * Parse CPM (字/分) benchmark levels.
 * e.g. "□＜190字" → { minCpm: 0, maxCpm: 189 }
 */
function parseCpmBenchmark(
  levels: { threshold: string; feedback: string }[]
): BenchmarkLevel[] {
  const result: BenchmarkLevel[] = [];

  for (const level of levels) {
    const raw = level.threshold.replace(/□\s*/, '').trim();

    // Range: 191~220字 or 191～220字
    const rangeMatch = raw.match(/(\d+)\s*[~～]\s*(\d+)\s*字/);
    if (rangeMatch) {
      result.push({
        minCpm: parseInt(rangeMatch[1], 10),
        maxCpm: parseInt(rangeMatch[2], 10),
        feedback: level.feedback,
      });
      continue;
    }

    // Less than: ＜190字
    const ltMatch = raw.match(/[＜<]\s*(\d+)\s*字/);
    if (ltMatch) {
      result.push({
        minCpm: 0,
        maxCpm: parseInt(ltMatch[1], 10) - 1,
        feedback: level.feedback,
      });
      continue;
    }

    // Greater than: ＞221字
    const gtMatch = raw.match(/[＞>]\s*(\d+)\s*字/);
    if (gtMatch) {
      result.push({
        minCpm: parseInt(gtMatch[1], 10),
        maxCpm: Infinity,
        feedback: level.feedback,
      });
      continue;
    }
  }

  return result;
}

/**
 * Parse seconds (秒) benchmark levels for G8 文言文.
 * e.g. "□20秒以下" → { unit: 'sec', minSec: 0, maxSec: 20 }
 *      "□ 20~30秒"  → { unit: 'sec', minSec: 20, maxSec: 30 }
 *      "□30秒以上"  → { unit: 'sec', minSec: 30, maxSec: Infinity }
 *
 * Note: lower seconds = faster = better.
 */
function parseSecBenchmark(
  levels: { threshold: string; feedback: string }[]
): BenchmarkLevelSec[] {
  const result: BenchmarkLevelSec[] = [];

  for (const level of levels) {
    const raw = level.threshold.replace(/□\s*/, '').trim();

    // Range: 20~30秒 or 20～30秒
    const rangeMatch = raw.match(/(\d+)\s*[~～]\s*(\d+)\s*秒/);
    if (rangeMatch) {
      result.push({
        unit: 'sec',
        minSec: parseInt(rangeMatch[1], 10),
        maxSec: parseInt(rangeMatch[2], 10),
        feedback: level.feedback,
      });
      continue;
    }

    // "N秒以下" = up to N seconds (fast end)
    const belowMatch = raw.match(/(\d+)\s*秒以下/);
    if (belowMatch) {
      result.push({
        unit: 'sec',
        minSec: 0,
        maxSec: parseInt(belowMatch[1], 10),
        feedback: level.feedback,
      });
      continue;
    }

    // "N秒以上" = N seconds or more (slow end)
    const aboveMatch = raw.match(/(\d+)\s*秒以上/);
    if (aboveMatch) {
      result.push({
        unit: 'sec',
        minSec: parseInt(aboveMatch[1], 10),
        maxSec: Infinity,
        feedback: level.feedback,
      });
      continue;
    }
  }

  return result;
}

export function getBenchmarkFeedback(
  cpm: number,
  levels: ParsedBenchmark[]
): string | null {
  for (const level of levels) {
    if ('unit' in level) {
      // Seconds-based benchmark: not applicable for CPM-only callers (use getSecBenchmarkFeedback)
      continue;
    }
    if (cpm >= level.minCpm && cpm <= level.maxCpm) {
      return level.feedback;
    }
  }
  return null;
}

/**
 * Get feedback for seconds-based benchmarks (G8 文言文).
 * durationSec: how many seconds the student took to read the full passage.
 */
export function getSecBenchmarkFeedback(
  durationSec: number,
  levels: ParsedBenchmark[]
): string | null {
  for (const level of levels) {
    if (!('unit' in level)) continue; // skip CPM levels
    if (durationSec >= level.minSec && durationSec <= level.maxSec) {
      return level.feedback;
    }
  }
  return null;
}

/** Three-tier fluency rating derived from lesson reading_benchmark. */
export type FluencyTierRating = 'low' | 'mid' | 'high';

export interface AiFluencyInsight {
  rating: FluencyTierRating;
  benchmarkFeedback: string;
  metricValue: number;
  metricUnit: 'cpm' | 'sec';
  rangeLabel: string;
  /** Distance to the lesson's recommended mid tier; null when already there or better. */
  gapToMidTier: number | null;
  midTierLabel: string | null;
}

function mapBenchmarkIndexToRating(
  idx: number,
  total: number,
  useSec: boolean
): FluencyTierRating {
  if (total === 1) return 'mid';
  if (idx === 0) return useSec ? 'high' : 'low';
  if (idx === total - 1) return useSec ? 'low' : 'high';
  return 'mid';
}

export function formatCpmRangeLabel(level: BenchmarkLevel): string {
  if (level.maxCpm === Infinity) return `${level.minCpm} 字/分以上`;
  if (level.minCpm === 0) return `${level.maxCpm + 1} 字/分以下`;
  return `${level.minCpm}~${level.maxCpm} 字/分鐘`;
}

export function formatSecRangeLabel(level: BenchmarkLevelSec): string {
  if (level.maxSec === Infinity) return `${level.minSec} 秒以上`;
  if (level.minSec === 0) return `${level.maxSec} 秒以下`;
  return `${level.minSec}~${level.maxSec} 秒`;
}

function getMidTierIndex(levels: ParsedBenchmark[]): number {
  if (levels.length <= 1) return 0;
  return 1;
}

/**
 * Build objective AI fluency insight for self-assessment comparison (Issue #1386).
 * Uses lesson reading_benchmark tiers — no pejorative low/mid/high labels in UI copy.
 */
export function getAiFluencyInsight(
  cpm: number,
  durationMs: number,
  levels: ParsedBenchmark[]
): AiFluencyInsight | null {
  if (levels.length === 0) return null;

  const useSec = 'unit' in levels[0];
  const midIdx = getMidTierIndex(levels);

  if (useSec) {
    const durationSec = Math.round((durationMs / 1000) * 10) / 10;
    let matchedIdx = -1;
    let matched: BenchmarkLevelSec | null = null;
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i] as BenchmarkLevelSec;
      if (durationSec >= level.minSec && durationSec <= level.maxSec) {
        matchedIdx = i;
        matched = level;
        break;
      }
    }
    if (matchedIdx === -1 || !matched) return null;

    const midLevel = levels[midIdx] as BenchmarkLevelSec;
    let gapToMidTier: number | null = null;
    if (matchedIdx > midIdx) {
      // Slower than recommended — need to shave seconds off
      gapToMidTier = Math.max(0, Math.round((durationSec - midLevel.maxSec) * 10) / 10);
    }

    return {
      rating: mapBenchmarkIndexToRating(matchedIdx, levels.length, true),
      benchmarkFeedback: matched.feedback,
      metricValue: durationSec,
      metricUnit: 'sec',
      rangeLabel: formatSecRangeLabel(matched),
      gapToMidTier,
      midTierLabel: formatSecRangeLabel(midLevel),
    };
  }

  const roundedCpm = Math.round(cpm);
  let matchedIdx = -1;
  let matched: BenchmarkLevel | null = null;
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i] as BenchmarkLevel;
    if (roundedCpm >= level.minCpm && roundedCpm <= level.maxCpm) {
      matchedIdx = i;
      matched = level;
      break;
    }
  }
  if (matchedIdx === -1 || !matched) return null;

  const midLevel = levels[midIdx] as BenchmarkLevel;
  let gapToMidTier: number | null = null;
  if (matchedIdx < midIdx && roundedCpm < midLevel.minCpm) {
    gapToMidTier = midLevel.minCpm - roundedCpm;
  }

  return {
    rating: mapBenchmarkIndexToRating(matchedIdx, levels.length, false),
    benchmarkFeedback: matched.feedback,
    metricValue: roundedCpm,
    metricUnit: 'cpm',
    rangeLabel: formatCpmRangeLabel(matched),
    gapToMidTier,
    midTierLabel: formatCpmRangeLabel(midLevel),
  };
}
