/**
 * Characterization tests for VocabDefinitionMatch logic (#1846)
 *
 * TDD-first: these 4 behaviors must pass on current code AND survive refactor.
 *
 * Tests target pure logic extracted into vocabDefinitionMatchLogic.ts.
 * Phase:
 *   1. [RED]   Run → fail (logic file doesn't exist yet)
 *   2. [GREEN] Extract logic → tests pass
 *   3. [TAUTOLOGY] Break one rule → confirm fail, restore
 *   4. [REFACTOR] Split component → same tests still pass
 */
import { describe, it, expect } from 'vitest';
import {
  shuffle,
  getDragDropAttemptFeedback,
  getDragDropAttemptTone,
  buildMCQOptions,
  selectRetryIndices,
  mergePersistedProgress,
} from '../vocabDefinitionMatchLogic';
import type { PersistedProgress, AnswerRecord } from '../vocabDefinitionMatchLogic';

/* ------------------------------------------------------------------ */
/*  Fixtures                                                            */
/* ------------------------------------------------------------------ */

const VOCAB_5 = [
  { word: '勤奮', definition: '努力不懈地工作或學習。' },
  { word: '謙虛', definition: '不自誇，虛心接受他人意見。' },
  { word: '堅持', definition: '不放棄，繼續努力下去。' },
  { word: '創新', definition: '提出新的想法或做法。' },
  { word: '合作', definition: '一起努力達成共同目標。' },
];

const VOCAB_2 = [
  { word: '春', definition: '一年四季中最溫暖的季節。' },
  { word: '夏', definition: '一年中最熱的季節。' },
];

const VOCAB_1 = [
  { word: '龍', definition: '中國傳說中的神獸。' },
];

/* ------------------------------------------------------------------ */
/*  1. shuffle — array permutation utility                              */
/* ------------------------------------------------------------------ */

describe('shuffle', () => {
  it('returns same length array', () => {
    const arr = [0, 1, 2, 3, 4];
    expect(shuffle(arr)).toHaveLength(arr.length);
  });

  it('contains all original elements', () => {
    const arr = [0, 1, 2, 3, 4];
    const result = shuffle(arr);
    expect(result.sort()).toEqual([...arr].sort());
  });

  it('does not mutate the input array', () => {
    const arr = [0, 1, 2, 3];
    const original = [...arr];
    shuffle(arr);
    expect(arr).toEqual(original);
  });
});

/* ------------------------------------------------------------------ */
/*  2. getDragDropAttemptFeedback — wrong attempt feedback text         */
/* ------------------------------------------------------------------ */

