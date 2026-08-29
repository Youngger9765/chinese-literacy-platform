/**
 * useLearningStepNavigation.ts — Refactored composer hook (Issue #1954)
 *
 * Previous: 520 LOC monolith with all transition logic inlined.
 * After:    ~220 LOC composer that delegates to:
 *
 *   - stepNavigationTransitions.ts — STEP_FINISH_TRANSITIONS table + getDefaultNextStep()
 *   - stepHandlerUtils.ts          — buildStepFinishPayload() pure helper
 *
 * Public interface (UseLearningStepNavigationReturn) is unchanged — no call-site changes needed.
 */

import { useCallback, useEffect, useRef } from 'react';
import { stepPath } from '../config/stepPath';
import useCurrentStepId from './useCurrentStepId';
import type { Dispatch, SetStateAction } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { AuthUser } from '../services/authApi';
import { completeSelfPracticeSession, SessionExpiredError, type StepProgressData } from '../services/learningApi';
import { submitAssignment } from '../services/assignmentApi';
import { STEP_PATH_TO_NUMBER } from '../config/stepConfig';
import { isToolboxMode } from '../services/learningStorageScope';
import type { ListeningResult } from '../components/reading-steps/ListeningPractice';
import type { AnnotationSummary } from '../components/reading-steps/FullTextAnnotate';
import type { VocabApplicationResult } from '../components/reading-steps/VocabApplication';
import type { VocabDefinitionMatchResult } from '../components/reading-steps/VocabDefinitionMatch';
import type {
  ComprehensionResult,
  DictationResult,
  KeyPassageReadingResult,
  LearningSession,
  ReadingAttempt,
  Story,
  VocabResult,
} from '../types';
import { buildStepFinishPayload } from './stepHandlerUtils';
import { lessonAwareNextStep } from './lessonAwareStepTransition';

const ACTIVE_ASSIGNMENT_CONTEXT_KEY = 'activeAssignmentContext';
const SELF_PRACTICE_COMPLETED_KEY_PREFIX = 'self-practice-completed-';

interface PersistStepProgressOptions {
  currentStep?: string | null;
  completeStep?: string;
  stepDataPatch?: Record<string, unknown>;
}

interface UseLearningStepNavigationOptions {
  storyId: string | undefined;
  selectedStory: Story | null;
  token: string | null;
  user: AuthUser | null;
  dbSessionId: number | null;
  hasActiveAssignment: boolean;
  isAssignmentReadyForSubmit: boolean;
  navigate: NavigateFunction;
  setSession: Dispatch<SetStateAction<LearningSession | null>>;
  setLastAttempt: Dispatch<SetStateAction<ReadingAttempt | null>>;
  setSelectedStory: Dispatch<SetStateAction<Story | null>>;
  persistStepProgressState: (opts: PersistStepProgressOptions, immediate: boolean) => void;
  persistStep: (step: number) => void;
  clearPersistedSession: () => void;
  ensureDbSession: () => void;
}

interface UseLearningStepNavigationReturn {
  handleStartReading: () => void;
  handleFinishReading: (attempt: ReadingAttempt) => void;
  handleFinishComprehension: (result: ComprehensionResult) => void;
  handleFinishStoryStructure: () => void;
  handleFinishReadingStrategy: () => void;
  handleFinishVocab: (result: VocabResult) => void;
  handleFinishDictation: (result: DictationResult) => void;
  handleFinishKeyPassageReading: (result: KeyPassageReadingResult) => void;
  handleFinishListening: (result: ListeningResult) => void;
  handleFinishReadingAnnotation: (summary: AnnotationSummary) => void;
  handleFinishVocabDefinitionMatch: (result: VocabDefinitionMatchResult) => void;
  handleFinishVocabApplication: (result: VocabApplicationResult) => void;
  handleFinishSentencePractice: () => void;
  handleFinishVocabWordSearch: (elapsedSeconds: number) => void;
  handleFinishKnowledgeStation: () => void;
  handleFinishClassicalText: () => void;
  handleFinishClassicalSentenceMatching: () => void;
  handleFinishClassicalWordMatching: () => void;
  handleFinishClassicalSelfChallenge: () => void;
  handleRetry: () => void;
  handleSessionComplete: () => void;
  handleNextStep: () => void;
  handlePrevStep: () => void;
  handleComplete: () => void;
  handleStepClick: (step: { id: string }) => void;
}

