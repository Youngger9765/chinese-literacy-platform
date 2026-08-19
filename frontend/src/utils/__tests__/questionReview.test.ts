/**
 * questionReview.test.ts — TDD lock for the shared first-try/wrong-review logic
 * used to extend "重做錯題 / 錯題解析" (issue #2773) to 閱讀理解.
 *
 * Fixtures come from real data: field values below (「勢均力敵」/「摸不著頭緒」etc.)
 * are copied from `curl https://lingoleap-backend-staging-.../api/stories/20011`
 * (multiple_choice[0] and fill_in_blank[0]), not invented shapes.
 */
import { describe, it, expect } from 'vitest';
import {
  recordFirstTry,
  wrongFirstTryIds,
  firstTryScore,
  isFirstTryComplete,
  type FirstTryRecord,
} from '../questionReview';

describe('recordFirstTry', () => {
  it('appends a new record for an id not seen before', () => {
    const prev: FirstTryRecord<number, string>[] = [];
    const next = recordFirstTry(prev, {
      id: 0,
      firstTryCorrect: true,
      studentFirstAnswer: null,
      correctAnswer: 'C',
    });
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe(0);
  });

  it('does NOT overwrite an existing record for the same id (retry must not erase first-try verdict)', () => {
    const prev: FirstTryRecord<number, string>[] = [
      { id: 0, firstTryCorrect: false, studentFirstAnswer: 'A', correctAnswer: 'C' },
    ];
    // Student retries question 0 and gets it right this time — the ORIGINAL
    // wrong first-try record must survive untouched, otherwise "重做錯題"
    // would silently shrink every time a question is replayed.
    const next = recordFirstTry(prev, {
      id: 0,
      firstTryCorrect: true,
      studentFirstAnswer: 'C',
      correctAnswer: 'C',
    });
    expect(next).toHaveLength(1);
    expect(next[0].firstTryCorrect).toBe(false);
    expect(next[0].studentFirstAnswer).toBe('A');
  });

  it('preserves prior records when appending a different id', () => {
    const prev: FirstTryRecord<number, string>[] = [
      { id: 0, firstTryCorrect: true, studentFirstAnswer: null, correctAnswer: 'C' },
    ];
    const next = recordFirstTry(prev, {
      id: 1,
      firstTryCorrect: false,
      studentFirstAnswer: 'B',
      correctAnswer: 'I',
    });
    expect(next).toHaveLength(2);
    expect(next.map((r) => r.id)).toEqual([0, 1]);
  });
});

describe('wrongFirstTryIds', () => {
  it('returns only the ids answered wrong on the first try, in recorded order', () => {
    // Real fixture: story 20011 multiple_choice[0] answer='C' (「不分上下」), and one of
    // the fill_in_blank sentences whose correct answer is 'I' (「摸不著頭緒」).
    const records: FirstTryRecord<number, string>[] = [
      { id: 0, firstTryCorrect: true, studentFirstAnswer: null, correctAnswer: 'C' },
      { id: 1, firstTryCorrect: false, studentFirstAnswer: 'B', correctAnswer: 'I' },
      { id: 2, firstTryCorrect: false, studentFirstAnswer: 'F', correctAnswer: 'D' },
      { id: 3, firstTryCorrect: true, studentFirstAnswer: null, correctAnswer: 'F' },
    ];
    expect(wrongFirstTryIds(records)).toEqual([1, 2]);
  });

  it('returns an empty array when everything was correct on the first try', () => {
    const records: FirstTryRecord<number, string>[] = [
      { id: 0, firstTryCorrect: true, studentFirstAnswer: null, correctAnswer: 'C' },
    ];
    expect(wrongFirstTryIds(records)).toEqual([]);
  });
});

describe('firstTryScore', () => {
  it('counts correct vs total independently of retry attempts', () => {
    const records: FirstTryRecord<number, string>[] = [
      { id: 0, firstTryCorrect: true, studentFirstAnswer: null, correctAnswer: 'C' },
      { id: 1, firstTryCorrect: false, studentFirstAnswer: 'B', correctAnswer: 'I' },
      { id: 2, firstTryCorrect: true, studentFirstAnswer: null, correctAnswer: 'D' },
    ];
    expect(firstTryScore(records)).toEqual({ correct: 2, total: 3 });
  });

  it('returns 0/0 for an empty record set', () => {
    expect(firstTryScore([])).toEqual({ correct: 0, total: 0 });
  });
});

describe('isFirstTryComplete', () => {
  it('is false until every question id in the set has a record', () => {
    const records: FirstTryRecord<number, string>[] = [
      { id: 0, firstTryCorrect: true, studentFirstAnswer: null, correctAnswer: 'C' },
    ];
    expect(isFirstTryComplete(records, [0, 1, 2])).toBe(false);
  });

  it('is true once all ids have a record, regardless of order', () => {
    const records: FirstTryRecord<number, string>[] = [
      { id: 2, firstTryCorrect: false, studentFirstAnswer: 'A', correctAnswer: 'D' },
      { id: 0, firstTryCorrect: true, studentFirstAnswer: null, correctAnswer: 'C' },
      { id: 1, firstTryCorrect: true, studentFirstAnswer: null, correctAnswer: 'I' },
    ];
    expect(isFirstTryComplete(records, [0, 1, 2])).toBe(true);
  });

  it('is false for an empty question-id set (nothing to be "complete")', () => {
    expect(isFirstTryComplete([], [])).toBe(false);
  });
});
