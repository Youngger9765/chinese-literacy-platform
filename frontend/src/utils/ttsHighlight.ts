/**
 * ttsHighlight.ts
 *
 * Helper for syncing TTS highlight progress with display text that contains
 * symbols stripped by _cleanForTts() and zhuyin PUA variant selectors.
 *
 * Problem 1 — stripped symbols (#1110):
 * displayText may contain ~~~, ──, …, etc. that are removed before TTS audio
 * is generated. Audio char-count progress doesn't match display char index,
 * causing highlights to lag.
 *
 * Problem 2 — zhuyin PUA variant selectors (#1112):
 * Polyphonic chars carry U+E01E1–U+E01E5 selectors (BpmfZihiSans font). These
 * are surrogate pairs (2 UTF-16 code units each) invisible to TTS. Walking
 * displayText by UTF-16 index inflates `effective` by 2 per polyphonic char,
 * pushing the highlight split past the real char boundary onto adjacent
 * symbols (~~~, ──).
 *
 * Solution: walk the array of display char GROUPS (from splitZhuyinChars).
 * Each group = base char + optional PUA selector, contributing exactly what
 * _cleanForTts would contribute for the base: 0 (stripped), 1 (normal /
 * pause), or 3 (%). Returns an array index that matches chars.length.
 *
 * Keep in sync with _cleanForTts in frontend/src/services/ttsApi.ts.
 */

/** Truly removed by _cleanForTts — contribute 0 TTS chars. */
const STRIP_RE = /[~～#/\\|*[\]{}·‧・°○]/;

/** Replaced by '，' (1 TTS char) — contribute 1 TTS char. */
const PAUSE_ONE_RE = /[──—–−…⋯]/;

/**
 * Given a char-group array (from splitZhuyinChars) and a TTS progress count
 * (cleaned codepoints already spoken), return the array index where
 * highlighting should split.
 *
 * Each group's TTS contribution is derived from its base codepoint:
 *   - truly stripped chars → 0
 *   - pause chars (──, …)  → 1
 *   - % → 3 (百分之)
 *   - consecutive '-' groups → collapsed into 1 (double-hyphen run)
 *   - all other chars      → 1
 */
export function groupIdxForProgress(chars: string[], progress: number): number {
  let effective = 0;
  for (let i = 0; i < chars.length; i++) {
    if (effective >= progress) return i;
    const baseCp = chars[i].codePointAt(0);
    if (baseCp === undefined) continue;
    const base = String.fromCodePoint(baseCp);

    // Double-hyphen run "-{2,}" → '，' (1 TTS char). Collapse adjacent '-' groups.
    if (base === '-' && chars[i + 1]?.codePointAt(0) === 0x2D) {
      while (chars[i + 1]?.codePointAt(0) === 0x2D) i++;
      effective++;
      continue;
    }

    // % → '百分之' (3 TTS chars)
    if (base === '%') {
      effective += 3;
      continue;
    }

    // Pause chars (em-dash, ellipsis) → '，' (1 TTS char)
    if (PAUSE_ONE_RE.test(base)) {
      effective++;
      continue;
    }

    // Truly stripped chars → 0 TTS chars
    if (STRIP_RE.test(base)) {
      continue;
    }

    // All other chars (CJK, punctuation, letters) → 1 TTS char
    effective++;
  }
  return chars.length;
}
