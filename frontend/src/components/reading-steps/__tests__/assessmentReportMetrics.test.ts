/**
 * Characterization tests for AssessmentReport metrics (#1845).
 *
 * TDD-first: these tests must pass on current code AND survive the refactor.
 *
 * Phase:
 *   1. [RED]   Run → fail until assessmentReportMetrics.ts is created
 *   2. [GREEN] Extract logic → tests pass
 *   3. [TAUTOLOGY] Break hideScores logic → confirm fail, restore
 *   4. [REFACTOR] Split component → same tests still pass
 *
 * The 4 required behaviors (from issue #1845):
 *   1. student view hides numeric scores (shows encouragement copy instead)
 *   2. teacher readOnly shows numeric score/accuracy/CPM + suppresses celebration
 *   3. report-viewed writes scoped localStorage key once per story/session
 *   4. no-data session renders preview state + does NOT fetch reading history
 */

import { describe, it, expect } from 'vitest';
import {
  computeReportMetrics,
  reportViewedKey,
} from '../assessmentReportMetrics';
import type { LearningSession } from '../../../types';
import type { ComprehensionScoreResult } from '../../../services/learningApi';

/* ------------------------------------------------------------------ */
/*  Fixtures                                                            */
/* ------------------------------------------------------------------ */

const BASE_SESSION: LearningSession = {
  storyId: 'story-42',
  startedAt: 1716000000000,
  introCompleted: true,
  readingAttempt: null,
  comprehensionResult: null,
  vocabResult: null,
  dictationResult: null,
  fullReadingResult: null,
};

const SESSION_WITH_READING: LearningSession = {
  ...BASE_SESSION,
  readingAttempt: {
    storyId: 'story-42',
    accuracy: 85,
    fluency: 0.8,
    cpm: 120,
    mispronouncedWords: ['聲音'],
    transcription: '今天天氣很好',
    timestamp: 1716000001000,
    lineBreakdown: [
      {
        lineIndex: 0,
        matchRate: 1.0,   // correct
        cpm: 130,
        transcript: '今天天氣很好',
        diffTokens: [
          { char: '今', type: 'correct' },
          { char: '天', type: 'correct' },
        ],
      },
      {
        lineIndex: 1,
        matchRate: 0.5,   // wrong (has transcript, low matchRate)
        cpm: 100,
        transcript: '我很喜歡',
        diffTokens: [
          { char: '我', type: 'correct' },
          { char: '很', type: 'wrong', expected: '非' },
          { char: '愛', type: 'missing' },
        ],
      },
      {
        lineIndex: 2,
        matchRate: 0,     // missing (no transcript)
        cpm: 0,
        transcript: '',   // empty = missing
        diffTokens: [],
      },
    ],
  },
};

const SESSION_WITH_FULL_READING: LearningSession = {
  ...BASE_SESSION,
  fullReadingResult: {
    matchRate: 0.90,
    feedback: '讀得很好！',
    cpm: 140,
    diffTokens: [
      { char: '大', type: 'wrong', expected: '小' },
      { char: '海', type: 'correct' },
    ],
  },
};

const SESSION_WITH_COMPREHENSION: LearningSession = {
  ...BASE_SESSION,
  comprehensionResult: {
    understoodCount: 4,
    requiredCount: 5,
    isComplete: true,
    conversationLength: 8,
  },
};

const AI_COMPREHENSION_SCORES: ComprehensionScoreResult = {
  comprehension_score: 75,
  literal_score: 80,
  inferential_score: 70,
  evaluative_score: 75,
  feedback: {
    literal: '字面理解良好',
    inferential: '推論能力中等',
    evaluative: '評鑑能力待加強',
    overall: '理解良好',
  },
};

/* ------------------------------------------------------------------ */
/*  Test 1: student view hides numeric scores                          */
/* ------------------------------------------------------------------ */

