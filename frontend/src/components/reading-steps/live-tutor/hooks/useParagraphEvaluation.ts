import { useCallback, useRef } from 'react';
import { DiffToken, Story } from '../../../../types';
import { normalizeForComparison, cleanChineseText } from '../../../../utils/textDiff';
import { READING_EXCELLENT } from '../../../../utils/personaConfig';
import { evaluateReading } from '../../../../services/learningApi';
import { useAuth } from '../../../../contexts/AuthContext';
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
import { LineResult, ParagraphSummaryData } from '../liveTutorTypes';

/* ─────────────────────────────────────────────────────────────────────────
 * Evaluation state machine using useReducer
 * ─────────────────────────────────────────────────────────────────────── */

export type EvalPhase =
  | 'idle'          // no evaluation in progress
  | 'local_done'    // local eval finished, Gemini pending
  | 'gemini_done'   // Gemini returned
  | 'gemini_error'; // Gemini failed (local result stands)

export interface EvalState {
  phase: EvalPhase;
  isAwaitingGemini: boolean;
  retryCount: number;
  streak: number;
  lastDiffTokens: DiffToken[] | null;
  realtimeDiffTokens: DiffToken[] | null;
  streamingUserInput: string;
}

export type EvalAction =
  | { type: 'START_LOCAL'; diffTokens: DiffToken[] }
  | { type: 'GEMINI_DONE'; diffTokens: DiffToken[] }
  | { type: 'GEMINI_ERROR' }
  | { type: 'INCREMENT_RETRY' }
  | { type: 'INCREMENT_STREAK' }
  | { type: 'RESET_RETRY' }
  | { type: 'SET_REALTIME_DIFF'; tokens: DiffToken[] | null }
  | { type: 'SET_STREAMING'; value: string }
  | { type: 'CLEAR_FOR_PARAGRAPH' };

export function evalReducer(state: EvalState, action: EvalAction): EvalState {
  switch (action.type) {
    case 'START_LOCAL':
      return {
        ...state,
        phase: 'local_done',
        isAwaitingGemini: true,
        lastDiffTokens: action.diffTokens,
      };
    case 'GEMINI_DONE':
      return {
        ...state,
        phase: 'gemini_done',
        isAwaitingGemini: false,
        lastDiffTokens: action.diffTokens,
      };
    case 'GEMINI_ERROR':
      return { ...state, phase: 'gemini_error', isAwaitingGemini: false };
    case 'INCREMENT_RETRY':
      return { ...state, retryCount: state.retryCount + 1 };
    case 'INCREMENT_STREAK':
      return { ...state, streak: state.streak + 1 };
    case 'RESET_RETRY':
      return { ...state, retryCount: 0 };
    case 'SET_REALTIME_DIFF':
      return { ...state, realtimeDiffTokens: action.tokens };
    case 'SET_STREAMING':
      return { ...state, streamingUserInput: action.value };
    case 'CLEAR_FOR_PARAGRAPH':
      return {
        ...state,
        phase: 'idle',
        lastDiffTokens: null,
        realtimeDiffTokens: null,
        streamingUserInput: '',
        isAwaitingGemini: false,
      };
    default:
      return state;
  }
}

export const initialEvalState: EvalState = {
  phase: 'idle',
  isAwaitingGemini: false,
  retryCount: 0,
  streak: 0,
  lastDiffTokens: null,
  realtimeDiffTokens: null,
  streamingUserInput: '',
};

/* ─────────────────────────────────────────────────────────────────────────
 * Hook
 * ─────────────────────────────────────────────────────────────────────── */

export interface UseParagraphEvaluationParams {
  story: Story;
  evalState: EvalState;
  dispatch: React.Dispatch<EvalAction>;
  sentenceTargetsRef: React.MutableRefObject<string[]>;
  sentenceResultsRef: React.MutableRefObject<Array<LocalEvalResult | null>>;
  streakRef: React.MutableRefObject<number>;
  lineResults: LineResult[];
  setLineResults: React.Dispatch<React.SetStateAction<LineResult[]>>;
  setParagraphSummaries: React.Dispatch<React.SetStateAction<Record<number, ParagraphSummaryData>>>;
  advanceParagraph: (lineIdx: number, allResults: LineResult[], stopSession: () => void) => void;
  stopSession: () => void;
}

