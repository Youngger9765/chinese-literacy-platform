/**
 * TDD tests for SentencePractice refactor — Issue #1883
 *
 * Tests target the extracted hook/utilities:
 *   useSentencePracticeState (state transitions + persistence)
 *
 * All three tests encode behaviors that exist in the monolith and
 * must continue working after the split.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  filterRestoredWords,
  shouldBlockEnterOnIme,
  isAllWordsDone,
} from '../useSentencePracticeState';

/* ------------------------------------------------------------------ */
/*  1. restores_only_words_present_in_current_practice_list            */
/*     Stale words from localStorage that are no longer in the         */
/*     current practicedWords list must be silently ignored.           */
/* ------------------------------------------------------------------ */
describe('filterRestoredWords', () => {
  it('restores_only_words_present_in_current_practice_list', () => {
    const currentWords = ['蘋果', '香蕉'];
    const savedCompletedWords = ['蘋果', '西瓜', '芒果']; // 西瓜 + 芒果 are stale

    const result = filterRestoredWords(savedCompletedWords, currentWords);

    expect(result).toContain('蘋果');
    expect(result).not.toContain('西瓜');
    expect(result).not.toContain('芒果');
    expect(result.length).toBe(1);
  });

  it('returns empty set when no saved words match current list', () => {
    const currentWords = ['蘋果', '香蕉'];
    const savedCompletedWords = ['西瓜', '芒果'];

    const result = filterRestoredWords(savedCompletedWords, currentWords);

    expect(result.length).toBe(0);
  });

  it('restores all words when every saved word is in current list', () => {
    const currentWords = ['蘋果', '香蕉', '橘子'];
    const savedCompletedWords = ['蘋果', '橘子'];

    const result = filterRestoredWords(savedCompletedWords, currentWords);

    expect(result).toContain('蘋果');
    expect(result).toContain('橘子');
    expect(result).not.toContain('香蕉');
    expect(result.length).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  2. enter_during_ime_composition_does_not_validate                  */
/*     When 注音 IME composition is in progress, pressing Enter        */
/*     must not trigger sentence validation.                           */
/* ------------------------------------------------------------------ */
describe('shouldBlockEnterOnIme', () => {
  it('enter_during_ime_composition_does_not_validate — isComposing=true blocks Enter', () => {
    const blocked = shouldBlockEnterOnIme({ isComposing: true, keyCode: 13 });
    expect(blocked).toBe(true);
  });

  it('enter_during_ime_composition_does_not_validate — keyCode 229 blocks Enter', () => {
    // keyCode 229 is the IME sentinel value in some browsers
    const blocked = shouldBlockEnterOnIme({ isComposing: false, keyCode: 229 });
    expect(blocked).toBe(true);
  });

  it('enter_during_ime_composition_does_not_validate — composingRef=true blocks Enter', () => {
    const blocked = shouldBlockEnterOnIme({ isComposing: false, keyCode: 13, composingRef: true });
    expect(blocked).toBe(true);
  });

  it('allows Enter when no IME composition is active', () => {
    const blocked = shouldBlockEnterOnIme({ isComposing: false, keyCode: 13, composingRef: false });
    expect(blocked).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  3. marks_step_completed_only_when_all_words_done                   */
/*     markCompleted should only fire when every word in              */
/*     practicedWords appears in completedWords.                       */
/* ------------------------------------------------------------------ */
describe('isAllWordsDone', () => {
  it('marks_step_completed_only_when_all_words_done — returns true when all words complete', () => {
    const practicedWords = ['蘋果', '香蕉', '橘子'];
    const completedWords = new Set(['蘋果', '香蕉', '橘子']);

    expect(isAllWordsDone(practicedWords, completedWords)).toBe(true);
  });

  it('returns false when some words are still incomplete', () => {
    const practicedWords = ['蘋果', '香蕉', '橘子'];
    const completedWords = new Set(['蘋果', '香蕉']); // 橘子 not done

    expect(isAllWordsDone(practicedWords, completedWords)).toBe(false);
  });

  it('returns false when completedWords is empty', () => {
    const practicedWords = ['蘋果', '香蕉'];
    const completedWords = new Set<string>();

    expect(isAllWordsDone(practicedWords, completedWords)).toBe(false);
  });

  it('returns false when practicedWords is empty (edge: nothing to complete)', () => {
    const practicedWords: string[] = [];
    const completedWords = new Set<string>();

    // Empty practice list → considered not done (guard against accidental trigger)
    expect(isAllWordsDone(practicedWords, completedWords)).toBe(false);
  });

  it('marks_step_completed_only_when_all_words_done — extra completed words do not affect result', () => {
    // If a stale word somehow sneaked in, it doesn't matter as long as all current words are done
    const practicedWords = ['蘋果', '香蕉'];
    const completedWords = new Set(['蘋果', '香蕉', '西瓜']); // 西瓜 is extra/stale

    expect(isAllWordsDone(practicedWords, completedWords)).toBe(true);
  });
});
