/**
 * Unit tests for buildDifficultCharSet (Issue #1346).
 *
 * Tests the char-set extraction logic in isolation -- no React, no polyphonic
 * processor needed.  The function is pure and exported from ZhuyinContext.
 */

import { describe, it, expect } from 'vitest';
import { buildDifficultCharSet } from './ZhuyinContext';

describe('buildDifficultCharSet', () => {
  it('extracts individual chars from a single vocab word', () => {
    const result = buildDifficultCharSet(['龍爭虎鬥']);
    expect(result).toEqual(new Set(['龍', '爭', '虎', '鬥']));
  });

  it('deduplicates chars that appear in multiple vocab words', () => {
    const result = buildDifficultCharSet(['龍爭虎鬥', '虎視眈眈']);
    expect(result.has('虎')).toBe(true);
    // 虎 appears in both words but Set contains it once
    // 龍爭虎鬥 → {龍,爭,虎,鬥} (4), 虎視眈眈 adds {視,眈} (2 new, 虎 already in set)
    expect(result.size).toBe(6);
  });

  it('returns empty Set for empty input array', () => {
    const result = buildDifficultCharSet([]);
    expect(result.size).toBe(0);
  });

  it('returns empty Set for array of empty strings', () => {
    const result = buildDifficultCharSet(['', '']);
    expect(result.size).toBe(0);
  });

  it('handles mixed Chinese and non-Chinese in vocab word', () => {
    // e.g. "D分" from L54 vocabulary
    const result = buildDifficultCharSet(['D分']);
    // 'D' is non-Chinese but still included (whitespace-only chars are excluded)
    expect(result.has('分')).toBe(true);
    expect(result.has('D')).toBe(true);
  });

  it('does not include whitespace chars', () => {
    const result = buildDifficultCharSet([' 龍 爭 ']);
    expect(result.has(' ')).toBe(false);
    expect(result.has('龍')).toBe(true);
    expect(result.has('爭')).toBe(true);
  });

  it('handles lesson with no vocabulary gracefully (empty array)', () => {
    // Lessons like 文言文 / G7 have no vocabulary field -> passed as []
    const result = buildDifficultCharSet([]);
    expect(result.size).toBe(0);
  });

  it('L54 vocabulary produces expected char set', () => {
    // L54 vocabulary sample: 競技體操, 奧運, 鞍馬
    const vocabWords = ['競技體操', '奧運', '鞍馬'];
    const result = buildDifficultCharSet(vocabWords);
    expect(result.has('競')).toBe(true);
    expect(result.has('技')).toBe(true);
    expect(result.has('體')).toBe(true);
    expect(result.has('操')).toBe(true);
    expect(result.has('奧')).toBe(true);
    expect(result.has('運')).toBe(true);
    expect(result.has('鞍')).toBe(true);
    expect(result.has('馬')).toBe(true);
    expect(result.size).toBe(8);
  });
});
