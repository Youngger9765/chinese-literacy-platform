/* eslint-disable no-use-before-define -- pre-existing pattern, not TDZ risk (#2289) */
/**
 * Levenshtein-aligned character diff for comparing spoken text against target text.
 * Used by LiveTutor and FullReading to show exactly which characters
 * the student read correctly, incorrectly, missed, or added.
 */
import type { DiffToken } from '../types';
import { isHomophone, isNearSound, isSttEquivalent } from './pinyin';

export type DiffType =
  | 'correct'
  | 'forgiven'
  | 'wrong'
  | 'missing'
  | 'extra'
  | 'unread'
  | 'punctuation';

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

const normalizeFullwidthDigits = (text: string) =>
  text.replace(/[\uFF10-\uFF19]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
  );

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
    .replace(/[──—–−]{1,}/g, '')              // long dashes, minus sign
    .replace(/-{2,}/g, '')                     // double hyphens
    .replace(/[.]{3,}|[…⋯]+/g, '')           // ellipsis (all variants)
    .replace(/#/g, '')                         // hashtag
    .replace(/[/\\|*[\]{}]+/g, '')             // markdown/code symbols
    .replace(/[·‧・°○]+/g, '')                // interpunct, degree, circle
    .replace(/%/g, '')                         // percent sign
    .replace(/[\uf410\u{E01E0}-\u{E01E4}]+/gu, '') // invisible/private-use chars
    .replace(/（[^）]*）/g, '')                // parenthetical notes
    .replace(/\([^)]*\)/g, '');                // English parenthetical notes

/** Half-width punctuation from STT/Gemini → full-width Chinese (display + compare). */
export function normalizePunctuationToChinese(text: string): string {
  return text
    .replace(/,/g, '，')
    .replace(/;/g, '；')
    .replace(/\./g, '。')
    .replace(/\?/g, '？')
    .replace(/!/g, '！')
    .replace(/:/g, '：')
    .replace(/\(/g, '（')
    .replace(/\)/g, '）')
    .replace(/\s+/g, '');
}

/** Bopomofo + tone marks — excluded from accuracy scoring (not spoken aloud). */
const BOPOMOFO_RE = /[\u3100-\u312F\u31A0-\u31BF\u02CA\u02C7\u02CB\u02D9]/g;

/**
 * Punctuation excluded from accuracy denominator.
 * Display may still show these via interleavePunctuation; they never affect matchRate.
 */