describe('getDragDropAttemptFeedback', () => {
  it('returns null for 1 wrong attempt (first try, no feedback yet)', () => {
    expect(getDragDropAttemptFeedback(1)).toBeNull();
  });

  it('returns encouraging message for 2 wrong attempts', () => {
    const feedback = getDragDropAttemptFeedback(2);
    expect(feedback).toBeTruthy();
    expect(typeof feedback).toBe('string');
  });

  it('returns stronger message for 3+ wrong attempts', () => {
    const feedback3 = getDragDropAttemptFeedback(3);
    const feedback5 = getDragDropAttemptFeedback(5);
    expect(feedback3).toBeTruthy();
    expect(feedback5).toBeTruthy();
    // 3+ uses review suggestion language
    expect(feedback3).toContain('複習');
  });

  it('returns null for 0 wrong attempts', () => {
    expect(getDragDropAttemptFeedback(0)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  3. getDragDropAttemptTone — card/badge color classes                */
/* ------------------------------------------------------------------ */

describe('getDragDropAttemptTone', () => {
  it('returns emerald (success) classes for 0 wrong attempts', () => {
    const tone = getDragDropAttemptTone(0);
    expect(tone.cardClass).toContain('emerald');
    expect(tone.badgeClass).toContain('emerald');
  });

  it('returns amber (warning) classes for 2 wrong attempts', () => {
    const tone = getDragDropAttemptTone(2);
    expect(tone.cardClass).toContain('amber');
    expect(tone.badgeClass).toContain('amber');
  });

  it('returns red (danger) classes for 3+ wrong attempts', () => {
    const tone3 = getDragDropAttemptTone(3);
    expect(tone3.cardClass).toContain('red');
    expect(tone3.badgeClass).toContain('red');

    const tone10 = getDragDropAttemptTone(10);
    expect(tone10.cardClass).toContain('red');
  });

  it('returns two shape-consistent objects: cardClass + badgeClass', () => {
    const tone = getDragDropAttemptTone(1);
    expect(tone).toHaveProperty('cardClass');
    expect(tone).toHaveProperty('badgeClass');
    expect(typeof tone.cardClass).toBe('string');
    expect(typeof tone.badgeClass).toBe('string');
  });
});

/* ------------------------------------------------------------------ */
/*  4. buildMCQOptions — multiple-choice never single forced-correct    */
/* ------------------------------------------------------------------ */

describe('buildMCQOptions (MCQ distractor rule)', () => {
  it('includes the correct answer in options', () => {
    const options = buildMCQOptions(VOCAB_5, 2);
    expect(options).toContain(2);
  });

  it('produces at least 2 options even with vocab size 2 (no forced-correct)', () => {
    // vocab size 2 means 1 correct + at most 1 distractor → must be 2, never 1
    const options = buildMCQOptions(VOCAB_2, 0);
    expect(options.length).toBeGreaterThanOrEqual(2);
  });

  it('with vocab size 1, still includes the correct answer', () => {
    const options = buildMCQOptions(VOCAB_1, 0);
    expect(options).toContain(0);
    // No distractors available but correct is there
    expect(options.length).toBeGreaterThanOrEqual(1);
  });

  it('produces at most 4 options with large vocab', () => {
    const options = buildMCQOptions(VOCAB_5, 0);
    expect(options.length).toBeLessThanOrEqual(4);
  });

  it('never contains duplicate indices', () => {
    for (let currentDefIdx = 0; currentDefIdx < VOCAB_5.length; currentDefIdx++) {
      const options = buildMCQOptions(VOCAB_5, currentDefIdx);
      const unique = new Set(options);
      expect(unique.size).toBe(options.length);
    }
  });

  it('uses ALL vocab as distractor candidates (including already-answered words)', () => {
    // Simulate "last question" scenario: currentDefIdx=4 (last), all others used
    // Fix #1101: distractors come from ALL vocab, not just unused ones
    const options = buildMCQOptions(VOCAB_5, 4);
    expect(options.length).toBeGreaterThanOrEqual(2); // Must have ≥2 options, never forced-correct
  });
});

/* ------------------------------------------------------------------ */
/*  5. selectRetryIndices — retry wrong only returns only failed items  */
/* ------------------------------------------------------------------ */

describe('selectRetryIndices (retry semantics)', () => {
  const answers: AnswerRecord[] = [
    { defIndex: 0, answeredWordIdx: 0, correct: true },
    { defIndex: 1, answeredWordIdx: 3, correct: false },
    { defIndex: 2, answeredWordIdx: 2, correct: true },
    { defIndex: 3, answeredWordIdx: 1, correct: false },
    { defIndex: 4, answeredWordIdx: 4, correct: true },
  ];

  it('returns only indices of wrong answers', () => {
    const wrongIndices = selectRetryIndices(answers);
    expect(wrongIndices).toEqual(expect.arrayContaining([1, 3]));
    expect(wrongIndices).not.toContain(0);
    expect(wrongIndices).not.toContain(2);
    expect(wrongIndices).not.toContain(4);
    expect(wrongIndices).toHaveLength(2);
  });

  it('returns empty array when all answers are correct', () => {
    const allCorrect: AnswerRecord[] = [
      { defIndex: 0, answeredWordIdx: 0, correct: true },
      { defIndex: 1, answeredWordIdx: 1, correct: true },
    ];
    expect(selectRetryIndices(allCorrect)).toHaveLength(0);
  });

  it('returns all indices when all answers are wrong', () => {
    const allWrong: AnswerRecord[] = [
      { defIndex: 0, answeredWordIdx: 1, correct: false },
      { defIndex: 1, answeredWordIdx: 0, correct: false },
    ];
    const result = selectRetryIndices(allWrong);
    expect(result).toEqual(expect.arrayContaining([0, 1]));
    expect(result).toHaveLength(2);
  });

  // #2773: selectRetryIndices must key off firstTryCorrect (immutable), not
  // correct (which gets overwritten to true once the student eventually gets
  // a retried item right — see VocabDefinitionMatchMCQ.tsx's own comment
  // "on retry, overwrite with the latest attempt"). Before this fix, an item
  // the student got wrong on the first try but right on a retry would show
  // correct: true and silently disappear from every "錯題" accounting —
  // exactly the gap Young's #2773 ask exposed live on staging.
  it('selects an item whose first try was wrong even though correct is now true (post-retry state)', () => {
    const postRetry: AnswerRecord[] = [
      { defIndex: 0, answeredWordIdx: 0, correct: true, firstTryCorrect: true },
      // Got it wrong first, then retried into a correct pick — correct is now
      // true, but firstTryCorrect must still say false.
      { defIndex: 1, answeredWordIdx: 1, correct: true, firstTryCorrect: false },
    ];
    expect(selectRetryIndices(postRetry)).toEqual([1]);
  });

  it('does NOT select an item that was correct on the first try, even if correct is later re-set', () => {
    const answers: AnswerRecord[] = [
      { defIndex: 0, answeredWordIdx: 0, correct: true, firstTryCorrect: true },
    ];
    expect(selectRetryIndices(answers)).toEqual([]);
  });

  it('falls back to correct when firstTryCorrect is absent (old/persisted records without the field)', () => {
    const legacyAnswers: AnswerRecord[] = [
      { defIndex: 0, answeredWordIdx: 0, correct: false },
    ];
    expect(selectRetryIndices(legacyAnswers)).toEqual([0]);
  });
});

/* ------------------------------------------------------------------ */
/*  6. mergePersistedProgress — restores persisted progress on remount  */
/* ------------------------------------------------------------------ */

describe('mergePersistedProgress (progress persistence)', () => {
  const baseLocalStorage: PersistedProgress = {
    mode: 'drag-drop',
    phase: 'matching',
    activeDefIndices: [1, 3],
    mcAnswers: [
      { defIndex: 0, answeredWordIdx: 0, correct: true },
      { defIndex: 1, answeredWordIdx: 3, correct: false },
    ],
    dragDropAnswers: [],
  };

  it('restores mode from localStorage when no initialProgress provided', () => {
    const merged = mergePersistedProgress({}, baseLocalStorage);
    expect(merged.mode).toBe('drag-drop');
  });

  it('restores phase from localStorage', () => {
    const merged = mergePersistedProgress({}, baseLocalStorage);
    expect(merged.phase).toBe('matching');
  });

  it('restores activeDefIndices from localStorage', () => {
    const merged = mergePersistedProgress({}, baseLocalStorage);
    expect(merged.activeDefIndices).toEqual([1, 3]);
  });

  it('restores mcAnswers from localStorage', () => {
    const merged = mergePersistedProgress({}, baseLocalStorage);
    expect(merged.mcAnswers).toHaveLength(2);
    expect(merged.mcAnswers![0].correct).toBe(true);
    expect(merged.mcAnswers![1].correct).toBe(false);
  });

  it('initialProgress overrides localStorage when both present', () => {
    const initialProgress: PersistedProgress = {
      mode: 'multiple-choice',
      phase: 'summary',
    };
    const merged = mergePersistedProgress(initialProgress, baseLocalStorage);
    expect(merged.mode).toBe('multiple-choice'); // initialProgress wins
    expect(merged.phase).toBe('summary'); // initialProgress wins
    expect(merged.activeDefIndices).toEqual([1, 3]); // falls back to localStorage
  });

  it('returns safe defaults when both sources empty', () => {
    const merged = mergePersistedProgress({}, {});
    expect(merged.mode).toBeUndefined();
    expect(merged.phase).toBeUndefined();
    expect(merged.activeDefIndices).toBeUndefined();
    expect(merged.mcAnswers).toBeUndefined();
    expect(merged.dragDropAnswers).toBeUndefined();
  });
});
