import type { DiffToken } from '../../../types';
import type { EvalAction } from './hooks/useParagraphEvaluation';
import type { LineResult, ParagraphSummaryData } from './paragraphReadingTypes';

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

/**
 * When eval state was cleared on revisit, fall back to persisted line result diff.
 * While recording or awaiting 評估/重錄/取消, hide stale results so 完成 does not
 * flash the previous score before the student commits.
 */
export function resolveDisplayLastDiffTokens(
  lastDiffTokens: DiffToken[] | null,
  paragraphSummary: ParagraphSummaryData | null,
  savedLineResult: LineResult | undefined,
  hideStaleEval = false,
): DiffToken[] | null {
  if (hideStaleEval) {
    return null;
  }
  return lastDiffTokens ?? (paragraphSummary ? savedLineResult?.diffTokens ?? null : null);
}

/** Hide persisted summary while a new take is in progress or pending review. */
export function resolveDisplayParagraphSummary(
  paragraphSummary: ParagraphSummaryData | null,
  hideStaleEval: boolean,
): ParagraphSummaryData | null {
  return hideStaleEval ? null : paragraphSummary;
}
