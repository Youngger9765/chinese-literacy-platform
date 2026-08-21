/**
 * practiceStepsSummary.test.ts (#2835)
 *
 * TDD-first: computePracticeStepsSummary must be created for these to pass.
 *
 * Covers the practice steps that have NEVER appeared anywhere in
 * AssessmentReport before this issue: 讀全文-做記號 / 詞語理解 / 語詞應用 /
 * 文章重點表 / 閱讀聚光燈 / 語詞複習 / 知識補給站.
 *
 * Ground truth for "completed" = the same `completedSteps` array StepperNav
 * already renders checkmarks from (session.completedSteps / step_progress
 * steps_completed) — NOT a new source of truth.
 */

import { describe, it, expect } from 'vitest';
import { computePracticeStepsSummary, PRACTICE_STEP_IDS } from '../practiceStepsSummary';

describe('computePracticeStepsSummary', () => {
  it('returns an empty array when no active step ids match the practice list', () => {
    const result = computePracticeStepsSummary(['lesson-intro', 'report'], [], {});
    expect(result).toEqual([]);
  });

  it('marks a step incomplete when it is active but not in completedSteps', () => {
    const result = computePracticeStepsSummary(['vocab-definition'], [], {});
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ stepId: 'vocab-definition', completed: false, scoreLabel: null });
  });

  it('marks a step completed when present in completedSteps', () => {
    const result = computePracticeStepsSummary(['knowledge-station'], ['knowledge-station'], {});
    expect(result[0]).toMatchObject({ stepId: 'knowledge-station', completed: true, scoreLabel: null, label: '知識補給站' });
  });

  it('extracts a real score label for vocab-definition from step_data.result', () => {
    const stepData = { 'vocab-definition': { completed: true, result: { matchedCount: 7, totalCount: 8 } } };
    const result = computePracticeStepsSummary(['vocab-definition'], ['vocab-definition'], stepData);
    expect(result[0]).toMatchObject({ completed: true, scoreLabel: '答對 7/8 題' });
  });

  it('extracts a real score label for vocab-application from step_data.score/total', () => {
    const stepData = { 'vocab-application': { score: 5, total: 8, completionRate: 0.625 } };
    const result = computePracticeStepsSummary(['vocab-application'], ['vocab-application'], stepData);
    expect(result[0]).toMatchObject({ completed: true, scoreLabel: '答對 5/8 題' });
  });

  it('gracefully falls back to null scoreLabel when step_data is missing or malformed', () => {
    const result = computePracticeStepsSummary(['vocab-definition'], ['vocab-definition'], { 'vocab-definition': {} });
    expect(result[0]).toMatchObject({ completed: true, scoreLabel: null });
  });

  it('only includes steps that are active for this lesson (respects custom step_sequence)', () => {
    // A classical lesson's step_sequence omits vocab-application entirely
    const activeIds = ['full-text-annotate', 'vocab-definition', 'keypoints-table'];
    const result = computePracticeStepsSummary(activeIds, [], {});
    expect(result.map((r) => r.stepId)).toEqual(['full-text-annotate', 'vocab-definition', 'keypoints-table']);
    expect(result.map((r) => r.stepId)).not.toContain('vocab-application');
  });

  it('preserves PRACTICE_STEP_IDS display order regardless of activeStepIds order', () => {
    const activeIds = ['knowledge-station', 'vocab-definition', 'spotlight'];
    const result = computePracticeStepsSummary(activeIds, [], {});
    expect(result.map((r) => r.stepId)).toEqual(['vocab-definition', 'spotlight', 'knowledge-station']);
  });

  it('handles null/undefined completedSteps and stepData without throwing', () => {
    expect(() => computePracticeStepsSummary(PRACTICE_STEP_IDS, null, null)).not.toThrow();
    expect(() => computePracticeStepsSummary(PRACTICE_STEP_IDS, undefined, undefined)).not.toThrow();
  });

  it('covers every id in PRACTICE_STEP_IDS with a non-empty Chinese label', () => {
    const result = computePracticeStepsSummary(PRACTICE_STEP_IDS, [], {});
    expect(result).toHaveLength(PRACTICE_STEP_IDS.length);
    for (const item of result) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });
});