export function useLearningStepNavigation({
  storyId,
  selectedStory,
  token,
  user,
  dbSessionId,
  hasActiveAssignment,
  isAssignmentReadyForSubmit,
  navigate,
  setSession,
  setLastAttempt,
  setSelectedStory,
  persistStepProgressState,
  persistStep,
  clearPersistedSession,
  ensureDbSession,
}: UseLearningStepNavigationOptions): UseLearningStepNavigationReturn {
  const sessionCompletedRef = useRef(false);
  const completionApiCalledRef = useRef(false);

  useEffect(() => {
    sessionCompletedRef.current = false;
    completionApiCalledRef.current = false;
  }, [storyId]);

  const handleStartReading = useCallback(() => {
    setSession((prev) => {
      if (prev) return { ...prev, introCompleted: true };
      if (selectedStory) {
        return {
          storyId: selectedStory.id,
          startedAt: Date.now(),
          introCompleted: true,
          readingAttempt: null,
          comprehensionResult: null,
          vocabResult: null,
          dictationResult: null,
          fullReadingResult: null,
        };
      }
      return null;
    });
    // Lesson-aware first reading step (#2752): a 文言文 lesson's own step_sequence
    // starts at 'classical-text' (原文), not the hardcoded 'full-text-annotate' —
    // that step has no data for this genre (讀全文-做記號 module never extracted
    // for these 10 lessons). A regular lesson has no step_sequence, so this
    // resolves to the same 'full-text-annotate' it always has.
    const firstReadingStep = lessonAwareNextStep(
      'lesson-intro',
      selectedStory?.stepSequence,
      'full-text-annotate',
    );
    persistStep(STEP_PATH_TO_NUMBER[firstReadingStep]);
    ensureDbSession();
    navigate(isToolboxMode() ? '/tools' : stepPath(storyId, firstReadingStep));
  }, [storyId, selectedStory, navigate, persistStep, ensureDbSession, setSession]);

  // ─── Navigation helpers ───────────────────────────────────────────────────

  // 目前這一步的 key，含輪次（多篇課才有 `#slug`）。
  const currentStepKey = useCurrentStepId('');

  const navigateAfterFinish = useCallback(
    (nextStep: string) => {
      if (isToolboxMode()) {
        navigate('/tools');
        return;
      }
      navigate(stepPath(storyId, nextStep));
    },
    [navigate, storyId],
  );

  /**
   * Generic step-finish dispatcher.
   *
   * Delegates payload construction to buildStepFinishPayload() so each
   * handleFinish* callback is reduced to: build payload → persist → navigate.
   * sessionPatch is applied to LearningSession state when provided.
   */
  const dispatchStepFinish = useCallback(
    (stepId: string, stepData: Record<string, unknown>, sessionPatch?: Partial<LearningSession>) => {
      // 一課多篇時，序列裡是 `full-text-annotate#p3kud`，而呼叫端傳的是寫死的
      // base id。`lessonAwareNextStep` 找不到就 `return 'report'` ——
      // 學生在第 2 步按「完成標記」會直接被丟到第 21 步的報告頁（#2930）。
      // 補上目前網址帶的輪次；單篇課沒有 `#`，keyed === stepId，行為不變。
      const keyed = currentStepKey.startsWith(`${stepId}#`) ? currentStepKey : stepId;
      const payload = buildStepFinishPayload(keyed, stepData);
      // Lesson-aware override (#2752): STEP_FINISH_TRANSITIONS is one static table
      // keyed by step id, so it cannot express "key-passage-reading is followed by
      // X for 白話 lessons but Y for 文言文 lessons" — both genres route through
      // that SAME step id. A lesson carrying its own step_sequence must advance
      // within THAT sequence; a lesson without one gets payload.nextStep back
      // unchanged (see lessonAwareStepTransition.ts).
      const nextStep = lessonAwareNextStep(keyed, selectedStory?.stepSequence, payload.nextStep);
      if (sessionPatch) {
        setSession((prev) => (prev ? { ...prev, ...sessionPatch } : null));
      }
      persistStepProgressState(
        {
          completeStep: payload.completeStep,
          currentStep: nextStep,
          stepDataPatch: payload.stepDataPatch,
        },
        true,
      );
      if (STEP_PATH_TO_NUMBER[nextStep] !== undefined) {
        persistStep(STEP_PATH_TO_NUMBER[nextStep]);
      }
      navigateAfterFinish(nextStep);
    },
    [navigateAfterFinish, persistStep, persistStepProgressState, setSession, selectedStory, currentStepKey],
  );

  // ─── Step finish handlers ─────────────────────────────────────────────────

  const handleFinishReading = useCallback(
    (attempt: ReadingAttempt) => {
      setLastAttempt(attempt);
      // handleFinishReading completes the 'paragraph-reading' step (live tutor readout)
      dispatchStepFinish('paragraph-reading', { readingAttempt: attempt }, { readingAttempt: attempt });
    },
    [dispatchStepFinish, setLastAttempt],
  );

  const handleFinishComprehension = useCallback(
    (result: ComprehensionResult) => {
      dispatchStepFinish('comprehension', { result }, { comprehensionResult: result });
    },
    [dispatchStepFinish],
  );

  const handleFinishVocab = useCallback(
    (result: VocabResult) => {
      dispatchStepFinish('character-practice', { result }, { vocabResult: result });
    },
    [dispatchStepFinish],
  );

  const handleFinishDictation = useCallback(
    (result: DictationResult) => {
      // Dictation has no persistStepProgressState call in the original — just navigate
      setSession((prev) => (prev ? { ...prev, dictationResult: result } : null));
      persistStep(STEP_PATH_TO_NUMBER['vocab-review']);
      navigateAfterFinish('vocab-review');
    },
    [navigateAfterFinish, persistStep, setSession],
  );

  const handleFinishKeyPassageReading = useCallback(
    (result: KeyPassageReadingResult) => {
      dispatchStepFinish('key-passage-reading', { result }, { fullReadingResult: result });
    },
    [dispatchStepFinish],
  );

  const handleFinishListening = useCallback(
    (result: ListeningResult) => {
      dispatchStepFinish('listening', { completed: true, score: result.score, feedback: result.feedback });
    },
    [dispatchStepFinish],
  );

  const handleFinishReadingAnnotation = useCallback(
    (_summary: AnnotationSummary) => {
      dispatchStepFinish('full-text-annotate', { completed: true }, { readingAnnotationCompleted: true });
    },
    [dispatchStepFinish],
  );

  const handleFinishVocabDefinitionMatch = useCallback(
    (result: VocabDefinitionMatchResult) => {
      dispatchStepFinish('vocab-definition', { completed: true, result }, { vocabDefinitionMatchCompleted: true });
    },
    [dispatchStepFinish],
  );

  const handleFinishVocabApplication = useCallback(
    (_result: VocabApplicationResult) => {
      dispatchStepFinish('vocab-application', { completed: true }, { vocabApplicationCompleted: true });
    },
    [dispatchStepFinish],
  );

  const handleFinishStoryStructure = useCallback(
    () => {
      dispatchStepFinish('keypoints-table', { completed: true });
    },
    [dispatchStepFinish],
  );

  const handleFinishReadingStrategy = useCallback(
    () => {
      dispatchStepFinish('spotlight', { completed: true });
    },
    [dispatchStepFinish],
  );

  const handleFinishSentencePractice = useCallback(
    () => {
      dispatchStepFinish('sentence-practice', { completed: true });
    },
    [dispatchStepFinish],
  );

  const handleFinishVocabWordSearch = useCallback(
    (_elapsedSeconds: number) => {
      dispatchStepFinish('vocab-review', { completed: true }, { vocabWordSearchCompleted: true });
    },
    [dispatchStepFinish],
  );

  const handleFinishKnowledgeStation = useCallback(
    () => {
      dispatchStepFinish('knowledge-station', { completed: true }, { knowledgeStationCompleted: true });
    },
    [dispatchStepFinish],
  );

  // ── 文言文專屬 steps (#2752) — same no-arg "read it, mark done, advance"
  // shape as handleFinishStoryStructure/handleFinishReadingStrategy above.
  // dispatchStepFinish's lesson-aware override (see above) sends these to the
  // right next classical step, not the static table's 'report' fallback.
  const handleFinishClassicalText = useCallback(() => {
    dispatchStepFinish('classical-text', { completed: true });
  }, [dispatchStepFinish]);

  const handleFinishClassicalSentenceMatching = useCallback(() => {
    dispatchStepFinish('classical-sentence-matching', { completed: true });
  }, [dispatchStepFinish]);

  const handleFinishClassicalWordMatching = useCallback(() => {
    dispatchStepFinish('classical-word-matching', { completed: true });
  }, [dispatchStepFinish]);

  const handleFinishClassicalSelfChallenge = useCallback(() => {
    dispatchStepFinish('classical-self-challenge', { completed: true });
  }, [dispatchStepFinish]);

  const handleRetry = useCallback(() => {
    clearPersistedSession();
    setSession(null);
    setLastAttempt(null);
    setSelectedStory(null);
    navigate(isToolboxMode() ? '/tools' : '/library');
  }, [navigate, clearPersistedSession, setSession, setLastAttempt, setSelectedStory]);

  const handleSessionComplete = useCallback(() => {
    const assignmentIdStr = sessionStorage.getItem('activeAssignmentId');
    const contextRaw = sessionStorage.getItem(ACTIVE_ASSIGNMENT_CONTEXT_KEY);

    let shouldSubmit = false;
    let assignmentId: number | null = null;
    if (assignmentIdStr) {
      const parsed = parseInt(assignmentIdStr, 10);
      if (!isNaN(parsed)) assignmentId = parsed;
    }

    if (assignmentId != null && contextRaw && token && user && storyId) {
      try {
        const context = JSON.parse(contextRaw) as {
          assignmentId?: number;
          userId?: string | null;
          storyKey?: string | null;
        };
        shouldSubmit = (
          context.assignmentId === assignmentId
          && String(context.userId ?? '') === String(user.id)
          && String(context.storyKey ?? '') === String(storyId)
          && isAssignmentReadyForSubmit
        );
      } catch {
        shouldSubmit = false;
      }
    }

    if (assignmentId != null && !shouldSubmit) {
      return;
    }

    if (!hasActiveAssignment && storyId && dbSessionId !== null && token && !completionApiCalledRef.current) {
      completionApiCalledRef.current = true;
      completeSelfPracticeSession(dbSessionId, token).catch((err) => {
        if (err instanceof SessionExpiredError) {
          console.warn('[LearningLayout] completeSelfPracticeSession: token expired, session not marked complete in DB');
        } else {
          console.warn('[LearningLayout] completeSelfPracticeSession failed:', err);
        }
      });
    }

    if (sessionCompletedRef.current) return;
    sessionCompletedRef.current = true;

    if (!hasActiveAssignment && storyId) {
      try {
        localStorage.setItem(`${SELF_PRACTICE_COMPLETED_KEY_PREFIX}${storyId}`, '1');
      } catch {
        // non-fatal
      }
    }

    clearPersistedSession();

    sessionStorage.removeItem('activeAssignmentId');
    sessionStorage.removeItem('activeAssignmentGoals');
    sessionStorage.removeItem(ACTIVE_ASSIGNMENT_CONTEXT_KEY);

    if (shouldSubmit && token && assignmentId != null) {
      submitAssignment(token, assignmentId).catch((err) => {
        console.warn('[LearningLayout] Auto-submit assignment failed:', err);
      });
    }
  }, [
    clearPersistedSession,
    token,
    user,
    storyId,
    isAssignmentReadyForSubmit,
    hasActiveAssignment,
    dbSessionId,
  ]);

  const handleStepClick = useCallback(
    (step: { id: string }) => {
      if (!storyId) return;
      persistStep(STEP_PATH_TO_NUMBER[step.id]);
      navigate(stepPath(storyId, step.id));
    },
    [navigate, persistStep, storyId],
  );

  const handleComplete = useCallback(() => {
    handleSessionComplete();
  }, [handleSessionComplete]);

  const handleNextStep = useCallback(() => {
    const current = window.location.pathname.split('/').filter(Boolean).at(-1);
    const stepIds = Object.keys(STEP_PATH_TO_NUMBER);
    const idx = current ? stepIds.indexOf(current) : -1;
    const next = idx >= 0 ? stepIds[idx + 1] : null;
    if (next) handleStepClick({ id: next });
  }, [handleStepClick]);

  const handlePrevStep = useCallback(() => {
    const current = window.location.pathname.split('/').filter(Boolean).at(-1);
    const stepIds = Object.keys(STEP_PATH_TO_NUMBER);
    const idx = current ? stepIds.indexOf(current) : -1;
    const prev = idx > 0 ? stepIds[idx - 1] : null;
    if (prev) handleStepClick({ id: prev });
  }, [handleStepClick]);

  return {
    handleStartReading,
    handleFinishReading,
    handleFinishComprehension,
    handleFinishStoryStructure,
    handleFinishReadingStrategy,
    handleFinishVocab,
    handleFinishDictation,
    handleFinishKeyPassageReading,
    handleFinishListening,
    handleFinishReadingAnnotation,
    handleFinishVocabDefinitionMatch,
    handleFinishVocabApplication,
    handleFinishSentencePractice,
    handleFinishVocabWordSearch,
    handleFinishKnowledgeStation,
    handleFinishClassicalText,
    handleFinishClassicalSentenceMatching,
    handleFinishClassicalWordMatching,
    handleFinishClassicalSelfChallenge,
    handleRetry,
    handleSessionComplete,
    handleNextStep,
    handlePrevStep,
    handleComplete,
    handleStepClick,
  };
}
