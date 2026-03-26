/**
 * LCS-based character diff for comparing spoken text against target text.
 * Used by LiveTutor and FullReading to show exactly which characters
 * the student read correctly, incorrectly, missed, or added.
 */
import { isHomophone, isNearSound, isSttEquivalent } from './pinyin';

export type DiffType = 'correct' | 'forgiven' | 'wrong' | 'missing' | 'extra' | 'unread';

/** Filler words commonly inserted by STT — not student errors. */
const FILLER_CHARS = new Set(['嗯', '啊', '呃', '喔', '欸']);

/**
 * Clean spoken text (STT output) before diff comparison.
 * Handles natural speech patterns that aren't reading errors:
 * 1. Consecutive repeated chars: 「你你你的」→「你的」(stuttering)
 * 2. Backtrack re-reads: 「她就是台灣第她就是台灣第一人」→「她就是台灣第一人」
 * 3. STT duplicate segments: same phrase sent twice by speech recognition
 */
export function cleanSpokenForDiff(spoken: string, target: string): string {
  let cleaned = spoken;

  // 1. Collapse consecutive repeated characters (stuttering/口吃)
  // 「你你你的」→「你的」, 「累累累計」→「累計」
  cleaned = cleaned.replace(/([\u4e00-\u9fff])\1{1,}/g, '$1');

  // 2. Remove backtrack re-reads against the target
  // If the student said "她就是台灣第她就是台灣第一人", detect the overlapping
  // prefix and keep only the last occurrence.
  const targetNorm = normalizeForComparison(target);
  const spokenChars = Array.from(normalizeForComparison(cleaned));

  // Look for a repeated prefix of the target within spoken text.
  // Scan spoken for the longest target prefix that appears twice.
  if (spokenChars.length > targetNorm.length) {
    const tChars = Array.from(targetNorm);
    // Try to find where the student restarted: look for target[0..k] appearing
    // at position > 0 in spoken, meaning they went back and re-read.
    for (let prefixLen = Math.min(5, Math.floor(tChars.length / 2)); prefixLen >= 3; prefixLen--) {
      const prefix = tChars.slice(0, prefixLen).join('');
      const firstIdx = cleaned.indexOf(prefix);
      if (firstIdx >= 0) {
        const secondIdx = cleaned.indexOf(prefix, firstIdx + 1);
        if (secondIdx > firstIdx) {
          // Found a re-read: keep everything from the second occurrence onwards
          cleaned = cleaned.slice(secondIdx);
          break;
        }
      }
    }
  }

  return cleaned;
}

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

/**
 * Strip decorative symbols that students cannot possibly speak.
 * Must stay in sync with backend tts_service._clean_for_tts().
 */
const stripDecorativeSymbols = (text: string) =>
  text
    .replace(/[~～]+/g, '')                    // tildes (~~~)
    .replace(/[──—–]{1,}/g, '')                // long dashes
    .replace(/-{2,}/g, '')                     // double hyphens
    .replace(/\.{3,}|…+/g, '')                // ellipsis
    .replace(/#/g, '')                         // hashtag
    .replace(/[/\\|*[\]{}]+/g, '')             // markdown/code symbols
    .replace(/（[^）]*）/g, '')                // parenthetical notes e.g. （ml，台灣常用C.C.）
    .replace(/\([^)]*\)/g, '');                // English parenthetical notes

export const normalizeForComparison = (text: string) =>
  normalizeChineseNumberVariants(
    normalizeNumbers(cleanChineseText(stripDecorativeSymbols(text)))
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

  /** Check if two chars match for LCS purposes (exact, STT-equivalent, homophone, or near-sound). */
  const isMatch = (a: string, b: string): boolean => {
    if (a === b) return true;
    if (useHomophone) {
      if (isSttEquivalent(a, b)) return true;
      if (isHomophone(a, b)) return true;
      if (isNearSound(a, b)) return true;
    }
    return false;
  };

  /** Classify the match type between two matched characters. */
  const classifyMatch = (a: string, b: string): 'correct' | 'forgiven' => {
    if (a === b) return 'correct';
    if (isSttEquivalent(a, b)) return 'correct'; // 的/得/地 = correct, not student error
    // Homophone or near-sound = forgiven (STT chose wrong char, student pronounced correctly)
    return 'forgiven';
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
      // Match — correct or forgiven (use the target char for display consistency)
      tokens.push({ char: t[j - 1], type: classifyMatch(s[i - 1], t[j - 1]) });
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

  // Step 3: Post-process — merge adjacent missing+extra into wrong/forgiven (substitution)
  // Also filter out filler characters from 'extra' tokens
  const merged: DiffToken[] = [];
  let idx = 0;
  while (idx < tokens.length) {
    // Filter filler chars (嗯啊呃喔欸) — these are STT noise, not student errors
    if (tokens[idx].type === 'extra' && FILLER_CHARS.has(tokens[idx].char)) {
      idx++;
      continue;
    }
    if (
      idx + 1 < tokens.length &&
      tokens[idx].type === 'extra' &&
      tokens[idx + 1].type === 'missing'
    ) {
      const spokenChar = tokens[idx].char;
      const targetChar = tokens[idx + 1].char;
      // Check if substitution is forgivable (homophone/near-sound/STT-equivalent)
      if (useHomophone && isMatch(spokenChar, targetChar)) {
        merged.push({ char: targetChar, type: classifyMatch(spokenChar, targetChar) });
      } else {
        merged.push({ char: spokenChar, type: 'wrong', expected: targetChar });
      }
      idx += 2;
    } else if (
      idx + 1 < tokens.length &&
      tokens[idx].type === 'missing' &&
      tokens[idx + 1].type === 'extra'
    ) {
      const targetChar = tokens[idx].char;
      const spokenChar = tokens[idx + 1].char;
      if (useHomophone && isMatch(spokenChar, targetChar)) {
        merged.push({ char: targetChar, type: classifyMatch(spokenChar, targetChar) });
      } else {
        merged.push({ char: spokenChar, type: 'wrong', expected: targetChar });
      }
      idx += 2;
    } else {
      merged.push(tokens[idx]);
      idx++;
    }
  }

  // Step 4: Compute stats (forgiven counts as correct for matchRate)
  let correctCount = 0;
  let forgivenCount = 0;
  let wrongCount = 0;
  let missingCount = 0;
  let extraCount = 0;

  for (const token of merged) {
    switch (token.type) {
      case 'correct': correctCount++; break;
      case 'forgiven': forgivenCount++; break;
      case 'wrong': wrongCount++; break;
      case 'missing': missingCount++; break;
      case 'extra': extraCount++; break;
    }
  }

  // Forgiven chars count toward match rate (student pronounced correctly, STT picked wrong char)
  const matchRate = tLen > 0 ? (correctCount + forgivenCount) / tLen : 0;

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
