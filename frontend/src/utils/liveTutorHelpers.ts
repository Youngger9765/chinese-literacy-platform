import { DiffToken } from '../types';
import { normalizeForComparison } from './textDiff';
import { isHomophone } from './pinyin';

/** Punctuation characters used to determine retryable sentence length.
 *  Keep in sync with splitIntoSentences() in localEval.ts.
 *  ⚠️ Has /g flag → stateful lastIndex. Safe with .replace() but do NOT use .test() or .exec() directly. */
export const CHINESE_PUNCTUATION_REGEX = /[，。！？；：、─—…「」『』（）]/g;

/**
 * Look-ahead cursor: for each spoken char, try matching the current target
 * position first. On mismatch, look ahead up to LOOK_AHEAD target positions
 * to handle substitutions (e.g. 而且 vs 並且) and rare chars (e.g. 賁).
 * Spoken chars that don't match anything are treated as extra and skipped.
 */
const LOOK_AHEAD = 3;

export function calcSpeakingProgress(interim: string, target: string): number {
  const s = Array.from(normalizeForComparison(interim));
  const t = Array.from(normalizeForComparison(target));
  let j = 0;
  for (let i = 0; i < s.length && j < t.length; i++) {
    if (s[i] === t[j] || isHomophone(s[i], t[j])) {
      j++;
    } else {
      let found = false;
      for (let k = 1; k <= LOOK_AHEAD && j + k < t.length; k++) {
        if (s[i] === t[j + k] || isHomophone(s[i], t[j + k])) {
          j = j + k + 1;
          found = true;
          break;
        }
      }
      // If not found, spoken char is extra — skip it (j stays)
      void found;
    }
  }
  return j;
}

/**
 * Map a count of normalized (punctuation-stripped) matched chars back to
 * the corresponding index in the original target string.
 */
export function normalizedToOrigIdx(target: string, normalizedProgress: number): number {
  let norm = 0;
  for (let i = 0; i < target.length; i++) {
    if (norm >= normalizedProgress) return i;
    if (!/[「」『』，。！？：；、\s]/.test(target[i])) norm++;
  }
  return target.length;
}

export const IS_PUNCT = /[「」『』，。！？：；、\s]/;

/**
 * Build real-time overlay tokens from diffCharacters output.
 * 1. Filter out "extra" tokens (spoken chars with no target position)
 * 2. Find the cursor: index of last correct/wrong/forgiven token
 * 3. Mark everything after the cursor as "unread"
 */
export function buildRealtimeOverlay(diffTokens: DiffToken[]): DiffToken[] {
  // Keep only target-side tokens (correct, wrong, missing, forgiven)
  const targetTokens = diffTokens.filter(t => t.type !== 'extra');

  // Find cursor: last position where student has spoken (correct, wrong, or forgiven)
  let cursor = -1;
  for (let i = targetTokens.length - 1; i >= 0; i--) {
    if (
      targetTokens[i].type === 'correct' ||
      targetTokens[i].type === 'wrong' ||
      targetTokens[i].type === 'forgiven'
    ) {
      cursor = i;
      break;
    }
  }

  // Mark tokens after cursor as "unread"
  return targetTokens.map((t, i) => {
    if (i > cursor && t.type === 'missing') {
      return { ...t, type: 'unread' as const };
    }
    return t;
  });
}

/**
 * Extract Chinese characters the student actually missed on their LAST attempt
 * per paragraph.
 */
export interface LineResultForExtract {
  lineIndex: number;
  transcript: string;
}

export const extractPracticeChars = (
  results: LineResultForExtract[],
  content: string[],
): string[] => {
  const lastByLine = new Map<number, LineResultForExtract>();
  for (const r of results) {
    lastByLine.set(r.lineIndex, r);
  }

  const chars = new Set<string>();
  for (const r of lastByLine.values()) {
    const targetText = content[r.lineIndex] || '';
    const targetNorm = normalizeForComparison(targetText);
    const spokenNorm = normalizeForComparison(
      correctHomophonesLocal(r.transcript, targetNorm),
    );

    const spokenFreq: Record<string, number> = {};
    for (const ch of spokenNorm) {
      if (/[\u4e00-\u9fa5]/.test(ch)) spokenFreq[ch] = (spokenFreq[ch] || 0) + 1;
    }

    for (const ch of targetNorm) {
      if (/[\u4e00-\u9fa5]/.test(ch)) {
        if (!spokenFreq[ch] || spokenFreq[ch] <= 0) {
          chars.add(ch);
        } else {
          spokenFreq[ch]--;
        }
      }
    }
  }
  return Array.from(chars).slice(0, 12);
};

// Local import to avoid circular — correctHomophones is used only here
import { correctHomophones as correctHomophonesLocal } from './pinyin';
