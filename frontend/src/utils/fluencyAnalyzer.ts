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
 *   - Full-width tilde ～ (U+FF5E) and half-width ~ both supported
 *   - Inconsistent spacing after □ (trimmed)
 *   - Returns empty array for 秒 format (Grade 8, only 4 lessons — deferred)
 */
export function parseReadingBenchmark(
  levels: { threshold: string; feedback: string }[]
): BenchmarkLevel[] {
  const result: BenchmarkLevel[] = [];

  for (const level of levels) {
    const raw = level.threshold.replace(/□\s*/, '').trim();

    // Skip 秒-based benchmarks (Grade 8 文言文)
    if (raw.includes('秒')) return [];

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

export function getBenchmarkFeedback(
  cpm: number,
  levels: BenchmarkLevel[]
): string | null {
  for (const level of levels) {
    if (cpm >= level.minCpm && cpm <= level.maxCpm) {
      return level.feedback;
    }
  }
  return null;
}
