import { DiffToken } from '../../../types';
import type { LocalEvalResult } from '../../../utils/localEval';

/* ------------------------------------------------------------------ */
/*  Shared types used across LiveTutor sub-components                  */
/* ------------------------------------------------------------------ */

export interface LineResult {
  lineIndex: number;
  matchRate: number;
  cpm: number;
  durationMs: number;
  transcript: string;
  diffTokens: DiffToken[];
}

/** Latest result wins when the same paragraph was evaluated more than once. */
export function getLineResultForParagraph(
  lineResults: LineResult[],
  lineIndex: number,
): LineResult | undefined {
  for (let i = lineResults.length - 1; i >= 0; i--) {
    if (lineResults[i].lineIndex === lineIndex) return lineResults[i];
  }
  return undefined;
}

export type ParagraphSummaryData = {
  feedback: string;
  matchRate: number;
  wrongCount: number;
  missingCount: number;
  tier: number;
  geminiPending: boolean;
  /** Per-sentence evaluation results (populated after paragraph completes) */
  sentenceResults?: Array<LocalEvalResult | null>;
  /** Per-sentence target texts (populated after paragraph completes) */
  sentenceTargets?: string[];
};
