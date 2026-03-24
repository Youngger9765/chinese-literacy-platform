/**
 * LCS-based character diff for comparing spoken text against target text.
 * Used by LiveTutor and FullReading to show exactly which characters
 * the student read correctly, incorrectly, missed, or added.
 */
import { isHomophone } from './pinyin';

export type DiffType = 'correct' | 'wrong' | 'missing' | 'extra' | 'unread';

export interface DiffToken {
  char: string;
  type: DiffType;
  expected?: string; // For 'wrong' type: what character was expected
}

export interface DiffResult {
  tokens: DiffToken[];
  matchRate: number;      // 0-1, based on correct/target ratio
  correctCount: number;
  wrongCount: number;
  missingCount: number;
  extraCount: number;
}

/* ---- Text normalization (shared with LiveTutor/FullReading) ---- */

export const cleanChineseText = (text: string) => {
  if (!text) return '';
  return text
    .replace(/([\u4e00-\u9fa5！，。？：；（）])\s+([\u4e00-\u9fa5！，。？：；（）])/g, '$1$2')
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2')
    .trim();
};

const CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

const intToChinese = (num: number): string => {
  if (num === 0) return '零';
  let n = num;
  let result = '';
  if (n >= 100_000_000) { result += intToChinese(Math.floor(n / 100_000_000)) + '億'; n %= 100_000_000; if (n > 0 && n < 10_000_000) result += '零'; }
  if (n >= 10_000) { result += intToChinese(Math.floor(n / 10_000)) + '萬'; n %= 10_000; if (n > 0 && n < 1_000) result += '零'; }
  if (n >= 1_000) { result += CHINESE_DIGITS[Math.floor(n / 1_000)] + '千'; n %= 1_000; if (n > 0 && n < 100) result += '零'; }
  if (n >= 100) { result += CHINESE_DIGITS[Math.floor(n / 100)] + '百'; n %= 100; if (n > 0 && n < 10) result += '零'; }
  if (n >= 10) { const tens = Math.floor(n / 10); if (tens > 1 || result.length > 0) result += CHINESE_DIGITS[tens]; result += '十'; n %= 10; }
  if (n > 0) result += CHINESE_DIGITS[n];
  return result;
};

const normalizeNumbers = (text: string) => text.replace(/\d+/g, m => intToChinese(parseInt(m, 10)));

/**
 * Normalize spoken variants of Chinese numbers for comparison.
 * In spoken Mandarin, 兩 (liǎng) is commonly used instead of 二 (èr) before
 * 百/千/萬/億. Both forms are correct; we collapse them to 二 so STT output
 * ("兩百一十四") matches the canonical written form ("二百一十四").
 */
const normalizeChineseNumberVariants = (text: string) =>
  text.replace(/兩(?=[百千萬億])/g, '二');

export const normalizeForComparison = (text: string) =>
  normalizeChineseNumberVariants(
    normalizeNumbers(cleanChineseText(text))
  ).replace(/[「」『』，。！？：；、\s]/g, '');

/**
 * LCS-based diff: compare spoken text against target text, producing
 * a token array showing correct/wrong/missing/extra characters.
 *
 * Algorithm:
 * 1. Build LCS DP table between spoken and target characters
 * 2. Backtrack to produce alignment
 * 3. Classify each position:
 *    - Both match (or homophone match) → correct
 *    - Both present but different → wrong (substitution)
 *    - Target char skipped → missing (deletion from target)
 *    - Spoken char extra → extra (insertion not in target)
 *
 * matchRate = correctCount / target.length
 */
export function diffCharacters(
  spoken: string,
  target: string,
  options?: { useHomophone?: boolean }
): DiffResult {
  const useHomophone = options?.useHomophone ?? false;
  const s = Array.from(normalizeForComparison(spoken));
  const t = Array.from(normalizeForComparison(target));
  const sLen = s.length;
  const tLen = t.length;

  if (tLen === 0) {
    return {
      tokens: s.map(ch => ({ char: ch, type: 'extra' as DiffType })),
      matchRate: 0,
      correctCount: 0,
      wrongCount: 0,
      missingCount: 0,
      extraCount: sLen,
    };
  }

  if (sLen === 0) {
    return {
      tokens: t.map(ch => ({ char: ch, type: 'missing' as DiffType })),
      matchRate: 0,
      correctCount: 0,
      wrongCount: 0,
      missingCount: tLen,
      extraCount: 0,
    };
  }

  // Step 1: Build LCS DP table
  // dp[i][j] = length of LCS of s[0..i-1] and t[0..j-1]
  const dp: number[][] = Array.from({ length: sLen + 1 }, () => Array(tLen + 1).fill(0));

  const isMatch = (a: string, b: string): boolean => {
    if (a === b) return true;
    if (useHomophone) return isHomophone(a, b);
    return false;
  };

  for (let i = 1; i <= sLen; i++) {
    for (let j = 1; j <= tLen; j++) {
      if (isMatch(s[i - 1], t[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Step 2: Backtrack to produce diff tokens
  const tokens: DiffToken[] = [];
  let i = sLen;
  let j = tLen;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && isMatch(s[i - 1], t[j - 1])) {
      // Match — correct (use the target char for display consistency)
      tokens.push({ char: t[j - 1], type: 'correct' });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      // Target char not in spoken — missing
      tokens.push({ char: t[j - 1], type: 'missing' });
      j--;
    } else {
      // Spoken char not in target — extra
      tokens.push({ char: s[i - 1], type: 'extra' });
      i--;
    }
  }

  tokens.reverse();

  // Step 3: Post-process — merge adjacent missing+extra into wrong (substitution)
  // This handles the case where a student said one char instead of another
  const merged: DiffToken[] = [];
  let idx = 0;
  while (idx < tokens.length) {
    if (
      idx + 1 < tokens.length &&
      tokens[idx].type === 'extra' &&
      tokens[idx + 1].type === 'missing'
    ) {
      // extra followed by missing = substitution (wrong)
      merged.push({
        char: tokens[idx].char,
        type: 'wrong',
        expected: tokens[idx + 1].char,
      });
      idx += 2;
    } else if (
      idx + 1 < tokens.length &&
      tokens[idx].type === 'missing' &&
      tokens[idx + 1].type === 'extra'
    ) {
      // missing followed by extra = substitution (wrong)
      merged.push({
        char: tokens[idx + 1].char,
        type: 'wrong',
        expected: tokens[idx].char,
      });
      idx += 2;
    } else {
      merged.push(tokens[idx]);
      idx++;
    }
  }

  // Step 4: Compute stats
  let correctCount = 0;
  let wrongCount = 0;
  let missingCount = 0;
  let extraCount = 0;

  for (const token of merged) {
    switch (token.type) {
      case 'correct': correctCount++; break;
      case 'wrong': wrongCount++; break;
      case 'missing': missingCount++; break;
      case 'extra': extraCount++; break;
    }
  }

  const matchRate = tLen > 0 ? correctCount / tLen : 0;

  return {
    tokens: merged,
    matchRate,
    correctCount,
    wrongCount,
    missingCount,
    extraCount,
  };
}

/**
 * Backward-compatible replacement for the old bag-of-words computeMatchRate.
 * Now uses LCS-based ordering for more accurate results.
 */
export function computeMatchRate(spoken: string, target: string): number {
  const result = diffCharacters(spoken, target, { useHomophone: true });
  return result.matchRate;
}
