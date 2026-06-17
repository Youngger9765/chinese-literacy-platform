/**
 * Pure transcript selection for Live Tutor paragraph evaluation.
 * Kept separate from the hook so regression tests mirror production logic.
 */
import { cleanChineseText } from './textDiff';
import { pickConservativeTranscript } from './transcriptGuard';

export type TranscriptSource = 'gemini' | 'webspeech';

export function buildTranscriptForEvaluation(input: {
  source: TranscriptSource;
  rawTranscript: string;
  rawStt: string;
  targetText: string;
  durationMs: number;
}): {
  transcriptForEval: string;
  cleaned: string;
  conservativeClampApplied: boolean;
} {
  const { source, rawTranscript, rawStt, targetText, durationMs } = input;
  const transcriptForEval =
    source === 'gemini'
      ? pickConservativeTranscript(rawTranscript, rawStt, targetText, durationMs)
      : rawTranscript;
  const cleaned = cleanChineseText(transcriptForEval);
  return {
    transcriptForEval,
    cleaned,
    conservativeClampApplied: source === 'gemini' && transcriptForEval !== rawTranscript,
  };
}