export function useParagraphEvaluation({
  story,
  evalState,
  dispatch,
  sentenceTargetsRef,
  sentenceResultsRef,
  streakRef,
  lineResults,
  setLineResults,
  setParagraphSummaries,
  advanceParagraph,
  stopSession,
}: UseParagraphEvaluationParams) {
  const { token } = useAuth();
  const geminiGenRef = useRef(0);
  const geminiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const evaluateAndRespond = useCallback(
    async (
      rawTranscript: string,
      _rawStt: string,
      durationMs: number,
      lineIdx: number,
      /** I1 (P1#4): caller must declare transcript source.
       *  'gemini' → skip sentenceResults aggregation; evaluate whole paragraph directly.
       *  'webspeech' → may use sentenceResults aggregation (existing behavior). */
      source: 'gemini' | 'webspeech' = 'webspeech',
    ) => {
      const targetText = story.content[lineIdx] || '';
      const cleaned = cleanChineseText(rawTranscript);

      // No speech detected
      if (!cleaned) {
        stopSession();
        const normalizedTarget = normalizeForComparison(targetText);
        const targetLen = normalizedTarget.length;
        const emptyDiffTokens: DiffToken[] = Array.from(normalizedTarget).map((ch) => ({
          char: ch,
          type: 'missing' as const,
        }));
        setParagraphSummaries((prev) => ({
          ...prev,
          [lineIdx]: {
            feedback: '好像沒有偵測到聲音，請再試一次吧！',
            matchRate: 0,
            wrongCount: 0,
            missingCount: targetLen,
            tier: 3 as const,
            geminiPending: false,
          },
        }));
        dispatch({ type: 'START_LOCAL', diffTokens: emptyDiffTokens });
        dispatch({ type: 'GEMINI_ERROR' }); // immediately resolve — no Gemini call
        dispatch({ type: 'SET_STREAMING', value: '' });
        return;
      }

      // ── Phase 1: local eval ─────────────────────────────────────────────
      // I1 (P1#4): When transcript comes from Gemini, skip sentenceResults
      // aggregation entirely — it contains per-sentence Web Speech results which
      // would pollute the Gemini-sourced transcript.  Evaluate the full paragraph
      // against the Gemini transcript directly.
      let localTier: 1 | 2 | 3;
      let localDiffTokens: DiffToken[];
      let localFeedback: string;
      let localMatchRate: number;
      let localCpm: number;

      if (source === 'gemini') {
        // Gemini path: whole-paragraph evaluation — no sentenceResults mixing.
        const localResult = localEvaluateParagraph(
          cleaned,
          targetText,
          durationMs,
          {
            tier1: TIER1_POOL,
            tier2: TIER2_POOL,
            tier3: TIER3_POOL,
            streakMsgs: STREAK_MESSAGES,
          },
          evalState.streak,
        );
        localTier = localResult.tier;
        localDiffTokens = localResult.diffTokens;
        localFeedback = localResult.feedback;
        localMatchRate = localResult.matchRate;
        localCpm = localResult.cpm;
      } else {
        // Web Speech path: may aggregate sentenceResults if enough were collected.
        const sentResults = sentenceResultsRef.current.filter(
          Boolean,
        ) as LocalEvalResult[];

        const totalSentences = sentenceTargetsRef.current.length;
        if (
          sentResults.length > 0 &&
          sentResults.length >= Math.ceil(totalSentences / 2)
        ) {
          const allDiff = sentResults.flatMap((r) => r.diffTokens);
          const correctAndForgiven = allDiff.filter(
            (t) => t.type === 'correct' || t.type === 'forgiven',
          ).length;
          const totalTarget = normalizeForComparison(targetText).length || 1;
          localMatchRate = correctAndForgiven / totalTarget;
          const threshold = getReadingPassThreshold(totalTarget);
          localTier =
            localMatchRate >= READING_EXCELLENT
              ? 1
              : localMatchRate >= threshold
              ? 2
              : 3;
          localDiffTokens = allDiff;
          localFeedback = sentResults[sentResults.length - 1].feedback;
          localCpm = Math.round(
            sentResults.reduce((s, r) => s + r.cpm, 0) / sentResults.length,
          );
        } else {
          const localResult = localEvaluateParagraph(
            cleaned,
            targetText,
            durationMs,
            {
              tier1: TIER1_POOL,
              tier2: TIER2_POOL,
              tier3: TIER3_POOL,
              streakMsgs: STREAK_MESSAGES,
            },
            evalState.streak,
          );
          localTier = localResult.tier;
          localDiffTokens = localResult.diffTokens;
          localFeedback = localResult.feedback;
          localMatchRate = localResult.matchRate;
          localCpm = localResult.cpm;
        }
      }

      dispatch({ type: 'START_LOCAL', diffTokens: localDiffTokens });

      if (import.meta.env.DEV) {
        console.group('%c[Evaluation] Hybrid', 'color: cyan; font-weight: bold');
        console.log('Line:', lineIdx, '/', story.content.length - 1);
        console.log('Target:', targetText, '| cleaned:', cleaned);
        console.log(
          'Local tier:',
          localTier,
          '| match:',
          (localMatchRate * 100).toFixed(1) + '%',
          '| cpm:',
          localCpm,
        );
        console.groupEnd();
      }

      // ── Retry cap ──────────────────────────────────────────────────────
      if (localTier === 3 && evalState.retryCount >= 2) {
        stopSession();
        dispatch({ type: 'SET_STREAMING', value: '' });
        dispatch({ type: 'RESET_RETRY' });
        const capResult: LineResult = {
          lineIndex: lineIdx,
          matchRate: localMatchRate,
          cpm: localCpm,
          durationMs,
          transcript: cleaned,
          diffTokens: localDiffTokens,
        };
        const allResults = [...lineResults, capResult];
        setLineResults(allResults);
        dispatch({ type: 'GEMINI_ERROR' });
        advanceParagraph(lineIdx, allResults, stopSession);
        return;
      }

      // ── Phase 2: show summary + call Gemini ───────────────────────────
      const localResult: LineResult = {
        lineIndex: lineIdx,
        matchRate: localMatchRate,
        cpm: localCpm,
        durationMs,
        transcript: cleaned,
        diffTokens: localDiffTokens,
      };
      const allResults = [...lineResults, localResult];
      setLineResults(allResults);
      dispatch({ type: 'SET_STREAMING', value: '' });

      const wrongCount = localDiffTokens.filter((t) => t.type === 'wrong').length;
      const missingCount = localDiffTokens.filter((t) => t.type === 'missing').length;

      stopSession();

      // Fill nulls for unevaluated sentences
      const filledSentenceResults = sentenceResultsRef.current.map((result, si) => {
        if (result !== null) return result;
        const sentTarget = sentenceTargetsRef.current[si];
        if (!sentTarget) return null;
        return localEvaluateParagraph(
          cleaned,
          sentTarget,
          durationMs,
          {
            tier1: TIER1_POOL,
            tier2: TIER2_POOL,
            tier3: TIER3_POOL,
            streakMsgs: STREAK_MESSAGES,
          },
          evalState.streak,
        );
      });

      const summaryData: ParagraphSummaryData = {
        feedback:
          localTier <= 2
            ? localFeedback || '唸得不錯！'
            : localFeedback || '再試一次，加油！',
        matchRate: localMatchRate,
        wrongCount,
        missingCount,
        tier: localTier,
        geminiPending: true,
        sentenceResults: [...filledSentenceResults],
        sentenceTargets: [...sentenceTargetsRef.current],
      };
      setParagraphSummaries((prev) => ({ ...prev, [lineIdx]: summaryData }));

      if (localTier <= 2) {
        dispatch({ type: 'INCREMENT_STREAK' });
        dispatch({ type: 'RESET_RETRY' });
      } else {
        dispatch({ type: 'INCREMENT_RETRY' });
      }

      // ── Async Gemini ──────────────────────────────────────────────────
      const gen = ++geminiGenRef.current;
      if (geminiTimeoutRef.current !== null) {
        clearTimeout(geminiTimeoutRef.current);
        geminiTimeoutRef.current = null;
      }

      void (async () => {
        let localTimeout: ReturnType<typeof setTimeout> | null = null;
        try {
          const gemini = await Promise.race([
            evaluateReading(cleaned, targetText, durationMs, token ?? undefined),
            new Promise<never>((_, reject) => {
              localTimeout = setTimeout(() => reject(new Error('gemini_timeout')), 8000);
              geminiTimeoutRef.current = localTimeout;
            }),
          ]);
          if (localTimeout !== null) clearTimeout(localTimeout);
          if (geminiTimeoutRef.current === localTimeout) geminiTimeoutRef.current = null;
          if (geminiGenRef.current !== gen) return;

          const geminiWrong = (gemini.diff_tokens || []).filter(
            (t: DiffToken) => t.type === 'wrong',
          ).length;
          const geminiMissing = (gemini.diff_tokens || []).filter(
            (t: DiffToken) => t.type === 'missing',
          ).length;
          setParagraphSummaries((prev) => ({
            ...prev,
            [lineIdx]: {
              feedback:
                gemini.feedback ||
                (gemini.tier <= 2 ? '唸得不錯！' : '再試一次，加油！'),
              matchRate: gemini.adjusted_match_rate,
              wrongCount: geminiWrong,
              missingCount: geminiMissing,
              tier: gemini.tier,
              geminiPending: false,
              sentenceResults: prev[lineIdx]?.sentenceResults,
              sentenceTargets: prev[lineIdx]?.sentenceTargets,
            },
          }));
          dispatch({ type: 'GEMINI_DONE', diffTokens: gemini.diff_tokens });

          if (gemini.tier <= 2 && localTier > 2) {
            dispatch({ type: 'INCREMENT_STREAK' });
            dispatch({ type: 'RESET_RETRY' });
            const geminiResult: LineResult = {
              lineIndex: lineIdx,
              matchRate: gemini.adjusted_match_rate,
              cpm: Math.round(gemini.cpm ?? localCpm),
              durationMs,
              transcript: cleaned,
              diffTokens: gemini.diff_tokens,
            };
            setLineResults((prev) => [...prev.slice(0, -1), geminiResult]);
          }
        } catch (err: unknown) {
          if (localTimeout !== null) clearTimeout(localTimeout);
          if (geminiTimeoutRef.current === localTimeout) geminiTimeoutRef.current = null;
          if (geminiGenRef.current !== gen) return;
          setParagraphSummaries((prev) => {
            const existing = prev[lineIdx];
            return existing
              ? { ...prev, [lineIdx]: { ...existing, geminiPending: false } }
              : prev;
          });
          dispatch({ type: 'GEMINI_ERROR' });
          const msg = err instanceof Error ? err.message : '';
          if (msg !== 'gemini_timeout') {
            console.warn('[LiveTutor] Gemini eval failed, local result stands:', err);
          }
        }
      })();
    },
    [
      story,
      evalState.streak,
      evalState.retryCount,
      lineResults,
      token,
      dispatch,
      sentenceTargetsRef,
      sentenceResultsRef,
      setLineResults,
      setParagraphSummaries,
      advanceParagraph,
      stopSession,
    ],
  );

  return {
    evaluateAndRespond,
    geminiGenRef,
    geminiTimeoutRef,
  };
}
