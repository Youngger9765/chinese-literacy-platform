/**
 * Tests for fluencyAnalyzer — Bug A and Bug B fixes (Issue #1378).
 *
 * Bug A: parseReadingBenchmark returned [] for 秒-format (G8 文言文) → no feedback
 * Bug B: FULLREADING_CPM_PASS = 120 hardcoded override of per-lesson YAML thresholds
 */

import { describe, it, expect } from 'vitest';
import {
  parseReadingBenchmark,
  getBenchmarkFeedback,
  getSecBenchmarkFeedback,
  getAiFluencyInsight,
  type BenchmarkLevel,
  type BenchmarkLevelSec,
} from './fluencyAnalyzer';
import { getThresholdsFromBenchmark, FULLREADING_CPM_PASS } from './personaConfig';

// ─────────────────────────────────────────────────────────────────────────────
// Bug A: parseReadingBenchmark — 秒 format (G8 文言文)
// ─────────────────────────────────────────────────────────────────────────────

describe('parseReadingBenchmark — 秒 format (Bug A)', () => {
  const g8Levels = [
    { threshold: '□20秒以下', feedback: '速度有點快，要讀清楚哦!' },
    { threshold: '□ 20~30秒', feedback: '強者就是你啦！' },
    { threshold: '□30秒以上', feedback: '速度再快一點！' },
  ];

  it('should NOT return empty array for 秒 format', () => {
    const result = parseReadingBenchmark(g8Levels);
    expect(result).toHaveLength(3);
  });

  it('should return BenchmarkLevelSec objects with unit: sec', () => {
    const result = parseReadingBenchmark(g8Levels);
    expect(result.every((l) => 'unit' in l && l.unit === 'sec')).toBe(true);
  });

  it('parses "N秒以下" as maxSec=N, minSec=0', () => {
    const result = parseReadingBenchmark(g8Levels);
    const first = result[0] as BenchmarkLevelSec;
    expect(first.unit).toBe('sec');
    expect(first.minSec).toBe(0);
    expect(first.maxSec).toBe(20);
    expect(first.feedback).toBe('速度有點快，要讀清楚哦!');
  });

  it('parses "20~30秒" as minSec=20, maxSec=30', () => {
    const result = parseReadingBenchmark(g8Levels);
    const mid = result[1] as BenchmarkLevelSec;
    expect(mid.unit).toBe('sec');
    expect(mid.minSec).toBe(20);
    expect(mid.maxSec).toBe(30);
  });

  it('parses "N秒以上" as minSec=N, maxSec=Infinity', () => {
    const result = parseReadingBenchmark(g8Levels);
    const last = result[2] as BenchmarkLevelSec;
    expect(last.unit).toBe('sec');
    expect(last.minSec).toBe(30);
    expect(last.maxSec).toBe(Infinity);
  });

  it('getSecBenchmarkFeedback returns correct feedback for 15s (fast)', () => {
    const levels = parseReadingBenchmark(g8Levels);
    const feedback = getSecBenchmarkFeedback(15, levels);
    expect(feedback).toBe('速度有點快，要讀清楚哦!');
  });

  it('getSecBenchmarkFeedback returns correct feedback for 25s (mid)', () => {
    const levels = parseReadingBenchmark(g8Levels);
    const feedback = getSecBenchmarkFeedback(25, levels);
    expect(feedback).toBe('強者就是你啦！');
  });

  it('getSecBenchmarkFeedback returns correct feedback for 45s (slow)', () => {
    const levels = parseReadingBenchmark(g8Levels);
    const feedback = getSecBenchmarkFeedback(45, levels);
    expect(feedback).toBe('速度再快一點！');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug A: parseReadingBenchmark — CPM format (unchanged, regression test)
// ─────────────────────────────────────────────────────────────────────────────

describe('parseReadingBenchmark — CPM format (regression)', () => {
  const g4Levels = [
    { threshold: '□＜190字', feedback: '需要多練習' },
    { threshold: '□ 191~220字', feedback: '很好' },
    { threshold: '□＞221字', feedback: '超棒！' },
  ];

  it('returns 3 CPM levels for G4', () => {
    const result = parseReadingBenchmark(g4Levels);
    expect(result).toHaveLength(3);
  });

  it('none of the levels has unit: sec', () => {
    const result = parseReadingBenchmark(g4Levels);
    expect(result.every((l) => !('unit' in l))).toBe(true);
  });

  it('parses ＜190 as maxCpm=189', () => {
    const result = parseReadingBenchmark(g4Levels);
    const first = result[0] as BenchmarkLevel;
    expect(first.maxCpm).toBe(189);
    expect(first.minCpm).toBe(0);
  });

  it('parses 191~220 correctly', () => {
    const result = parseReadingBenchmark(g4Levels);
    const mid = result[1] as BenchmarkLevel;
    expect(mid.minCpm).toBe(191);
    expect(mid.maxCpm).toBe(220);
  });

  it('parses ＞221 as minCpm=221, maxCpm=Infinity', () => {
    const result = parseReadingBenchmark(g4Levels);
    const last = result[2] as BenchmarkLevel;
    expect(last.minCpm).toBe(221);
    expect(last.maxCpm).toBe(Infinity);
  });

  it('getBenchmarkFeedback matches CPM correctly', () => {
    const levels = parseReadingBenchmark(g4Levels);
    expect(getBenchmarkFeedback(185, levels)).toBe('需要多練習');
    expect(getBenchmarkFeedback(200, levels)).toBe('很好');
    expect(getBenchmarkFeedback(250, levels)).toBe('超棒！');
    expect(getBenchmarkFeedback(220, levels)).toBe('很好');
  });

  it('getAiFluencyInsight returns gap to mid tier for slow CPM', () => {
    const levels = parseReadingBenchmark(g4Levels);
    const insight = getAiFluencyInsight(150, 60000, levels);
    expect(insight?.rating).toBe('low');
    expect(insight?.metricValue).toBe(150);
    expect(insight?.rangeLabel).toBe('190 字/分以下');
    expect(insight?.gapToMidTier).toBe(41);
    expect(insight?.midTierLabel).toBe('191~220 字/分鐘');
  });

  it('empty levels returns empty array', () => {
    expect(parseReadingBenchmark([])).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug B: getThresholdsFromBenchmark — lesson-aware threshold
// ─────────────────────────────────────────────────────────────────────────────

describe('getThresholdsFromBenchmark — lesson-aware (Bug B)', () => {
  const g4Levels = [
    { threshold: '□＜190字', feedback: '需要多練習' },
    { threshold: '□ 191~220字', feedback: '很好' },
    { threshold: '□＞221字', feedback: '超棒！' },
  ];

  it('returns cpmPass=191 from G4 lesson benchmark (NOT the hardcoded 120)', () => {
    const parsed = parseReadingBenchmark(g4Levels);
    const thresholds = getThresholdsFromBenchmark(parsed, 4);
    expect(thresholds).not.toBeNull();
    expect(thresholds!.cpmPass).toBe(191);
    expect(thresholds!.cpmPass).not.toBe(120); // Bug B: was always 120
  });

  it('falls back to global 120 when no benchmark and no grade', () => {
    const thresholds = getThresholdsFromBenchmark(null);
    expect(thresholds).not.toBeNull();
    expect(thresholds!.cpmPass).toBe(FULLREADING_CPM_PASS); // 120
  });

  it('uses grade default when no benchmark but grade=7', () => {
    const thresholds = getThresholdsFromBenchmark(null, 7);
    expect(thresholds).not.toBeNull();
    expect(thresholds!.cpmPass).toBe(220); // GRADE_CPM_DEFAULTS[7]
  });

  it('uses grade default when no benchmark but grade=4', () => {
    const thresholds = getThresholdsFromBenchmark(null, 4);
    expect(thresholds).not.toBeNull();
    expect(thresholds!.cpmPass).toBe(190); // GRADE_CPM_DEFAULTS[4]
  });

  it('returns null for 秒-based benchmark (no CPM pass threshold)', () => {
    const g8Levels = [
      { threshold: '□20秒以下', feedback: '速度有點快，要讀清楚哦!' },
      { threshold: '□ 20~30秒', feedback: '強者就是你啦！' },
      { threshold: '□30秒以上', feedback: '速度再快一點！' },
    ];
    const parsed = parseReadingBenchmark(g8Levels);
    const thresholds = getThresholdsFromBenchmark(parsed, 8);
    expect(thresholds).toBeNull();
  });

  it('returns correct accuracyPass regardless of grade', () => {
    const parsed = parseReadingBenchmark(g4Levels);
    const thresholds = getThresholdsFromBenchmark(parsed, 4);
    expect(thresholds!.accuracyPass).toBe(0.80);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Block 1 (Issue #2131): passed = accuracyPassed only; encouragement-first feedback
// ─────────────────────────────────────────────────────────────────────────────

import { analyzeFluency } from './fluencyAnalyzer';

describe('analyzeFluency — passed uses accuracy only (Issue #2131)', () => {
  // Scenario: high accuracy but slow speed → should PASS after fix
  it('passes when accuracy is high even if speed is below threshold', () => {
    // target text of 20 chars; read in 30s → CPM = 20/30*60 = 40 (well below any threshold)
    // accuracy: read all 20 chars correctly → matchRate ≥ 0.80
    const target = '春風吹過田野花兒開了我愛讀書學習進步';
    const result = analyzeFluency({
      spoken: target, // perfect reading
      target,
      durationMs: 30_000, // 30s → CPM ≈ 36 (very slow)
      thresholds: { cpmPass: 120, accuracyPass: 0.80 },
    });
    expect(result.accuracyPassed).toBe(true);
    expect(result.speedPassed).toBe(false); // slow
    expect(result.passed).toBe(true); // <-- FAILS before fix (was: accuracyPassed && speedPassed)
  });

  // Scenario: low accuracy + low speed → should NOT pass
  it('does not pass when accuracy is below threshold', () => {
    const target = '春風吹過田野花兒開了我愛讀書學習進步';
    const result = analyzeFluency({
      spoken: '123456', // garbage
      target,
      durationMs: 5_000,
      thresholds: { cpmPass: 120, accuracyPass: 0.80 },
    });
    expect(result.accuracyPassed).toBe(false);
    expect(result.passed).toBe(false);
  });

  // Scenario: high accuracy + high speed → should still pass
  it('passes when both accuracy and speed are high', () => {
    const target = '春風吹過田野花兒開了我愛讀書學習進步';
    const result = analyzeFluency({
      spoken: target,
      target,
      durationMs: 2_000, // 2s → CPM ≈ 540 (very fast)
      thresholds: { cpmPass: 120, accuracyPass: 0.80 },
    });
    expect(result.accuracyPassed).toBe(true);
    expect(result.speedPassed).toBe(true);
    expect(result.passed).toBe(true);
  });

  // Scenario: speedPassed is still computed (for display purposes)
  it('still computes speedPassed for display even when it does not affect passed', () => {
    const target = '春風吹過田野花兒開了';
    const result = analyzeFluency({
      spoken: target,
      target,
      durationMs: 30_000, // slow
      thresholds: { cpmPass: 120, accuracyPass: 0.80 },
    });
    expect(result.speedPassed).toBe(false); // computed
    expect(typeof result.cpm).toBe('number');
    expect(result.cpm).toBeGreaterThan(0);
  });
});

describe('generateFeedback — encouragement-first, no negative speed language (Issue #2131)', () => {
  // The feedback is embedded in FluencyResult.feedback from analyzeFluency()
  // We verify the new message strings via result.feedback

  it('accurate reader gets positive feedback without negative speed mention', () => {
    const target = '春風吹過田野花兒開了我愛讀書學習進步';
    const result = analyzeFluency({
      spoken: target,
      target,
      durationMs: 30_000, // slow
      thresholds: { cpmPass: 120, accuracyPass: 0.80 },
    });
    expect(result.accuracyPassed).toBe(true);
    // Old feedback: "讀得很準確！速度再練快一點就完美了。" (negative speed message)
    // New feedback: should NOT contain "速度不過" pattern and should be encouraging
    expect(result.feedback).not.toContain('速度再練快一點就完美了');
    expect(result.feedback).not.toContain('速度不過');
    // Should be positive/encouraging
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it('highly accurate reader (≥0.75) gets very positive feedback', () => {
    const target = '春風吹過田野花兒開了我愛讀書學習進步';
    const result = analyzeFluency({
      spoken: target,
      target,
      durationMs: 30_000,
      thresholds: { cpmPass: 120, accuracyPass: 0.80 },
    });
    // accuracy should be near 1.0 for perfect reading
    expect(result.accuracy).toBeGreaterThanOrEqual(0.75);
    // Should get the top-tier positive feedback
    expect(result.feedback).toMatch(/流暢|棒|很好|不錯/);
  });

  it('low accuracy reader gets encouragement to keep practicing', () => {
    const target = '春風吹過田野花兒開了我愛讀書學習進步';
    const result = analyzeFluency({
      spoken: '一二三四五', // very wrong
      target,
      durationMs: 5_000,
      thresholds: { cpmPass: 120, accuracyPass: 0.80 },
    });
    expect(result.accuracyPassed).toBe(false);
    // Should be encouraging, not punishing
    expect(result.feedback).toMatch(/練|進步|多/);
    // Should NOT say "速度不過" or blame speed
    expect(result.feedback).not.toContain('速度不過');
  });
});
