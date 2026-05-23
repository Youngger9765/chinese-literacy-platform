/**
 * pinyin/match.ts — comparison + scoring algorithms.
 *
 * Exports:
 *   - isHomophone(a, b): true if two characters share toneless pinyin
 *   - isNearSound(a, b): true if two characters have near-sound pinyins
 *   - isSttEquivalent(a, b): true if STT commonly confuses the two chars
 *   - correctHomophones(sttText, targetText): fix homophone substitutions
 */

import { NEAR_SOUND_PAIRS, STT_EQUIVALENT_GROUPS } from './data';
import { getPinyin } from './normalize';

/** Returns true if two characters are homophones (same toneless pinyin). */
export function isHomophone(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = getPinyin(a);
  const pb = getPinyin(b);
  if (pa === null || pb === null) return false;
  return pa === pb;
}

/** Returns true if two pinyins are near-sound (e.g. zh↔z, n↔l). */
function pinyinNearSound(pa: string, pb: string): boolean {
  for (const [a, b] of NEAR_SOUND_PAIRS) {
    // Check initial substitution: replace one initial with the other
    if (pa.replace(a, b) === pb || pa.replace(b, a) === pb) return true;
    if (pb.replace(a, b) === pa || pb.replace(b, a) === pa) return true;
  }
  return false;
}

/** Returns true if two characters have near-sound pinyins (forgiven, not wrong). */
export function isNearSound(a: string, b: string): boolean {
  if (a === b) return false; // exact match is not "near sound"
  const pa = getPinyin(a);
  const pb = getPinyin(b);
  if (pa === null || pb === null) return false;
  if (pa === pb) return false; // same pinyin = homophone, not near-sound
  return pinyinNearSound(pa, pb);
}

/** Returns true if two characters are STT-equivalent (should be treated as correct, not forgiven). */
export function isSttEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  return STT_EQUIVALENT_GROUPS.some(group => group.has(a) && group.has(b));
}

/**
 * Given raw STT text and the known target text, correct homophone
 * substitutions on a character-by-character basis using Levenshtein
 * alignment (edit-distance with backtracking).
 *
 * For each aligned pair (sttChar, targetChar):
 *   - If they are the same character → keep as-is.
 *   - If they are homophones → replace STT char with target char.
 *   - If they are NOT homophones → keep STT char (genuine error).
 *
 * Returns the corrected string.
 */
export function correctHomophones(sttText: string, targetText: string): string {
  const s = Array.from(sttText);
  const t = Array.from(targetText);
  const sLen = s.length;
  const tLen = t.length;

  if (sLen === 0) return sttText;
  if (tLen === 0) return sttText;

  // Build DP table.
  const dp: number[][] = Array.from({ length: sLen + 1 }, () => Array(tLen + 1).fill(0));
  for (let i = 0; i <= sLen; i++) dp[i][0] = i;
  for (let j = 0; j <= tLen; j++) dp[0][j] = j;

  for (let i = 1; i <= sLen; i++) {
    for (let j = 1; j <= tLen; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  // Backtrack to find alignment.
  const result: string[] = [];
  let i = sLen;
  let j = tLen;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      if (dp[i][j] === dp[i - 1][j - 1] + cost) {
        // Match or substitution.
        if (s[i - 1] === t[j - 1]) {
          result.push(s[i - 1]); // exact match
        } else if (isHomophone(s[i - 1], t[j - 1])) {
          result.push(t[j - 1]); // homophone → use target char
        } else {
          result.push(s[i - 1]); // genuine mismatch → keep STT
        }
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      // Deletion (extra char in STT) — keep it.
      result.push(s[i - 1]);
      i--;
    } else {
      // Insertion (char in target missing from STT) — skip.
      j--;
    }
  }

  return result.reverse().join('');
}
