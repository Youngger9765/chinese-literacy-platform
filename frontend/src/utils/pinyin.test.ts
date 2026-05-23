/**
 * TDD tests for pinyin.ts pure functions.
 *
 * Phase 1 (RED): Written against the current monolithic pinyin.ts.
 * Phase 2 (GREEN): Must still pass after split into pinyin/data.ts,
 *   pinyin/normalize.ts, pinyin/match.ts, and thin pinyin.ts facade.
 *
 * Covers all exported functions:
 *   - getPinyin
 *   - isHomophone
 *   - isNearSound
 *   - isSttEquivalent
 *   - correctHomophones
 */

import { describe, it, expect } from 'vitest';
import {
  getPinyin,
  isHomophone,
  isNearSound,
  isSttEquivalent,
  correctHomophones,
} from './pinyin';

// ─────────────────────────────────────────────────────────────────────────────
// getPinyin
// ─────────────────────────────────────────────────────────────────────────────

describe('getPinyin', () => {
  it('returns toneless pinyin for a common character', () => {
    expect(getPinyin('中')).toBe('zhong');
  });

  it('returns pinyin for another common character', () => {
    expect(getPinyin('文')).toBe('wen');
  });

  it('returns null for an unknown character', () => {
    expect(getPinyin('𠀀')).toBeNull(); // rare character outside the lookup
  });

  it('returns null for empty string (no char)', () => {
    // empty string has no entry → null
    expect(getPinyin('')).toBeNull();
  });

  it('uses the most-common reading for multi-pronunciation characters (得 → de)', () => {
    // 得 maps to 'de' as first-listed reading
    expect(getPinyin('得')).toBe('de');
  });

  it('returns pinyin for bopomofo characters (identity mapping)', () => {
    expect(getPinyin('ㄅ')).toBe('ㄅ');
    expect(getPinyin('ㄆ')).toBe('ㄆ');
  });

  it('handles all 26 initial groups — spot check a, b, z', () => {
    expect(getPinyin('啊')).toBe('a');
    expect(getPinyin('八')).toBe('ba');
    expect(getPinyin('做')).toBe('zuo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isHomophone
// ─────────────────────────────────────────────────────────────────────────────

describe('isHomophone', () => {
  it('returns true for identical characters', () => {
    expect(isHomophone('中', '中')).toBe(true);
  });

  it('returns true for characters sharing toneless pinyin', () => {
    // 河/和/合 all map to 'he'
    expect(isHomophone('河', '和')).toBe(true);
    expect(isHomophone('河', '合')).toBe(true);
  });

  it('returns false for characters with different pinyins', () => {
    expect(isHomophone('中', '文')).toBe(false);
  });

  it('returns false when either character is unknown', () => {
    expect(isHomophone('𠀀', '中')).toBe(false);
    expect(isHomophone('中', '𠀀')).toBe(false);
  });

  it('returns false when both characters are unknown', () => {
    expect(isHomophone('𠀀', '𠀁')).toBe(false);
  });

  it('correctly handles 的/得 — both map to "de" (homophones)', () => {
    expect(isHomophone('的', '得')).toBe(true);
    expect(isHomophone('得', '的')).toBe(true);
  });

  it('correctly handles 地 — maps to "di" not "de" (NOT a homophone of 的)', () => {
    // 地 → di, 的 → de: different pinyins, so NOT homophones
    expect(isHomophone('的', '地')).toBe(false);
    expect(isHomophone('得', '地')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isNearSound
// ─────────────────────────────────────────────────────────────────────────────

describe('isNearSound', () => {
  it('returns false for identical characters (exact match is not near-sound)', () => {
    expect(isNearSound('中', '中')).toBe(false);
  });

  it('returns false for homophones (same pinyin is not near-sound)', () => {
    expect(isNearSound('河', '和')).toBe(false);
  });

  it('returns true for zh↔z substitution pair', () => {
    // 知(zhi) and 字(zi) differ by zh↔z
    expect(isNearSound('知', '字')).toBe(true);
  });

  it('returns true for sh↔s substitution pair', () => {
    // 是(shi) and 司(si) differ by sh↔s
    expect(isNearSound('是', '司')).toBe(true);
  });

  it('returns true for ch↔c substitution pair', () => {
    // 吃(chi) and 次(ci) differ by ch↔c
    expect(isNearSound('吃', '次')).toBe(true);
  });

  it('returns true for n↔l substitution pair', () => {
    // 你(ni) and 裡(li) differ by n↔l
    expect(isNearSound('你', '裡')).toBe(true);
  });

  it('returns false for completely unrelated sounds', () => {
    expect(isNearSound('中', '啊')).toBe(false);
  });

  it('returns false when either character is unknown', () => {
    expect(isNearSound('𠀀', '中')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isSttEquivalent
// ─────────────────────────────────────────────────────────────────────────────

describe('isSttEquivalent', () => {
  it('returns true for identical characters', () => {
    expect(isSttEquivalent('的', '的')).toBe(true);
    expect(isSttEquivalent('得', '得')).toBe(true);
  });

  it('returns true for 的/得 pair', () => {
    expect(isSttEquivalent('的', '得')).toBe(true);
    expect(isSttEquivalent('得', '的')).toBe(true);
  });

  it('returns true for 的/地 pair', () => {
    expect(isSttEquivalent('的', '地')).toBe(true);
    expect(isSttEquivalent('地', '的')).toBe(true);
  });

  it('returns true for 得/地 pair', () => {
    expect(isSttEquivalent('得', '地')).toBe(true);
    expect(isSttEquivalent('地', '得')).toBe(true);
  });

  it('returns false for unrelated characters', () => {
    expect(isSttEquivalent('的', '中')).toBe(false);
    expect(isSttEquivalent('中', '文')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// correctHomophones
// ─────────────────────────────────────────────────────────────────────────────

describe('correctHomophones', () => {
  it('returns sttText unchanged when both inputs are empty', () => {
    expect(correctHomophones('', '')).toBe('');
  });

  it('returns sttText unchanged when sttText is empty', () => {
    expect(correctHomophones('', '中文')).toBe('');
  });

  it('returns sttText unchanged when targetText is empty', () => {
    expect(correctHomophones('中文', '')).toBe('中文');
  });

  it('returns exact match unchanged', () => {
    expect(correctHomophones('中文', '中文')).toBe('中文');
  });

  it('corrects a homophone substitution', () => {
    // STT transcribed 河 instead of 和; target is 和 → should correct to 和
    const result = correctHomophones('河平', '和平');
    expect(result).toBe('和平');
  });

  it('preserves genuine errors (not homophones)', () => {
    // 中→文 is not a homophone substitution
    const result = correctHomophones('中文', '大文');
    // '中' and '大' are not homophones → keep '中'; '文' matches → keep '文'
    expect(result).toBe('中文');
  });

  it('handles multiple homophone substitutions in one string', () => {
    // 河(he) → 和(he) homophone; 知(zhi) → 知(zhi) exact match
    const result = correctHomophones('河知', '和知');
    expect(result).toBe('和知');
  });

  it('handles insertions in STT (extra chars kept)', () => {
    // stt has extra char not in target
    const result = correctHomophones('中的文', '中文');
    // alignment: 中→中 (match), 的 extra (deletion kept), 文→文 (match)
    expect(result).toContain('中');
    expect(result).toContain('文');
  });

  it('handles unicode correctly (no byte-splitting of CJK)', () => {
    const result = correctHomophones('愛國', '愛國');
    expect(result).toBe('愛國');
  });

  it('corrects 的↔得 (de homophones) when target is 得', () => {
    const result = correctHomophones('跑的很快', '跑得很快');
    expect(result).toBe('跑得很快');
  });

  it('keeps non-homophone substitution errors intact', () => {
    // '大' (da) vs '小' (xiao) — completely different
    const result = correctHomophones('大家好', '小家好');
    // '大' is not a homophone of '小', so keep '大'
    expect(result).toBe('大家好');
  });
});
