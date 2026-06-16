import type { DiffToken } from '../../../types';
import type { EvalAction } from './hooks/useParagraphEvaluation';
import type { LineResult, ParagraphSummaryData } from './liveTutorTypes';

export type ParagraphEvalRestorePlan =
  | { kind: 'clear' }
  | {
      kind: 'restore';
      dispatchAction: EvalAction;
      sentenceResults: Array<import('../../../utils/localEval').LocalEvalResult | null>;
      nextSentenceIdx: number;
      lastFinalResultIdx: number;
    };

/** Decide how to restore eval + per-sentence state when revisiting a scored paragraph. */
export function planParagraphEvalRestore(
  existingResult: LineResult | undefined,
  existingSummary: ParagraphSummaryData | undefined,
  targetsLength: number,
): ParagraphEvalRestorePlan {
  if (existingResult && existingSummary) {
    const sentenceResults = existingSummary.sentenceResults
      ? [...existingSummary.sentenceResults]
      : new Array(targetsLength).fill(null);
    const dispatchAction: EvalAction = existingSummary.geminiPending
      ? { type: 'START_LOCAL', diffTokens: existingResult.diffTokens }
      : { type: 'GEMINI_DONE', diffTokens: existingResult.diffTokens };
    return {
      kind: 'restore',
      dispatchAction,
      sentenceResults,
      nextSentenceIdx: targetsLength,
      lastFinalResultIdx: targetsLength - 1,
    };
  }
  return { kind: 'clear' };
}

/** When eval state was cleared on revisit, fall back to persisted line result diff. */
export function resolveDisplayLastDiffTokens(
  lastDiffTokens: DiffToken[] | null,
  paragraphSummary: ParagraphSummaryData | null,
  savedLineResult: LineResult | undefined,
): DiffToken[] | null {
  return lastDiffTokens ?? (paragraphSummary ? savedLineResult?.diffTokens ?? null : null);
}
