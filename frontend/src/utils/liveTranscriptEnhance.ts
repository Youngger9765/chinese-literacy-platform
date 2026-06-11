/**
 * liveTranscriptEnhance — Issue #2147
 *
 * Enhances a raw Web Speech API transcript in real-time by:
 *   1. Correcting homophone substitutions (e.g. 時刻→食客, 龍奔→狂奔)
 *      using the lesson text as ground truth.
 *   2. Re-inserting punctuation from the lesson text.
 *
 * This runs entirely in the browser — no network calls, fast enough for
 * live streaming updates (each character event from Web Speech API).
 *
 * Returns both a plain string (for scoring / storage) and a structured
 * segment array (for UI rendering with punctuation styled differently).
 *
 * Design constraints:
 *   - Pure functions, no side effects.
 *   - Graceful degradation: any error → return raw unchanged.
 *   - Scoring logic (analyzeFluency / localEvaluateParagraph) is NOT touched;
 *     only the display layer is enhanced.
 */

import { correctHomophones } from './pinyin/match';
import { reinsertPunctuation } from './punctuationReinsert';
import { cleanChineseText } from './textDiff';

/** A segment of the enhanced transcript for styled rendering. */
export interface TranscriptSegment {
  /** The text content of this segment. */
  text: string;
  /**
   * 'spoken'   — characters the student actually spoke (or homophone-corrected)
   * 'inserted' — punctuation inserted from the lesson text (show faded)
   */
  kind: 'spoken' | 'inserted';
}

/**
 * Enhance a raw STT transcript for real-time display.
 *
 * Steps:
 *   1. correctHomophones(rawTranscript, targetBare) — fix e.g. 時刻→食客
 *   2. reinsertPunctuation(corrected, targetText)   — insert 。，！？…
 *   3. Parse into segments so UI can style inserted punctuation differently.
 *
 * @param rawTranscript  - Web Speech transcript (no punctuation, may have homophones)
 * @param targetText     - Original lesson text (with punctuation, ground truth)
 * @returns { plain, segments }
 *   - plain    : full enhanced string (suitable for display as plain text)
 *   - segments : array of { text, kind } for styled rendering
 */
export function enhanceLiveTranscript(
  rawTranscript: string,
  targetText: string,
): { plain: string; segments: TranscriptSegment[] } {
  const fallback = { plain: rawTranscript, segments: [{ text: rawTranscript, kind: 'spoken' as const }] };

  if (!rawTranscript || !targetText) return fallback;

  try {
    // Step 1: Strip punctuation from target for homophone correction
    // (correctHomophones works best without punctuation in target)
    const targetBare = cleanChineseText(targetText);

    // Step 2: Correct homophones using bare target
    const corrected = correctHomophones(rawTranscript, targetBare);

    // Step 3: Re-insert punctuation from the original (punctuated) target
    const withPunct = reinsertPunctuation(corrected, targetText);

    if (!withPunct) return fallback;

    // Step 4: Parse into segments
    // Strategy: walk the corrected string alongside withPunct.
    // Characters that exist in corrected = 'spoken', extras = 'inserted' punctuation.
    const segments = parseSegments(corrected, withPunct);

    return { plain: withPunct, segments };
  } catch {
    return fallback;
  }
}

/**
 * Parse the enhanced string into spoken vs inserted segments.
 *
 * We walk both strings in parallel:
 * - When the character from `enhanced` matches the next char in `spoken`,
 *   it's a spoken character.
 * - Otherwise it's an inserted character (punctuation from the lesson text).
 */
function parseSegments(spoken: string, enhanced: string): TranscriptSegment[] {
  if (!enhanced) return [];

  const segments: TranscriptSegment[] = [];
  let si = 0; // pointer into spoken
  let currentText = '';
  let currentKind: 'spoken' | 'inserted' = 'spoken';

  for (let ei = 0; ei < enhanced.length; ei++) {
    const ch = enhanced[ei];
    const isSpoken = si < spoken.length && spoken[si] === ch;

    if (isSpoken) {
      if (currentKind === 'spoken') {
        currentText += ch;
      } else {
        if (currentText) segments.push({ text: currentText, kind: 'inserted' });
        currentText = ch;
        currentKind = 'spoken';
      }
      si++;
    } else {
      // Inserted character (punctuation)
      if (currentKind === 'inserted') {
        currentText += ch;
      } else {
        if (currentText) segments.push({ text: currentText, kind: 'spoken' });
        currentText = ch;
        currentKind = 'inserted';
      }
    }
  }

  if (currentText) segments.push({ text: currentText, kind: currentKind });

  return segments;
}
