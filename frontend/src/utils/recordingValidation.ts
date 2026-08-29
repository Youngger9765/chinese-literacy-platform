/**
 * recordingValidation.ts — Issue #2362
 *
 * Shared "①.5 Recording Validation" layer that sits between ① Recording and
 * ② STT Transcription for BOTH ParagraphReading (per-paragraph) and KeyPassageReading
 * (full text).
 *
 * Previously the silence gate existed only in useKeyPassageReadingSession.ts (#2321).
 * ParagraphReading had no front-end guard and sent silent audio straight to Gemini,
 * allowing hallucinations to pass the hallucination-prefix backend gate
 * (which only fires when transcript ≥ 35% length of target).
 *
 * Constants are the single source of truth; both hooks import from here.
 */

/** Peak volume (0–1) from AnalyserNode below which we consider the recording silent.
 *  0.05 ≈ 6.4 / 128 byte value — well below conversational speech (~0.15–0.4)
 *  but above true digital silence.  Conservative so we do not block soft readers. */
export const SILENT_PEAK_THRESHOLD = 0.05;

/** Minimum recording duration (ms) below which we skip STT.
 *  1 500 ms is longer than an accidental tap but shorter than a single Chinese
 *  syllable at slow reading pace (~300–400 ms per character × 1 character). */
export const SILENT_MIN_DURATION_MS = 1500;

export type ValidationFailReason = 'silent' | 'too_short';

export interface RecordingValidationResult {
  ok: boolean;
  reason: ValidationFailReason | null;
}

/**
 * Validate a completed recording before sending it to STT.
 *
 * Returns { ok: true, reason: null } if the recording appears to contain speech.
 * Returns { ok: false, reason: 'silent' | 'too_short' } otherwise.
 *
 * @param opts.peakVolume  - peak volume (0–1) from audioRecorder.getPeakVolume()
 * @param opts.durationMs  - actual recording duration in milliseconds
 */
export function validateRecording(opts: {
  peakVolume: number;
  durationMs: number;
}): RecordingValidationResult {
  const { peakVolume, durationMs } = opts;

  if (durationMs < SILENT_MIN_DURATION_MS) {
    return { ok: false, reason: 'too_short' };
  }

  if (peakVolume < SILENT_PEAK_THRESHOLD) {
    return { ok: false, reason: 'silent' };
  }

  return { ok: true, reason: null };
}
