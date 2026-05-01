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

function generateFeedback(speedPassed: boolean, accuracyPassed: boolean): string {
  if (speedPassed && accuracyPassed)
    return '太棒了！速度和準確度都過關了！';
  if (accuracyPassed && !speedPassed)
    return '讀得很準確！速度再練快一點就完美了。';
  if (speedPassed && !accuracyPassed)
    return '速度很好！不過有些字要再練一練，讀慢一點沒關係。';
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
  const passed = accuracyPassed && speedPassed;

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
    feedback: generateFeedback(speedPassed, accuracyPassed),
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
