import { useState, useRef, useCallback } from 'react';
import { DiffToken } from '../../../../types';
import { cleanChineseText, normalizeForComparison } from '../../../../utils/textDiff';
import {
  localEvaluateParagraph,
  splitIntoSentences,
  getReadingPassThreshold,
  type LocalEvalResult,
} from '../../../../utils/localEval';
import {
  TIER1_POOL,
  TIER2_POOL,
  TIER3_POOL,
  STREAK_MESSAGES,
} from '../../../../utils/liveTutorPools';
import { CHINESE_PUNCTUATION_REGEX } from '../../../../utils/liveTutorHelpers';
import { READING_EXCELLENT } from '../../../../utils/personaConfig';
import { ParagraphSummaryData, LineResult } from '../paragraphReadingTypes';
import { EvalAction } from './useParagraphEvaluation';

/* ─────────────────────────────────────────────────────────────────────────
 * Types
 * ─────────────────────────────────────────────────────────────────────── */

export interface RetrySentenceInfo {
  paragraphIdx: number;
  sentenceIdx: number;
  target: string;
  originalTargets: string[];
  originalResults: Array<LocalEvalResult | null>;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Hook
 * ─────────────────────────────────────────────────────────────────────── */

export interface UseSentenceRetryParams {
  storyContent: string[];
  currentLineIndex: number;
  sentenceTargetsRef: React.MutableRefObject<string[]>;
  sentenceResultsRef: React.MutableRefObject<Array<LocalEvalResult | null>>;
  nextSentenceIdxRef: React.MutableRefObject<number>;
  lastFinalResultIdxRef: React.MutableRefObject<number>;
  streakRef: React.MutableRefObject<number>;
  dispatch: React.Dispatch<EvalAction>;
  setParagraphSummaries: React.Dispatch<React.SetStateAction<Record<number, ParagraphSummaryData>>>;
  setLineResults: React.Dispatch<React.SetStateAction<LineResult[]>>;
  stopSession: () => void;
  startSession: () => void;
}

export function useSentenceRetry({
  storyContent,
  currentLineIndex,
  sentenceTargetsRef,
  sentenceResultsRef,
  nextSentenceIdxRef,
  lastFinalResultIdxRef,
  streakRef,
  dispatch,
  setParagraphSummaries,
  setLineResults,
  stopSession,
  startSession,
}: UseSentenceRetryParams) {
  const [retrySentenceInfo, setRetrySentenceInfo] = useState<RetrySentenceInfo | null>(null);
  const retrySentenceInfoRef = useRef<RetrySentenceInfo | null>(null);

  // Keep ref in sync
  retrySentenceInfoRef.current = retrySentenceInfo;

  /** Enter single-sentence retry mode (#1076) */
  const handleRetrySentence = useCallback(
    (paragraphIdx: number, sentenceIdx: number) => {
      if (paragraphIdx !== currentLineIndex) {
        console.warn('[ParagraphReading] handleRetrySentence: paragraphIdx mismatch', {
          paragraphIdx,
          currentLineIndex,
        });
        return;
      }
      stopSession();

      const sentences = splitIntoSentences(storyContent[paragraphIdx] || '');
      const target = sentences[sentenceIdx];
      // Don't retry single-char sentences (issue 661)
      if (!target || target.replace(CHINESE_PUNCTUATION_REGEX, '').length <= 1) {
        console.warn('[ParagraphReading] handleRetrySentence: skipping short sentence', {
          sentenceIdx,
          target,
        });
        return;
      }

      const info: RetrySentenceInfo = {
        paragraphIdx,
        sentenceIdx,
        target,
        originalTargets: [...sentenceTargetsRef.current],
        originalResults: [...sentenceResultsRef.current],
      };
      retrySentenceInfoRef.current = info;
      setRetrySentenceInfo(info);

      // Narrow sentence refs to just this sentence
      sentenceTargetsRef.current = [target];
      sentenceResultsRef.current = [null];
      nextSentenceIdxRef.current = 0;
      lastFinalResultIdxRef.current = -1;
      dispatch({ type: 'CLEAR_FOR_PARAGRAPH' });

      setTimeout(() => startSession(), 100);
    },
    [
      currentLineIndex,
      storyContent,
      sentenceTargetsRef,
      sentenceResultsRef,
      nextSentenceIdxRef,
      lastFinalResultIdxRef,
      dispatch,
      stopSession,
      startSession,
    ],
  );

  /** Evaluate single-sentence retry result (#1076) */
  const handleSentenceRetryEval = useCallback(
    async (transcript: string, durationMs: number) => {
      const info = retrySentenceInfoRef.current;
      if (!info) return;

      stopSession();
      const cleaned = cleanChineseText(transcript);

      // No speech — stay in retry mode
      if (!cleaned) {
        setTimeout(() => startSession(), 100);
        return;
      }

      // Restore original sentence refs
      sentenceTargetsRef.current = info.originalTargets;
      const newResults = [...info.originalResults];

      const localResult = localEvaluateParagraph(
        cleaned,
        info.target,
        durationMs,
        {
          tier1: TIER1_POOL,
          tier2: TIER2_POOL,
          tier3: TIER3_POOL,
          streakMsgs: STREAK_MESSAGES,
        },
        streakRef.current,
      );
      newResults[info.sentenceIdx] = localResult;
      dispatch({ type: 'START_LOCAL', diffTokens: localResult.diffTokens });
      dispatch({ type: 'SET_REALTIME_DIFF', tokens: null });

      sentenceResultsRef.current = newResults;
      nextSentenceIdxRef.current = info.originalTargets.length;
      retrySentenceInfoRef.current = null;
      setRetrySentenceInfo(null);

      // Weighted delta: only update the retried sentence's contribution
      const paragraphTarget = storyContent[info.paragraphIdx] || '';
      const paragraphLen = normalizeForComparison(paragraphTarget).length || 1;
      const sentenceLen = normalizeForComparison(info.target).length;
      const sentenceWeight = sentenceLen / paragraphLen;

      const sentenceMatchRateFromResult =
        info.originalResults[info.sentenceIdx]?.matchRate;
      const newSentenceMatchRate = localResult?.matchRate;

      const oldWrong =
        info.originalResults[info.sentenceIdx]?.diffTokens.filter(
          (t: DiffToken) => t.type === 'wrong',
        ).length ?? 0;
      const oldMissing =
        info.originalResults[info.sentenceIdx]?.diffTokens.filter(
          (t: DiffToken) => t.type === 'missing',
        ).length ?? 0;
      const newWrong =
        localResult?.diffTokens.filter((t: DiffToken) => t.type === 'wrong').length ?? oldWrong;
      const newMissing =
        localResult?.diffTokens.filter((t: DiffToken) => t.type === 'missing').length ??
        oldMissing;

      setParagraphSummaries((prev) => {
        const existing = prev[info.paragraphIdx];
        if (!existing) return prev;
        const oldSentenceMatchRate = sentenceMatchRateFromResult ?? existing.matchRate;
        const effectiveNewRate = newSentenceMatchRate ?? oldSentenceMatchRate;
        const newMatchRate = Math.max(
          0,
          Math.min(
            1,
            existing.matchRate -
              oldSentenceMatchRate * sentenceWeight +
              effectiveNewRate * sentenceWeight,
          ),
        );
        const threshold = getReadingPassThreshold(paragraphLen);
        const newTier = (
          newMatchRate >= READING_EXCELLENT ? 1 : newMatchRate >= threshold ? 2 : 3
        ) as 1 | 2 | 3;
        return {
          ...prev,
          [info.paragraphIdx]: {
            ...existing,
            matchRate: newMatchRate,
            wrongCount: Math.max(0, existing.wrongCount - oldWrong + newWrong),
            missingCount: Math.max(0, existing.missingCount - oldMissing + newMissing),
            tier: newTier,
            sentenceResults: newResults,
            geminiPending: false,
          },
        };
      });

      setLineResults((prev) => {
        let idx = -1;
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].lineIndex === info.paragraphIdx) {
            idx = i;
            break;
          }
        }
        if (idx === -1) return prev;
        const updated = [...prev];
        const oldSentenceMatchRate =
          sentenceMatchRateFromResult ?? updated[idx].matchRate;
        const effectiveNewRate = newSentenceMatchRate ?? oldSentenceMatchRate;
        const newMatchRate = Math.max(
          0,
          Math.min(
            1,
            updated[idx].matchRate -
              oldSentenceMatchRate * sentenceWeight +
              effectiveNewRate * sentenceWeight,
          ),
        );
        updated[idx] = { ...updated[idx], matchRate: newMatchRate };
        return updated;
      });
      dispatch({ type: 'GEMINI_DONE', diffTokens: localResult.diffTokens });
    },
    [
      storyContent,
      sentenceTargetsRef,
      sentenceResultsRef,
      nextSentenceIdxRef,
      streakRef,
      dispatch,
      setParagraphSummaries,
      setLineResults,
      stopSession,
      startSession,
    ],
  );

  const clearRetrySentence = useCallback(() => {
    retrySentenceInfoRef.current = null;
    setRetrySentenceInfo(null);
  }, []);

  return {
    retrySentenceInfo,
    retrySentenceInfoRef,
    handleRetrySentence,
    handleSentenceRetryEval,
    clearRetrySentence,
  };
}
