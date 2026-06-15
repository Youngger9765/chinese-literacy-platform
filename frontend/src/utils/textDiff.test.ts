/**
 * Tests for textDiff utilities: normalizeForComparison, diffCharacters.
 *
 * Covers Issue #638: 破音字 STT matching — 兩/二 number normalization + 一 tone sandhi.
 *
 * Key scenarios:
 * 1. Arabic → Chinese number conversion (100 → 一百, 214 → 二百一十四)
 * 2. 兩/二 spoken variant normalization (兩百 ≡ 二百 in STT matching)
 * 3. Homophone-tolerant diff accuracy (同音異字 treated as correct)
 */

import { describe, it, expect } from 'vitest';
import { normalizeForComparison, diffCharacters, interleavePunctuation, normalizePunctuationToChinese } from './textDiff';
import type { DiffToken } from '../types';

// ---------------------------------------------------------------------------
// normalizeForComparison
// ---------------------------------------------------------------------------

describe('normalizeForComparison — Arabic number conversion', () => {
  it('100 → 一百', () => {
    expect(normalizeForComparison('100')).toBe('一百');
  });

  it('214 → 二百一十四', () => {
    expect(normalizeForComparison('214')).toBe('二百一十四');
  });

  it('10 → 十 (standalone tens, no leading 一)', () => {
    expect(normalizeForComparison('10')).toBe('十');
  });

  it('110 → 一百一十', () => {
    expect(normalizeForComparison('110')).toBe('一百一十');
  });

  it('2021 → 兩千零二十一 is normalized to 二千零二十一', () => {
    // 2021 → intToChinese produces 二千零二十一
    expect(normalizeForComparison('2021')).toBe('二千零二十一');
  });

  it('strips punctuation and spaces', () => {
    expect(normalizeForComparison('「100次」')).toBe('一百次');
  });
});

describe('normalizeForComparison — 兩/二 variant normalization', () => {
  it('兩百 normalizes to 二百', () => {
    expect(normalizeForComparison('兩百')).toBe('二百');
  });

  it('兩千 normalizes to 二千', () => {
    expect(normalizeForComparison('兩千')).toBe('二千');
  });

  it('兩萬 normalizes to 二萬', () => {
    expect(normalizeForComparison('兩萬')).toBe('二萬');
  });

  it('兩億 normalizes to 二億', () => {
    expect(normalizeForComparison('兩億')).toBe('二億');
  });

  it('兩百一十四 normalizes to 二百一十四', () => {
    expect(normalizeForComparison('兩百一十四')).toBe('二百一十四');
  });

  it('兩 standalone (not before 百/千/萬/億) is NOT changed', () => {
    // 兩個人 — 兩 used as a measure word, should stay
    expect(normalizeForComparison('兩個人')).toBe('兩個人');
  });

  it('兩岸 — 兩 not before number unit, should stay', () => {
    expect(normalizeForComparison('兩岸')).toBe('兩岸');
  });
});

// ---------------------------------------------------------------------------
// STT matching: spoken vs target with number variants
// ---------------------------------------------------------------------------

describe('diffCharacters — STT matching with number normalization', () => {
  it('STT "兩百一十四" matches target "214" as 100% correct', () => {
    const result = diffCharacters('兩百一十四', '214', { useHomophone: true });
    // Both normalize to 二百一十四
    expect(result.matchRate).toBe(1);
    expect(result.correctCount).toBe(5); // 二百一十四 = 5 chars
    expect(result.wrongCount).toBe(0);
    expect(result.missingCount).toBe(0);
  });

  it('STT "一百" matches target "100" as 100% correct', () => {
    const result = diffCharacters('一百', '100', { useHomophone: true });
    expect(result.matchRate).toBe(1);
    expect(result.correctCount).toBe(2);
  });

  it('STT "兩百" matches target "二百" as 100% correct', () => {
    const result = diffCharacters('兩百', '二百', { useHomophone: true });
    expect(result.matchRate).toBe(1);
    expect(result.correctCount).toBe(2);
    expect(result.wrongCount).toBe(0);
  });

  it('STT "累計兩百一十四周" matches target "累計214周" fully', () => {
    const result = diffCharacters('累計兩百一十四周', '累計214周', { useHomophone: true });
    expect(result.matchRate).toBe(1);
    expect(result.wrongCount).toBe(0);
  });
});

describe('interleavePunctuation', () => {
  it('inserts punctuation from target text between diff tokens', () => {
    const target = '你好，世界';
    const { tokens } = diffCharacters('你好世界', target, { useHomophone: true });
    const display = interleavePunctuation(target, tokens as DiffToken[]);

    expect(display.map((t) => `${t.char}:${t.type}`)).toEqual([
      '你:correct',
      '好:correct',
      '，:punctuation',
      '世:correct',
      '界:correct',
    ]);
  });

  it('inserts all target punctuation when diff tokens only cover partial reading', () => {
    const target = '你好，世界！再見。';
    const tokens: DiffToken[] = [
      { char: '你', type: 'correct' },
      { char: '好', type: 'correct' },
    ];
    const display = interleavePunctuation(target, tokens);

    expect(display.map((t) => t.char).join('')).toBe(target);
    expect(display.map((t) => `${t.char}:${t.type}`)).toEqual([
      '你:correct',
      '好:correct',
      '，:punctuation',
      '世:unread',
      '界:unread',
      '！:punctuation',
      '再:unread',
      '見:unread',
      '。:punctuation',
    ]);
  });

  it('uses target Chinese punctuation when spoken transcript has ASCII commas', () => {
    const target = '中國的戰國時期，有七個國家總是爭強鬥勝、互比苗頭，';
    const spoken = '中國的戰國時期, 有七個國家總是爭強鬥勝, 互比苗頭;';
    const { tokens } = diffCharacters(spoken, target, { useHomophone: true });
    const display = interleavePunctuation(target, tokens as DiffToken[]);

    expect(display.map((t) => t.char).join('')).toBe(target);
    expect(display.some((t) => t.char === ',')).toBe(false);
    expect(display.some((t) => t.char === ';')).toBe(false);
    expect(display.some((t) => t.char === '，')).toBe(true);
    expect(display.some((t) => t.char === '、')).toBe(true);
  });
});

describe('normalizePunctuationToChinese', () => {
  it('maps half-width punctuation to full-width Chinese', () => {
    expect(normalizePunctuationToChinese('你好, 世界; 再見.')).toBe('你好，世界；再見。');
  });
});
