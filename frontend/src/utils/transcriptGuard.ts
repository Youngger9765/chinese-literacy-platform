/**
 * Guard against Gemini audio transcription over-filling text the student did not read.
 * When the model sees target_text as a hint it may output the full lesson line even
 * when the audio only contains the opening phrase — which makes every char look "correct".
 */
import { cleanChineseText, normalizeForComparison } from './textDiff';

/** Absolute slack before we distrust Gemini over Web Speech. */
const EXTRA_CHARS_TOLERANCE = 2;

/**
 * If Gemini normalized length exceeds Web Speech by more than this fraction, prefer Web Speech.
 * e.g. webspeech=7, gemini=28 → ratio ~4 → clamp.
 */
const EXTRA_LENGTH_RATIO = 1.5;

/**
 * Pick the transcript to feed scoring / diff display.
 * `preferred` is usually Gemini; `webspeechFallback` is browser STT at stop time.
 */
export function pickConservativeTranscript(
  preferred: string,
  webspeechFallback: string,
  targetText: string,
): string {
  const preferredNorm = normalizeForComparison(cleanChineseText(preferred));
  const fallbackNorm = normalizeForComparison(cleanChineseText(webspeechFallback));
  const targetNorm = normalizeForComparison(targetText);

  if (!fallbackNorm) return preferred;
  if (!preferredNorm) return webspeechFallback;

  const extraChars = preferredNorm.length - fallbackNorm.length;
  const ratio =
    fallbackNorm.length > 0 ? preferredNorm.length / fallbackNorm.length : Infinity;

  // Gemini ≈ full paragraph but Web Speech only caught the opening → classic over-transcribe.
  const suspiciousFullParagraph =
    targetNorm.length >= 8 &&
    preferredNorm.length >= targetNorm.length * 0.9 &&
    fallbackNorm.length <= targetNorm.length * 0.6;

  const suspiciousLength =
    extraChars > EXTRA_CHARS_TOLERANCE &&
    (ratio >= EXTRA_LENGTH_RATIO || extraChars >= Math.max(5, Math.floor(targetNorm.length * 0.25)));

  if (suspiciousFullParagraph || suspiciousLength) {
    return webspeechFallback;
  }

  return preferred;
}
