/**
 * punctuationReinsert — Block 2 of Issue #2131.
 *
 * When Gemini transcription is unavailable and we fall back to Web Speech API,
 * the Web Speech transcript comes back without punctuation.  This utility
 * re-inserts punctuation from the original lesson text into the transcript
 * so the diff display looks cleaner and matches teacher expectations.
 *
 * Algorithm:
 *   1. Strip all punctuation from the target text to produce a "bare" reference.
 *   2. Walk through the transcript characters, matching each against the bare
 *      reference.  When we advance past a position in the reference, insert any
 *      punctuation that appears immediately after that position in the original.
 *   3. If no match is found (transcript diverges too much from target), return
 *      the original transcript unchanged — never mangle the student's words.
 *
 * Design constraints:
 *   - Pure function, no side effects.
 *   - Input/output are both plain strings (no DOM, no React).
 *   - Graceful degradation: unrecognised input → return rawTranscript.
 *   - Only inserts punctuation; never adds, removes or reorders CJK characters.
 *
 * Usage:
 *   const display = reinsertPunctuation(webSpeechTranscript, lessonText);
 */

/** CJK punctuation codepoint ranges (covers common Chinese punctuation). */
const CJK_PUNCT_RE = /[　-〿＀-￯‘’“”…—。，！？；：「」『』【】《》〈〉、—…]/u;

/** Return true if the character is a CJK/fullwidth punctuation mark. */
function isPunct(ch: string): boolean {
  return CJK_PUNCT_RE.test(ch);
}

/**
 * Strip punctuation from text, returning only the non-punctuation characters
 * and a mapping from bare-text index → original text index.
 */
function stripPunct(text: string): { bare: string; map: number[] } {
  const bare: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (!isPunct(text[i]) && text[i] !== ' ' && text[i] !== '\n') {
      bare.push(text[i]);
      map.push(i);
    }
  }
  return { bare: bare.join(''), map };
}

/**
 * Collect any punctuation characters that immediately follow position `origIdx`
 * in `origText`, up to the next non-punctuation character or end of string.
 */
function punctAfter(origText: string, origIdx: number): string {
  let result = '';
  let i = origIdx + 1;
  while (i < origText.length && (isPunct(origText[i]) || origText[i] === ' ')) {
    if (isPunct(origText[i])) result += origText[i];
    i++;
  }
  return result;
}

/**
 * Re-insert punctuation from `targetText` into `rawTranscript`.
 *
 * @param rawTranscript - Web Speech output (no punctuation).
 * @param targetText    - Original lesson text (has punctuation).
 * @returns Transcript with punctuation re-inserted, or rawTranscript unchanged
 *          if the strings diverge too much (alignment confidence < 50%).
 */
export function reinsertPunctuation(rawTranscript: string, targetText: string): string {
  if (!rawTranscript || !targetText) return rawTranscript;

  const { bare: bareTarget, map: targetMap } = stripPunct(targetText);
  const { bare: bareTranscript } = stripPunct(rawTranscript);

  if (bareTarget.length === 0 || bareTranscript.length === 0) return rawTranscript;

  // Walk transcript characters and align against bare target.
  const result: string[] = [];
  let targetPos = 0;
  let matchCount = 0;

  for (let ti = 0; ti < bareTranscript.length; ti++) {
    const ch = bareTranscript[ti];
    result.push(ch);

    // Advance target pointer: look for this character in the next 5 positions
    // (loose alignment — students may skip or mispronounce a few characters).
    const searchEnd = Math.min(targetPos + 5, bareTarget.length);
    let found = -1;
    for (let si = targetPos; si < searchEnd; si++) {
      if (bareTarget[si] === ch) { found = si; break; }
    }

    if (found !== -1) {
      matchCount++;
      // Insert any punctuation that follows this position in the original text.
      const origIdx = targetMap[found];
      const punct = punctAfter(targetText, origIdx);
      if (punct) result.push(punct);
      targetPos = found + 1;
    }
  }

  // Confidence check: if less than 50% of transcript chars matched the target,
  // return raw transcript (too much divergence — don't mangle the display).
  const confidence = matchCount / bareTranscript.length;
  if (confidence < 0.5) return rawTranscript;

  return result.join('');
}