describe('hideScores — student vs teacher', () => {
  it('hideScores is true when readOnly is falsy (student view)', () => {
    // Default student: readOnly is undefined/false
    const metrics = computeReportMetrics(SESSION_WITH_READING, undefined, null);
    expect(metrics.hideScores).toBe(true);
  });

  it('hideScores is true when readOnly=false (explicit student view)', () => {
    const metrics = computeReportMetrics(SESSION_WITH_READING, false, null);
    expect(metrics.hideScores).toBe(true);
  });

  it('hideScores is false when readOnly=true (teacher view)', () => {
    // Teacher view: readOnly=true → hideScores=false → numeric scores shown
    const metrics = computeReportMetrics(SESSION_WITH_READING, true, null);
    expect(metrics.hideScores).toBe(false);
  });

  it('teacher view (readOnly=true) preserves accurate overallScore number', () => {
    // accuracy=85 only → overallScore=85
    const metrics = computeReportMetrics(SESSION_WITH_READING, true, null);
    expect(metrics.hideScores).toBe(false);
    expect(metrics.overallScore).toBe(85);
  });

  it('teacher view with full reading result computes correct overallScore', () => {
    // fullReadingResult matchRate=0.90 → score=90
    const metrics = computeReportMetrics(SESSION_WITH_FULL_READING, true, null);
    expect(metrics.overallScore).toBe(90);
    expect(metrics.hideScores).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Test 2: teacher readOnly suppresses celebration (via hideScores)   */
/* ------------------------------------------------------------------ */

describe('teacher readOnly=true — numeric scores visible, celebration suppressed', () => {
  it('bestReadingAccuracy comes from fullReadingResult matchRate when available', () => {
    // fullReadingResult.matchRate=0.90 → bestReadingAccuracy=90
    const metrics = computeReportMetrics(SESSION_WITH_FULL_READING, true, null);
    expect(metrics.bestReadingAccuracy).toBe(90);
  });

  it('bestReadingAccuracy falls back to readingAttempt.accuracy when no fullReading', () => {
    // readingAttempt.accuracy=85, no fullReadingResult
    const metrics = computeReportMetrics(SESSION_WITH_READING, true, null);
    expect(metrics.bestReadingAccuracy).toBe(85);
  });

  it('comprehensionPct uses AI scores when available', () => {
    // AI score = 75 → comprehensionPct = 75
    const metrics = computeReportMetrics(BASE_SESSION, true, AI_COMPREHENSION_SCORES);
    expect(metrics.comprehensionPct).toBe(75);
  });

  it('comprehensionPct derives from dialogue result when no AI scores', () => {
    // understoodCount=4, requiredCount=5 → 80%
    const metrics = computeReportMetrics(SESSION_WITH_COMPREHENSION, true, null);
    expect(metrics.comprehensionPct).toBe(80);
  });

  it('AI comprehension score takes precedence over dialogue result', () => {
    const sessionBoth: LearningSession = {
      ...SESSION_WITH_COMPREHENSION, // comprehensionResult understoodCount=4, requiredCount=5 → 80%
    };
    // AI score = 75 should win
    const metrics = computeReportMetrics(sessionBoth, true, AI_COMPREHENSION_SCORES);
    expect(metrics.comprehensionPct).toBe(75); // AI wins over 80%
  });
});

/* ------------------------------------------------------------------ */
/*  Test 3: report-viewed localStorage key — scoped per story/session  */
/* ------------------------------------------------------------------ */

describe('reportViewedKey — scoped localStorage key', () => {
  it('returns a key containing the prefix report_viewed_', () => {
    // scopedStepStorageKey just concatenates prefix + scope; for self-practice
    // the scope is the storyId itself.
    const mockScoped = (prefix: string, storyId: string | number) =>
      `${prefix}${String(storyId)}`;

    const key = reportViewedKey(mockScoped, '42');
    expect(key).toContain('report_viewed_');
  });

  it('returns different keys for different story IDs', () => {
    const mockScoped = (prefix: string, storyId: string | number) =>
      `${prefix}${String(storyId)}`;

    const key42 = reportViewedKey(mockScoped, '42');
    const key99 = reportViewedKey(mockScoped, '99');
    expect(key42).not.toBe(key99);
  });

  it('includes the storyId in the key', () => {
    const mockScoped = (prefix: string, storyId: string | number) =>
      `${prefix}${String(storyId)}`;

    const key = reportViewedKey(mockScoped, 'story-abc');
    expect(key).toContain('story-abc');
  });

  it('returns the exact key produced by scopedStepStorageKey (no manipulation)', () => {
    // Confirm reportViewedKey is a thin wrapper — no extra transformation
    const capturedArgs: Array<[string, string | number]> = [];
    const mockScoped = (prefix: string, storyId: string | number) => {
      capturedArgs.push([prefix, storyId]);
      return `SCOPED:${prefix}${storyId}`;
    };

    const result = reportViewedKey(mockScoped, 77);
    expect(capturedArgs).toHaveLength(1);
    expect(capturedArgs[0]).toEqual(['report_viewed_', 77]);
    expect(result).toBe('SCOPED:report_viewed_77');
  });
});

/* ------------------------------------------------------------------ */
/*  Test 4: no-data session → preview state, no reading fetch          */
/* ------------------------------------------------------------------ */

describe('hasNoData — no-data session preview state', () => {
  it('hasNoData=true when session has no sub-results', () => {
    const metrics = computeReportMetrics(BASE_SESSION, false, null);
    expect(metrics.hasNoData).toBe(true);
  });

  it('hasNoData=false when readingAttempt exists', () => {
    const metrics = computeReportMetrics(SESSION_WITH_READING, false, null);
    expect(metrics.hasNoData).toBe(false);
  });

  it('hasNoData=false when only comprehensionScores exist (Issue #1245 item 4)', () => {
    // A session with only AI comprehension scores should NOT be treated as no-data
    const metrics = computeReportMetrics(BASE_SESSION, false, AI_COMPREHENSION_SCORES);
    expect(metrics.hasNoData).toBe(false);
  });

  it('hasReadingData=false when no readingAttempt and no fullReadingResult', () => {
    // This gates the reading history fetch — must not trigger if no reading
    const metrics = computeReportMetrics(BASE_SESSION, false, null);
    expect(metrics.hasReadingData).toBe(false);
  });

  it('hasReadingData=true when readingAttempt exists', () => {
    const metrics = computeReportMetrics(SESSION_WITH_READING, false, null);
    expect(metrics.hasReadingData).toBe(true);
  });

  it('hasReadingData=true when only fullReadingResult exists', () => {
    const metrics = computeReportMetrics(SESSION_WITH_FULL_READING, false, null);
    expect(metrics.hasReadingData).toBe(true);
  });

  it('returns null session gracefully — hasNoData=true and no crash', () => {
    const metrics = computeReportMetrics(null, false, null);
    expect(metrics.hasNoData).toBe(true);
    expect(metrics.overallScore).toBeNull();
    expect(metrics.wrongTokens).toHaveLength(0);
    expect(metrics.hasReadingData).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Additional: wrongTokens / missingChars aggregation                 */
/* ------------------------------------------------------------------ */

describe('wrongTokens and missingChars aggregation', () => {
  it('extracts wrong tokens from lineBreakdown diffTokens', () => {
    const metrics = computeReportMetrics(SESSION_WITH_READING, false, null);
    // lineBreakdown has one wrong token: 很→非
    expect(metrics.wrongTokens).toEqual([{ char: '很', expected: '非' }]);
  });

  it('deduplicates wrong tokens across lines', () => {
    const session: LearningSession = {
      ...BASE_SESSION,
      readingAttempt: {
        storyId: 'story-42',
        accuracy: 70,
        fluency: 0.7,
        cpm: 100,
        mispronouncedWords: [],
        transcription: 'abc',
        timestamp: 0,
        lineBreakdown: [
          {
            lineIndex: 0,
            matchRate: 0.5,
            cpm: 100,
            transcript: 'a',
            diffTokens: [{ char: '好', type: 'wrong', expected: '壞' }],
          },
          {
            lineIndex: 1,
            matchRate: 0.5,
            cpm: 100,
            transcript: 'b',
            // Same token again — should be deduped
            diffTokens: [{ char: '好', type: 'wrong', expected: '壞' }],
          },
        ],
      },
    };
    const metrics = computeReportMetrics(session, false, null);
    expect(metrics.wrongTokens).toHaveLength(1);
  });

  it('also collects wrong tokens from fullReadingResult.diffTokens', () => {
    const metrics = computeReportMetrics(SESSION_WITH_FULL_READING, false, null);
    // fullReadingResult has: { char: '大', type: 'wrong', expected: '小' }
    expect(metrics.wrongTokens).toEqual([{ char: '大', expected: '小' }]);
  });

  it('extracts missing chars from lineBreakdown diffTokens', () => {
    const metrics = computeReportMetrics(SESSION_WITH_READING, false, null);
    // lineBreakdown line 1 has { char: '愛', type: 'missing' }
    expect(metrics.missingChars).toContain('愛');
  });

  it('deduplicates missing chars', () => {
    const session: LearningSession = {
      ...BASE_SESSION,
      readingAttempt: {
        storyId: 'story-42',
        accuracy: 70,
        fluency: 0.7,
        cpm: 100,
        mispronouncedWords: [],
        transcription: '',
        timestamp: 0,
        lineBreakdown: [
          {
            lineIndex: 0,
            matchRate: 0.5,
            cpm: 100,
            transcript: 'a',
            diffTokens: [
              { char: '風', type: 'missing' },
              { char: '風', type: 'missing' }, // duplicate in same line
            ],
          },
        ],
      },
    };
    const metrics = computeReportMetrics(session, false, null);
    expect(metrics.missingChars.filter((c) => c === '風')).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Additional: segmentStats                                            */
/* ------------------------------------------------------------------ */

describe('segmentStats from lineBreakdown', () => {
  it('counts correct/wrong/missing/total accurately', () => {
    const metrics = computeReportMetrics(SESSION_WITH_READING, false, null);
    // Line 0: matchRate=1.0 → correct
    // Line 1: matchRate=0.5, has transcript → wrong
    // Line 2: matchRate=0, no transcript → missing
    expect(metrics.segmentStats).toEqual({
      correct: 1,
      wrong: 1,
      missing: 1,
      total: 3,
    });
  });

  it('returns zeroed stats when no lineBreakdown', () => {
    const metrics = computeReportMetrics(BASE_SESSION, false, null);
    expect(metrics.segmentStats).toEqual({ correct: 0, wrong: 0, missing: 0, total: 0 });
  });
});

/* ------------------------------------------------------------------ */
/*  Additional: completedSections count                                 */
/* ------------------------------------------------------------------ */

describe('completedSections count', () => {
  it('returns 0 for empty session', () => {
    const metrics = computeReportMetrics(BASE_SESSION, false, null);
    expect(metrics.completedSections).toBe(0);
  });

  it('counts correctly for reading-only session', () => {
    // Section 1 (朗讀結果): yes, Section 2 (錄音分析): yes, Section 3 (逐句): yes (has lineBreakdown),
    // Section 4 (錯字): yes, Section 5 (建議): yes (readingAttempt), Section 6 (理解): no
    const metrics = computeReportMetrics(SESSION_WITH_READING, false, null);
    expect(metrics.completedSections).toBe(5);
  });

  it('adds section 6 when comprehensionScores provided', () => {
    const metrics = computeReportMetrics(SESSION_WITH_READING, false, AI_COMPREHENSION_SCORES);
    expect(metrics.completedSections).toBe(6);
  });
});

/* ------------------------------------------------------------------ */
/*  Additional: overallScore computation                               */
/* ------------------------------------------------------------------ */

describe('overallScore computation', () => {
  it('returns null when no sub-scores exist', () => {
    const metrics = computeReportMetrics(BASE_SESSION, false, null);
    expect(metrics.overallScore).toBeNull();
  });

  it('averages readingAttempt.accuracy and comprehensionResult', () => {
    const session: LearningSession = {
      ...BASE_SESSION,
      readingAttempt: {
        storyId: 'story-42',
        accuracy: 80,
        fluency: 0.8,
        cpm: 120,
        mispronouncedWords: [],
        transcription: '',
        timestamp: 0,
      },
      comprehensionResult: {
        understoodCount: 3,
        requiredCount: 4,   // 75%
        isComplete: true,
        conversationLength: 6,
      },
    };
    // (80 + 75) / 2 = 77.5 → rounds to 78
    const metrics = computeReportMetrics(session, false, null);
    expect(metrics.overallScore).toBe(78);
  });

  it('does NOT include vocabResult in overall score (#1333)', () => {
    const session: LearningSession = {
      ...BASE_SESSION,
      readingAttempt: {
        storyId: 'story-42',
        accuracy: 100,
        fluency: 1.0,
        cpm: 200,
        mispronouncedWords: [],
        transcription: '',
        timestamp: 0,
      },
      vocabResult: {
        practicedWords: ['好', '大'],
        totalWords: 2,
      },
    };
    // vocabResult should be excluded — only readingAttempt contributes → score=100
    const metrics = computeReportMetrics(session, false, null);
    expect(metrics.overallScore).toBe(100);
  });
});