const SCORING_PUNCT_RE =
  /[「」『』，。！？：；、．…—－\-（）()\[\]《》""''\s,.!?;:'"]/g;

const TOKEN_PUNCT_RE = /[「」『』，。！？：；、．…—－\-（）()\[\]《》""''\s,.!?;:'"]/;

function isTokenPunctuationChar(ch: string): boolean {
  return TOKEN_PUNCT_RE.test(ch);
}

/** Strip bopomofo and punctuation for scoring-only comparison. */
function stripNonScorableChars(text: string): string {
  return text.replace(BOPOMOFO_RE, '').replace(SCORING_PUNCT_RE, '');
}

export const normalizeForComparison = (text: string) =>
  stripNonScorableChars(
    normalizeChineseNumberVariants(
      normalizeNumbers(
        cleanChineseText(
          stripDecorativeSymbols(
            normalizeFullwidthDigits(normalizePunctuationToChinese(text)),
          ),
        ),
      ),
    ),
  );

/** Count characters that contribute to accuracy (excludes punctuation and zhuyin). */
export function countScorableCharacters(text: string): number {
  return normalizeForComparison(text).length;
}

type AlignmentPair = { target: string | null; spoken: string | null };

/**
 * Levenshtein alignment with backtracking (same family as backend fallback).
 * Allows multiple skipped target chars (漏字) while each spoken char is used
 * at most once in order — no ghost-green on later duplicate target chars.
 */
function alignSpokenToTarget(
  spokenChars: string[],
  targetChars: string[],
  isMatch: (a: string, b: string) => boolean,
): AlignmentPair[] {
  const sLen = spokenChars.length;
  const tLen = targetChars.length;

  const dp: number[][] = Array.from({ length: tLen + 1 }, () =>
    Array<number>(sLen + 1).fill(0),
  );
  for (let i = 0; i <= tLen; i++) dp[i][0] = i;
  for (let j = 0; j <= sLen; j++) dp[0][j] = j;

  for (let i = 1; i <= tLen; i++) {
    for (let j = 1; j <= sLen; j++) {
      const cost = isMatch(spokenChars[j - 1], targetChars[i - 1]) ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  const alignment: AlignmentPair[] = [];
  let i = tLen;
  let j = sLen;

  while (i > 0 || j > 0) {
    // Prefer target gaps (漏字) over late duplicate-char matches when costs tie.
    if (i > 0 && (j === 0 || dp[i][j] === dp[i - 1][j] + 1)) {
      alignment.push({ target: targetChars[i - 1], spoken: null });
      i--;
      continue;
    }
    if (j > 0 && (i === 0 || dp[i][j] === dp[i][j - 1] + 1)) {
      alignment.push({ target: null, spoken: spokenChars[j - 1] });
      j--;
      continue;
    }
    if (i > 0 && j > 0) {
      const cost = isMatch(spokenChars[j - 1], targetChars[i - 1]) ? 0 : 1;
      if (dp[i][j] === dp[i - 1][j - 1] + cost) {
        alignment.push({
          target: targetChars[i - 1],
          spoken: spokenChars[j - 1],
        });
        i--;
        j--;
        continue;
      }
    }
    // Fallback (should not happen with consistent DP)
    if (i > 0) {
      alignment.push({ target: targetChars[i - 1], spoken: null });
      i--;
    } else {
      alignment.push({ target: null, spoken: spokenChars[j - 1] });
      j--;
    }
  }

  alignment.reverse();
  return alignment;
}

/**
 * Compare spoken text against target via Levenshtein alignment.
 * Skipped target chars → missing; later speech can resync (no cascade wrong).
 * matchRate = (correct + forgiven) / scorable target length (no punctuation or zhuyin)
 */
export function diffCharacters(
  spoken: string,
  target: string,
  options?: { useHomophone?: boolean }
): DiffResult {
  const useHomophone = options?.useHomophone ?? false;
  const s = Array.from(normalizeForComparison(spoken)).filter((ch) => !FILLER_CHARS.has(ch));
  const t = Array.from(normalizeForComparison(target));
  const sLen = s.length;
  const tLen = t.length;

  /** Check if two chars match (exact, STT-equivalent, homophone, or near-sound). */
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
    if (isSttEquivalent(a, b)) return 'correct';
    return 'forgiven';
  };

  if (tLen === 0) {
    return {
      tokens: s.map((ch) => ({ char: ch, type: 'extra' as DiffType })),
      matchRate: 0,
      correctCount: 0,
      wrongCount: 0,
      missingCount: 0,
      extraCount: sLen,
    };
  }

  if (sLen === 0) {
    return {
      tokens: t.map((ch) => ({ char: ch, type: 'missing' as DiffType })),
      matchRate: 0,
      correctCount: 0,
      wrongCount: 0,
      missingCount: tLen,
      extraCount: 0,
    };
  }

  const alignment = alignSpokenToTarget(s, t, isMatch);
  const tokens: DiffToken[] = [];

  for (const { target: tCh, spoken: sCh } of alignment) {
    if (tCh === null) {
      tokens.push({ char: sCh!, type: 'extra' });
      continue;
    }
    if (sCh === null) {
      tokens.push({ char: tCh, type: 'missing' });
      continue;
    }
    if (isMatch(sCh, tCh)) {
      tokens.push({ char: tCh, type: classifyMatch(sCh, tCh) });
    } else {
      tokens.push({ char: sCh, type: 'wrong', expected: tCh });
    }
  }

  const merged = tokens;

  // Compute stats (forgiven counts as correct for matchRate)
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
 * Uses Levenshtein-aligned diffCharacters for ordering-aware results.
 */
export function computeMatchRate(spoken: string, target: string): number {
  const result = diffCharacters(spoken, target, { useHomophone: true });
  return result.matchRate;
}

/** Punctuation stripped from diff comparison — re-inserted at display time only. */
const DISPLAY_PUNCT_RE = TOKEN_PUNCT_RE;

const DIGIT_RE = /[\d\uFF10-\uFF19]/;

function chineseNormLenForDigitRun(digitStr: string): number {
  if (!digitStr) return 0;
  const ascii = normalizeFullwidthDigits(digitStr);
  return Array.from(intToChinese(parseInt(ascii, 10))).length;
}

function consumeNextDisplayToken(
  displayTokens: DiffToken[],
  tokenIdx: number,
): { token: DiffToken | null; nextIdx: number } {
  let idx = tokenIdx;
  while (idx < displayTokens.length && isTokenPunctuationChar(displayTokens[idx].char)) {
    idx += 1;
  }
  if (idx >= displayTokens.length) {
    return { token: null, nextIdx: idx };
  }
  return { token: displayTokens[idx], nextIdx: idx + 1 };
}

function aggregateDigitRunForDisplay(
  displayChar: string,
  runTokens: DiffToken[],
): DiffToken {
  if (runTokens.length === 0) {
    return { char: displayChar, type: 'unread' };
  }
  const types = runTokens.map((t) => t.type);
  if (types.every((t) => t === 'correct')) {
    return { char: displayChar, type: 'correct' };
  }
  if (types.every((t) => t === 'correct' || t === 'forgiven')) {
    return { char: displayChar, type: 'forgiven' };
  }
  if (types.some((t) => t === 'wrong')) {
    const wrong = runTokens.find((t) => t.type === 'wrong')!;
    return { char: displayChar, type: 'wrong', expected: wrong.expected };
  }
  if (types.every((t) => t === 'missing' || t === 'unread')) {
    return { char: displayChar, type: types[0] === 'unread' ? 'unread' : 'missing' };
  }
  if (types.some((t) => t === 'missing' || t === 'unread')) {
    return { char: displayChar, type: 'missing' };
  }
  // Mis-aligned token run — do not default to correct (would show unread text as green).
  return { char: displayChar, type: 'missing' };
}

/**
 * Re-insert punctuation from the lesson line into diff tokens for display.
 * Always walks the full target text — punctuation is never gated on how much
 * the student has read. Scoring still uses punctuation-stripped tokens.
 *
 * Arabic digit runs (e.g. 299 → 二百九十九) expand to multiple normalized
 * diff tokens; each digit in the original line inherits the aggregate status.
 */
export function interleavePunctuation(
  targetText: string,
  diffTokens: DiffToken[],
): DiffToken[] {
  const displayTokens = diffTokens.filter((t) => t.type !== 'extra');
  if (!targetText) return displayTokens;

  if (displayTokens.length === 0) {
    return Array.from(targetText).map((ch) =>
      DISPLAY_PUNCT_RE.test(ch)
        ? { char: ch, type: 'punctuation' as const }
        : { char: ch, type: 'unread' as const },
    );
  }

  const targetChars = Array.from(targetText);
  const normChars = Array.from(normalizeForComparison(targetText));
  const result: DiffToken[] = [];
  let tokenIdx = 0;
  let normIdx = 0;

  for (let i = 0; i < targetChars.length; i++) {
    const ch = targetChars[i];

    if (DISPLAY_PUNCT_RE.test(ch)) {
      result.push({ char: ch, type: 'punctuation' });
      continue;
    }

    if (DIGIT_RE.test(ch)) {
      if (i > 0 && DIGIT_RE.test(targetChars[i - 1])) continue;

      let digitEnd = i;
      while (digitEnd < targetChars.length && DIGIT_RE.test(targetChars[digitEnd])) {
        digitEnd += 1;
      }
      const digitRun = targetChars.slice(i, digitEnd).join('');
      const normRunLen = chineseNormLenForDigitRun(digitRun);
      const runTokens: DiffToken[] = [];

      for (let k = 0; k < normRunLen; k++) {
        const { token, nextIdx } = consumeNextDisplayToken(displayTokens, tokenIdx);
        tokenIdx = nextIdx;
        if (token) runTokens.push(token);
      }
      normIdx += normRunLen;

      for (let d = i; d < digitEnd; d++) {
        result.push(aggregateDigitRunForDisplay(targetChars[d], runTokens));
      }
      i = digitEnd - 1;
      continue;
    }

    if (normIdx < normChars.length && ch === normChars[normIdx]) {
      const { token, nextIdx } = consumeNextDisplayToken(displayTokens, tokenIdx);
      tokenIdx = nextIdx;
      if (token) {
        result.push({ ...token, char: ch });
      } else {
        result.push({ char: ch, type: 'unread' });
      }
      normIdx += 1;
      continue;
    }

    // Decorative / stripped chars in the original line — show without diff styling.
    result.push({ char: ch, type: 'punctuation' });
  }

  return result;
}
