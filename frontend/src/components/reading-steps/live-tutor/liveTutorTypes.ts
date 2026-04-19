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