// Code-review finding (#2835 follow-up): 文言文 lessons carry their own
// custom step_sequence that includes classical-sentence-matching /
// classical-word-matching / classical-self-challenge (#2752) — these are
// graded practice steps analogous to vocab-definition, but were originally
// missing from PRACTICE_STEP_IDS, silently reproducing this issue's exact
// bug ("step has zero representation in the report") for a different lesson
// type. classical-text (原文) is a reading passage, not a practice step, and
// stays excluded — same treatment as key-passage-reading.
describe('computePracticeStepsSummary — 文言文 classical steps (#2835 follow-up)', () => {
  it('includes the three classical practice steps when a classical lesson activates them', () => {
    const activeIds = [
      'lesson-intro',
      'classical-text',
      'classical-sentence-matching',
      'classical-word-matching',
      'classical-self-challenge',
      'report',
    ];
    const result = computePracticeStepsSummary(activeIds, [], {});
    expect(result.map((r) => r.stepId)).toEqual([
      'classical-sentence-matching',
      'classical-word-matching',
      'classical-self-challenge',
    ]);
  });

  it('does NOT include classical-text (it is a reading passage, not a practice step)', () => {
    const result = computePracticeStepsSummary(['classical-text'], [], {});
    expect(result).toEqual([]);
  });

  it('marks classical-self-challenge completed with a Chinese label when finished', () => {
    const result = computePracticeStepsSummary(
      ['classical-self-challenge'],
      ['classical-self-challenge'],
      {},
    );
    expect(result[0]).toMatchObject({ completed: true, label: '自我挑戰', scoreLabel: null });
  });
});

// #2833 landed on staging while this PR was in flight and wired real
// answers/gradeResult into keypoints-table's step_data (previously it only
// ever got { completed: true } — see the original "no established numeric
// score concept" comment on keypoints-table, which predates #2833). Now that
// the score exists, surface it — the original issue explicitly listed
// 文章重點表 as one of the steps this report must reflect.
describe('computePracticeStepsSummary — keypoints-table score (post #2833)', () => {
  it('extracts a real score label from step_data.gradeResult.results (correct/total)', () => {
    const stepData = {
      'keypoints-table': {
        answers: { r0: 'x' },
        gradeResult: {
          score: 75,
          results: [
            { row_index: 0, correct: true, feedback: '', correct_answer: 'x' },
            { row_index: 1, correct: true, feedback: '', correct_answer: 'y' },
            { row_index: 2, correct: false, feedback: '', correct_answer: 'z' },
            { row_index: 3, correct: true, feedback: '', correct_answer: 'w' },
          ],
        },
      },
    };
    const result = computePracticeStepsSummary(['keypoints-table'], ['keypoints-table'], stepData);
    expect(result[0]).toMatchObject({ completed: true, scoreLabel: '答對 3/4 題' });
  });

  it('falls back to null scoreLabel when gradeResult is the network-failure sentinel (empty results)', () => {
    const stepData = {
      'keypoints-table': { answers: {}, gradeResult: { score: -1, results: [] } },
    };
    const result = computePracticeStepsSummary(['keypoints-table'], ['keypoints-table'], stepData);
    expect(result[0]).toMatchObject({ completed: true, scoreLabel: null });
  });

  it('falls back to null scoreLabel when the student has not submitted yet (no gradeResult)', () => {
    const stepData = { 'keypoints-table': { answers: { r0: 'x' } } };
    const result = computePracticeStepsSummary(['keypoints-table'], ['keypoints-table'], stepData);
    expect(result[0]).toMatchObject({ completed: true, scoreLabel: null });
  });
});
