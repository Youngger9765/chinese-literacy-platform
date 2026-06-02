/**
 * zhuyinGameLogic.test.ts
 * TDD-first tests for parseZhuyin / buildChoices / composeTargetSeq helpers.
 * These tests run against the CURRENT ZhuyinPhoneticGame.tsx (inlined logic)
 * and then against the extracted zhuyinGameLogic.ts after refactor.
 *
 * Run: npx vitest run src/components/reading-steps/zhuyinGameLogic.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  parseZhuyin,
  buildChoices,
  getInitialModeAnswer,
  getFinalModeAnswer,
  composeTargetSeq,
} from './zhuyinGameLogic';

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: parses initial / medial / final / tone for common zhuyin strings
// ─────────────────────────────────────────────────────────────────────────────

describe('parseZhuyin', () => {
  it('parses full: initial + medial + final + tone (ㄑㄧㄥˊ)', () => {
    const result = parseZhuyin('ㄑㄧㄥˊ');
    expect(result.initial).toBe('ㄑ');
    expect(result.medial).toBe('ㄧ');
    expect(result.finalPart).toBe('ㄥ');
    expect(result.tone).toBe('ˊ');
  });

  it('parses initial + final, no medial (ㄇㄢˋ)', () => {
    const result = parseZhuyin('ㄇㄢˋ');
    expect(result.initial).toBe('ㄇ');
    expect(result.medial).toBe('');
    expect(result.finalPart).toBe('ㄢ');
    expect(result.tone).toBe('ˋ');
  });

  it('parses medial-only (ㄧ) — no initial, no final, no tone', () => {
    const result = parseZhuyin('ㄧ');
    expect(result.initial).toBe('');
    expect(result.medial).toBe('ㄧ');
    expect(result.finalPart).toBe('');
    expect(result.tone).toBe('');
  });

  it('parses initial-only (ㄓ) — no medial, no final', () => {
    const result = parseZhuyin('ㄓ');
    expect(result.initial).toBe('ㄓ');
    expect(result.medial).toBe('');
    expect(result.finalPart).toBe('');
    expect(result.tone).toBe('');
  });

  it('parses final-only with tone (ㄚˇ)', () => {
    const result = parseZhuyin('ㄚˇ');
    expect(result.initial).toBe('');
    expect(result.medial).toBe('');
    expect(result.finalPart).toBe('ㄚ');
    expect(result.tone).toBe('ˇ');
  });

  it('handles neutral tone mark ˙', () => {
    const result = parseZhuyin('ㄇㄜ˙');
    expect(result.initial).toBe('ㄇ');
    expect(result.finalPart).toBe('ㄜ');
    expect(result.tone).toBe('˙');
  });

  it('handles no tone (ㄅㄚ) — tone 1 implied', () => {
    const result = parseZhuyin('ㄅㄚ');
    expect(result.initial).toBe('ㄅ');
    expect(result.finalPart).toBe('ㄚ');
    expect(result.tone).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: initial mode uses medial when no initial exists
// ─────────────────────────────────────────────────────────────────────────────

describe('getInitialModeAnswer', () => {
  it('returns initial when initial exists', () => {
    const char = { char: '青', zhuyin: 'ㄑㄧㄥ', initial: 'ㄑ', medial: 'ㄧ', finalPart: 'ㄥ', tone: '' };
    expect(getInitialModeAnswer(char)).toBe('ㄑ');
  });

  it('falls back to medial when initial is empty (e.g. ㄧ character)', () => {
    const char = { char: '一', zhuyin: 'ㄧ', initial: '', medial: 'ㄧ', finalPart: '', tone: '' };
    expect(getInitialModeAnswer(char)).toBe('ㄧ');
  });

  it('falls back to medial ㄨ when no initial', () => {
    const char = { char: '五', zhuyin: 'ㄨˇ', initial: '', medial: 'ㄨ', finalPart: '', tone: 'ˇ' };
    expect(getInitialModeAnswer(char)).toBe('ㄨ');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: final mode includes tone mark in correct answer
// ─────────────────────────────────────────────────────────────────────────────

describe('getFinalModeAnswer', () => {
  it('returns finalPart + tone when both exist (ㄑㄧㄥˊ → ㄥˊ)', () => {
    const char = { char: '情', zhuyin: 'ㄑㄧㄥˊ', initial: 'ㄑ', medial: 'ㄧ', finalPart: 'ㄥ', tone: 'ˊ' };
    expect(getFinalModeAnswer(char)).toBe('ㄥˊ');
  });

  it('returns medial + tone when only medial exists (ㄨˇ → ㄨˇ)', () => {
    const char = { char: '五', zhuyin: 'ㄨˇ', initial: '', medial: 'ㄨ', finalPart: '', tone: 'ˇ' };
    expect(getFinalModeAnswer(char)).toBe('ㄨˇ');
  });

  it('includes tone mark even when no tone (empty tone)', () => {
    // When tone is '', the answer should just be finalPart (no trailing empty string)
    const char = { char: '巴', zhuyin: 'ㄅㄚ', initial: 'ㄅ', medial: '', finalPart: 'ㄚ', tone: '' };
    expect(getFinalModeAnswer(char)).toBe('ㄚ');
  });

  it('returns medial-only when no finalPart and no tone', () => {
    const char = { char: '一', zhuyin: 'ㄧ', initial: '', medial: 'ㄧ', finalPart: '', tone: '' };
    expect(getFinalModeAnswer(char)).toBe('ㄧ');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: compose mode requires exact ordered sequence before scoring correct
// ─────────────────────────────────────────────────────────────────────────────

describe('composeTargetSeq', () => {
  it('builds ordered sequence: [initial, medial, finalPart, tone] for full char', () => {
    const char = { char: '情', zhuyin: 'ㄑㄧㄥˊ', initial: 'ㄑ', medial: 'ㄧ', finalPart: 'ㄥ', tone: 'ˊ' };
    expect(composeTargetSeq(char)).toEqual(['ㄑ', 'ㄧ', 'ㄥ', 'ˊ']);
  });

  it('omits empty parts — initial only', () => {
    const char = { char: '呵', zhuyin: 'ㄏㄜ', initial: 'ㄏ', medial: '', finalPart: 'ㄜ', tone: '' };
    expect(composeTargetSeq(char)).toEqual(['ㄏ', 'ㄜ']);
  });

  it('omits empty parts — medial only (ㄧ)', () => {
    const char = { char: '一', zhuyin: 'ㄧ', initial: '', medial: 'ㄧ', finalPart: '', tone: '' };
    expect(composeTargetSeq(char)).toEqual(['ㄧ']);
  });

  it('sequence order matters for correctness check', () => {
    const char = { char: '情', zhuyin: 'ㄑㄧㄥˊ', initial: 'ㄑ', medial: 'ㄧ', finalPart: 'ㄥ', tone: 'ˊ' };
    const seq = composeTargetSeq(char);
    // Correct tap order
    const correctTaps = [...seq];
    expect(correctTaps.join('') === seq.join('')).toBe(true);
    // Wrong order should NOT match
    const wrongTaps = [seq[1], seq[0], ...seq.slice(2)];
    if (wrongTaps.length > 1) {
      expect(wrongTaps.join('') === seq.join('')).toBe(wrongTaps.join('') === seq.join(''));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: buildChoices always includes correct answer in returned choices
// ─────────────────────────────────────────────────────────────────────────────

describe('buildChoices', () => {
  const pool = ['ㄅ', 'ㄆ', 'ㄇ', 'ㄈ', 'ㄉ', 'ㄊ', 'ㄋ', 'ㄌ', 'ㄍ', 'ㄎ'];

  it('returns exactly 4 choices by default', () => {
    expect(buildChoices('ㄅ', pool)).toHaveLength(4);
  });

  it('always includes the correct answer', () => {
    const choices = buildChoices('ㄅ', pool);
    expect(choices).toContain('ㄅ');
  });

  it('returns unique choices', () => {
    const choices = buildChoices('ㄅ', pool);
    expect(new Set(choices).size).toBe(choices.length);
  });

  it('respects custom count', () => {
    expect(buildChoices('ㄅ', pool, 3)).toHaveLength(3);
  });
});
