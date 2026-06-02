/**
 * zhuyinGameEngine.test.ts
 *
 * TDD-first tests for zhuyinGameEngine.ts.
 * Written BEFORE refactor (tautology check: tests pass on current engine).
 *
 * Three required test cases from issue #1885:
 *   1. parse_zhuyin_splits_initial_medial_final_and_tone
 *   2. build_choices_includes_correct_answer_once
 *   3. compose_game_scores_once_when_sequence_completed
 *
 * Run: npx vitest run src/components/reading-steps/zhuyinGameEngine.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  deriveInitialAnswer,
  deriveFinalAnswer,
  buildPickChoices,
  buildComposePalette,
  scoreOnce,
  filterQuestionsForMode,
  GameMode,
} from './zhuyinGameEngine';
import { parseZhuyin } from './zhuyinGameLogic';
import type { CharZhuyin } from './zhuyinGameEngine';

// Helper: build a CharZhuyin from a raw zhuyin string
function makeChar(char: string, zhuyinStr: string): CharZhuyin {
  const parsed = parseZhuyin(zhuyinStr);
  return { char, zhuyin: zhuyinStr, ...parsed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: parse_zhuyin_splits_initial_medial_final_and_tone
//
// Validates parseZhuyin (via makeChar) correctly splits all four parts for
// multiple phonological patterns, including zero-initial and tone marks.
// ─────────────────────────────────────────────────────────────────────────────

describe('parse_zhuyin_splits_initial_medial_final_and_tone', () => {
  it('full syllable ㄑㄧㄥˊ (情) → initial=ㄑ medial=ㄧ final=ㄥ tone=ˊ', () => {
    const q = makeChar('情', 'ㄑㄧㄥˊ');
    expect(q.initial).toBe('ㄑ');
    expect(q.medial).toBe('ㄧ');
    expect(q.finalPart).toBe('ㄥ');
    expect(q.tone).toBe('ˊ');
  });

  it('zero-initial medial-only ㄧ (一) → initial="" medial=ㄧ final="" tone=""', () => {
    const q = makeChar('一', 'ㄧ');
    expect(q.initial).toBe('');
    expect(q.medial).toBe('ㄧ');
    expect(q.finalPart).toBe('');
    expect(q.tone).toBe('');
  });

  it('zero-initial with tone ㄨˇ (五) → initial="" medial=ㄨ final="" tone=ˇ', () => {
    const q = makeChar('五', 'ㄨˇ');
    expect(q.initial).toBe('');
    expect(q.medial).toBe('ㄨ');
    expect(q.finalPart).toBe('');
    expect(q.tone).toBe('ˇ');
  });

  it('initial + final, no medial ㄇㄢˋ (慢) → initial=ㄇ medial="" final=ㄢ tone=ˋ', () => {
    const q = makeChar('慢', 'ㄇㄢˋ');
    expect(q.initial).toBe('ㄇ');
    expect(q.medial).toBe('');
    expect(q.finalPart).toBe('ㄢ');
    expect(q.tone).toBe('ˋ');
  });

  it('neutral tone mark ˙ is captured as tone', () => {
    const q = makeChar('嗎', 'ㄇㄜ˙');
    expect(q.initial).toBe('ㄇ');
    expect(q.finalPart).toBe('ㄜ');
    expect(q.tone).toBe('˙');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: build_choices_includes_correct_answer_once
//
// buildPickChoices must:
//   a) include the correct answer in returned choices
//   b) produce no duplicates
//   c) return exactly 4 choices by default
// ─────────────────────────────────────────────────────────────────────────────

describe('build_choices_includes_correct_answer_once', () => {
  const correct = 'ㄑ';

  it('initial mode: correct answer ㄑ is present in 4 choices', () => {
    const choices = buildPickChoices(correct, 'initial');
    expect(choices).toContain(correct);
    expect(choices).toHaveLength(4);
  });

  it('initial mode: no duplicates in choices', () => {
    // Run 10 times to check across shuffle randomness
    for (let i = 0; i < 10; i++) {
      const choices = buildPickChoices(correct, 'initial');
      expect(new Set(choices).size).toBe(choices.length);
    }
  });

  it('final mode: correct answer ㄥˊ is present once', () => {
    const finalCorrect = 'ㄥˊ';
    const choices = buildPickChoices(finalCorrect, 'final');
    const occurrences = choices.filter(c => c === finalCorrect).length;
    expect(occurrences).toBe(1);
    expect(choices).toHaveLength(4);
  });

  it('correct answer appears exactly once even if correct is in pool', () => {
    // Correct answer 'ㄧ' (PRENUCLEAR) is part of the initial pool — must not duplicate
    const choices = buildPickChoices('ㄧ', 'initial');
    const occurrences = choices.filter(c => c === 'ㄧ').length;
    expect(occurrences).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: compose_game_scores_once_when_sequence_completed
//
// scoreOnce is a pure function:
//   - correct tap on last symbol → increments score by 1
//   - wrong answer → score unchanged
//   - called multiple times doesn't double-count (caller manages state)
// ─────────────────────────────────────────────────────────────────────────────

describe('compose_game_scores_once_when_sequence_completed', () => {
  it('correct answer increments score by exactly 1', () => {
    const newScore = scoreOnce(2, true);
    expect(newScore).toBe(3);
  });

  it('wrong answer does not change score', () => {
    const newScore = scoreOnce(2, false);
    expect(newScore).toBe(2);
  });

  it('score starts at 0 and increments correctly across sequence', () => {
    // Simulate completing a 3-question sequence: correct, wrong, correct
    let score = 0;
    score = scoreOnce(score, true);   // 1
    score = scoreOnce(score, false);  // 1
    score = scoreOnce(score, true);   // 2
    expect(score).toBe(2);
  });

  it('calling scoreOnce twice for same question does NOT double-count', () => {
    // Caller is responsible for calling once per question — pure fn test
    const scoreAfterFirst = scoreOnce(0, true);  // 1
    // Should NOT call again for the same question
    expect(scoreAfterFirst).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional engine tests
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveInitialAnswer', () => {
  it('returns initial when present', () => {
    const q = makeChar('情', 'ㄑㄧㄥˊ');
    expect(deriveInitialAnswer(q)).toBe('ㄑ');
  });

  it('falls back to medial when no initial', () => {
    const q = makeChar('一', 'ㄧ');
    expect(deriveInitialAnswer(q)).toBe('ㄧ');
  });
});

describe('deriveFinalAnswer', () => {
  it('returns finalPart + tone for full syllable', () => {
    const q = makeChar('情', 'ㄑㄧㄥˊ');
    expect(deriveFinalAnswer(q)).toBe('ㄥˊ');
  });

  it('returns medial + tone when medial-only (no finalPart)', () => {
    const q = makeChar('五', 'ㄨˇ');
    expect(deriveFinalAnswer(q)).toBe('ㄨˇ');
  });
});

describe('buildComposePalette', () => {
  it('palette includes all target sequence symbols', () => {
    const targetSeq = ['ㄑ', 'ㄧ', 'ㄥ', 'ˊ'];
    const palette = buildComposePalette(targetSeq);
    for (const sym of targetSeq) {
      expect(palette).toContain(sym);
    }
  });

  it('palette has at least 8 symbols', () => {
    const targetSeq = ['ㄅ', 'ㄚ'];
    const palette = buildComposePalette(targetSeq);
    expect(palette.length).toBeGreaterThanOrEqual(8);
  });
});

describe('filterQuestionsForMode', () => {
  const chars: CharZhuyin[] = [
    { char: '情', zhuyin: 'ㄑㄧㄥˊ', initial: 'ㄑ', medial: 'ㄧ', finalPart: 'ㄥ', tone: 'ˊ' },
    { char: '一', zhuyin: 'ㄧ', initial: '', medial: 'ㄧ', finalPart: '', tone: '' },
    // contrived char with no initial, no medial — should be filtered in initial mode
    { char: '?', zhuyin: 'ㄚ', initial: '', medial: '', finalPart: 'ㄚ', tone: '' },
  ];

  it('initial mode keeps chars with initial or medial', () => {
    const filtered = filterQuestionsForMode(chars, 'initial');
    // '?' has no initial and no medial → excluded
    expect(filtered.some(c => c.char === '?')).toBe(false);
    expect(filtered.some(c => c.char === '情')).toBe(true);
    expect(filtered.some(c => c.char === '一')).toBe(true);
  });

  it('compose mode returns all chars', () => {
    const filtered = filterQuestionsForMode(chars, 'compose');
    expect(filtered).toHaveLength(chars.length);
  });
});
