/**
 * ttsHighlight.ts
 *
 * Helper for syncing TTS highlight progress with display text that contains
 * symbols stripped by _cleanForTts().
 *
 * Problem: displayText may contain ~~~, ──, …, etc. that are removed before
 * TTS audio is generated. The audio's character-count progress doesn't match
 * the display character index, causing highlights to lag behind.
 *
 * Solution: Walk display chars; skip chars that _cleanForTts would strip so
 * they don't consume TTS progress budget.
 */

/**
 * _cleanForTts has two distinct transformation types — we must treat them
 * differently when walking display chars:
 *
 * 1. TRULY STRIPPED (→ ''): these chars vanish from TTS audio entirely.
 *    They must NOT advance `effective` (no audio time consumed).
 *    Examples: [~～], #, [/\|], [*\[\]{}], [·‧・°○]
 *
 * 2. REPLACED WITH ONE CHAR (→ '，'): these chars become a single pause char.
 *    They MUST advance `effective` by 1 (one char worth of audio time).
 *    Examples: [──—–−] and […⋯] and -{2,}  (all → '，')
 *
 * 3. REPLACED WITH THREE CHARS (→ '百分之'): % becomes 3 TTS chars.
 *    Advances `effective` by 3.
 *
 * Treating category 2/3 as "stripped" (category 1) makes the highlight split
 * arrive ahead of the speech whenever those chars appear in displayText.
 * E.g. L01.yml contains '球后──戴資穎' — the '──' must count as 1 TTS char.
 *
 * Keep in sync with _cleanForTts in frontend/src/services/ttsApi.ts.
 */

/** Truly removed by _cleanForTts — contribute 0 TTS chars. */
const STRIP_RE = /[~～#/\\|*[\]{}·‧・°○]/;

/** Replaced by '，' (1 TTS char) — contribute 1 TTS char. */
const PAUSE_ONE_RE = /[──—–−…⋯]/;

/**
 * Given a display string (which may contain TTS-stripped/replaced symbols) and
 * a TTS progress count (number of cleaned chars already spoken), return the
 * index in displayText where highlighting should split.
 *
 * Walk display chars, mapping each to its TTS char contribution:
 *   - truly stripped chars → 0
 *   - pause chars (──, …)  → 1
 *   - % → 3 (百分之)
 *   - double-hyphen run    → 1
 *   - all other chars      → 1
 */
export function displayIdxForProgress(displayText: string, progress: number): number {
  let effective = 0;
  for (let i = 0; i < displayText.length; i++) {
    if (effective >= progress) return i;
    const ch = displayText[i];

    // Double-hyphen run "-{2,}" → '，' (1 TTS char)
    if (ch === '-' && displayText[i + 1] === '-') {
      while (i + 1 < displayText.length && displayText[i + 1] === '-') i++;
      effective++;
      continue;
    }

    // % → '百分之' (3 TTS chars)
    if (ch === '%') {
      effective += 3;
      continue;
    }

    // Pause chars (em-dash, ellipsis) → '，' (1 TTS char)
    if (PAUSE_ONE_RE.test(ch)) {
      effective++;
      continue;
    }

    // Truly stripped chars → 0 TTS chars
    if (STRIP_RE.test(ch)) {
      continue;
    }

    // All other chars (CJK, punctuation, letters) → 1 TTS char
    effective++;
  }
  return displayText.length;
}
