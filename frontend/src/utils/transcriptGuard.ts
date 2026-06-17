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

/** Generous upper-bound CPM for elementary oral reading (norm chars / min). */
const MAX_PLAUSIBLE_CPM = 420;
const CPM_SLACK = 1.25;

/** Minimum normalized chars to keep after duration cap (avoid empty false negatives). */
const MIN_TRUNCATED_NORM = 3;

/**
 * Web Speech must align with the target opening before we let it override Gemini.
 * Garbled / lagging browser STT often ends mid-paragraph with a low prefix match —
 * that is not evidence the student stopped reading.
 */
const RELIABLE_ANCHOR_PREFIX_MATCH = 0.75;

function prefixMatchRate(spokenNorm: string, targetNorm: string): number {
  if (!spokenNorm) return 0;
  const targetPrefix = targetNorm.slice(0, spokenNorm.length);
  const spoken = Array.from(spokenNorm);
  const target = Array.from(targetPrefix);
  if (target.length < spoken.length * 0.5) return 0;
  let matches = 0;
  for (let i = 0; i < spoken.length; i++) {
    if (spoken[i] === target[i]) matches++;
  }
  return matches / spoken.length;
}

function isReliableWebspeechAnchor(fallbackNorm: string, targetNorm: string): boolean {
  if (fallbackNorm.length < 2) return false;
  return prefixMatchRate(fallbackNorm, targetNorm) >= RELIABLE_ANCHOR_PREFIX_MATCH;
}

export function maxPlausibleNormChars(durationMs: number | undefined): number {
  if (!durationMs || durationMs <= 0) return 0;
  const minutes = durationMs / 60000;
  return Math.max(1, Math.ceil(minutes * MAX_PLAUSIBLE_CPM * CPM_SLACK));
}

/** Trim raw transcript so its normalized length does not exceed maxNormLen. */
export function truncateTranscriptToNormLength(text: string, maxNormLen: number): string {
  if (maxNormLen <= 0) return '';
  const chars = Array.from(text);
  let best = '';
  for (let i = 0; i < chars.length; i++) {
    const prefix = chars.slice(0, i + 1).join('');
    const normLen = normalizeForComparison(cleanChineseText(prefix)).length;
    if (normLen > maxNormLen) break;
    best = prefix;
  }
  return best;
}

function capGeminiWithoutWebspeechCorroboration(
  preferred: string,
  webspeechFallback: string,
  targetNorm: string,
  preferredNorm: string,
  durationMs: number | undefined,
): string {
  if (!preferredNorm) return webspeechFallback;

  const maxNorm = maxPlausibleNormChars(durationMs);
  const looksLikeFullPaste =
    targetNorm.length >= 8 && preferredNorm.length >= targetNorm.length * 0.9;

  const exceedsDuration = maxNorm > 0 && preferredNorm.length > maxNorm;

  if (!looksLikeFullPaste && !exceedsDuration) {
    return preferred;
  }

  // No Web Speech anchor: cap by recording length, or reject full paste when duration unknown.
  if (maxNorm > 0) {
    const truncated = truncateTranscriptToNormLength(preferred, maxNorm);
    const truncatedNorm = normalizeForComparison(cleanChineseText(truncated));
    if (truncatedNorm.length >= MIN_TRUNCATED_NORM) return truncated;
    return webspeechFallback;
  }

  if (looksLikeFullPaste) {
    return webspeechFallback;
  }

  return preferred;
}

/**
 * Pick the transcript to feed scoring / diff display.
 * `preferred` is usually Gemini; `webspeechFallback` is browser STT at stop time.
 */
export function pickConservativeTranscript(
  preferred: string,
  webspeechFallback: string,
  targetText: string,
  durationMs?: number,
): string {
  const preferredNorm = normalizeForComparison(cleanChineseText(preferred));
  const fallbackNorm = normalizeForComparison(cleanChineseText(webspeechFallback));
  const targetNorm = normalizeForComparison(targetText);

  if (!fallbackNorm) {
    return capGeminiWithoutWebspeechCorroboration(
      preferred,
      webspeechFallback,
      targetNorm,
      preferredNorm,
      durationMs,
    );
  }
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
    // Only trust Web Speech when it cleanly tracks the lesson opening (partial read).
    if (isReliableWebspeechAnchor(fallbackNorm, targetNorm)) {
      return webspeechFallback;
    }

    const maxNorm = maxPlausibleNormChars(durationMs);
    if (maxNorm > 0 && preferredNorm.length <= maxNorm) {
      return preferred;
    }

    if (maxNorm > 0) {
      const truncated = truncateTranscriptToNormLength(preferred, maxNorm);
      const truncatedNorm = normalizeForComparison(cleanChineseText(truncated));
      if (truncatedNorm.length >= MIN_TRUNCATED_NORM) return truncated;
    }

    return preferred;
  }

  return preferred;
}
