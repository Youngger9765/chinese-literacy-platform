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
import type { Dispatch, SetStateAction } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { AuthUser } from '../services/authApi';
import { completeSelfPracticeSession, SessionExpiredError, type StepProgressData } from '../services/learningApi';
import { submitAssignment } from '../services/assignmentApi';
import { STEP_PATH_TO_NUMBER } from '../config/stepConfig';
import { isToolboxMode } from '../services/learningStorageScope';
import type { ListeningResult } from '../components/reading-steps/ListeningPractice';
import type { AnnotationSummary } from '../components/reading-steps/ReadingAnnotation';
import type { VocabApplicationResult } from '../components/reading-steps/VocabApplication';
import type { VocabDefinitionMatchResult } from '../components/reading-steps/VocabDefinitionMatch';
import type {
  ComprehensionResult,
  DictationResult,
  FullReadingResult,
  LearningSession,
  ReadingAttempt,
  Story,
  VocabResult,
} from '../types';
import { buildStepFinishPayload } from './stepHandlerUtils';

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
  handleFinishFullReading: (result: FullReadingResult) => void;
  handleFinishListening: (result: ListeningResult) => void;
  handleFinishReadingAnnotation: (summary: AnnotationSummary) => void;
  handleFinishVocabDefinitionMatch: (result: VocabDefinitionMatchResult) => void;
  handleFinishVocabApplication: (result: VocabApplicationResult) => void;
  handleFinishSentencePractice: () => void;
  handleFinishVocabWordSearch: (elapsedSeconds: number) => void;
  handleFinishKnowledgeStation: () => void;
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
    persistStep(STEP_PATH_TO_NUMBER['reading-annotation']);
    ensureDbSession();
    navigate(isToolboxMode() ? '/tools' : `/learn/${storyId}/reading-annotation`);
  }, [storyId, selectedStory, navigate, persistStep, ensureDbSession, setSession]);

  // ─── Navigation helpers ───────────────────────────────────────────────────

  const navigateAfterFinish = useCallback(
    (nextStep: string) => {
      if (isToolboxMode()) {
        navigate('/tools');
        return;
      }
      navigate(`/learn/${storyId}/${nextStep}`);
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
      const payload = buildStepFinishPayload(stepId, stepData);
      if (sessionPatch) {
        setSession((prev) => (prev ? { ...prev, ...sessionPatch } : null));
      }
      persistStepProgressState(
        {
          completeStep: payload.completeStep,
          currentStep: payload.currentStep,
          stepDataPatch: payload.stepDataPatch,
        },
        true,
      );
      if (STEP_PATH_TO_NUMBER[payload.nextStep] !== undefined) {
        persistStep(STEP_PATH_TO_NUMBER[payload.nextStep]);
      }
      navigateAfterFinish(payload.nextStep);
    },
    [navigateAfterFinish, persistStep, persistStepProgressState, setSession],
  );

  // ─── Step finish handlers ─────────────────────────────────────────────────

  const handleFinishReading = useCallback(
    (attempt: ReadingAttempt) => {
      setLastAttempt(attempt);
      // handleFinishReading completes the 'tutor' step (live tutor readout)
      dispatchStepFinish('tutor', { readingAttempt: attempt }, { readingAttempt: attempt });
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
      dispatchStepFinish('vocab', { result }, { vocabResult: result });
    },
    [dispatchStepFinish],
  );

  const handleFinishDictation = useCallback(
    (result: DictationResult) => {
      // Dictation has no persistStepProgressState call in the original — just navigate
      setSession((prev) => (prev ? { ...prev, dictationResult: result } : null));
      persistStep(STEP_PATH_TO_NUMBER['vocab-word-search']);
      navigateAfterFinish('vocab-word-search');
    },
    [navigateAfterFinish, persistStep, setSession],
  );

  const handleFinishFullReading = useCallback(
    (result: FullReadingResult) => {
      dispatchStepFinish('full-reading', { result }, { fullReadingResult: result });
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
      dispatchStepFinish('reading-annotation', { completed: true }, { readingAnnotationCompleted: true });
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
      dispatchStepFinish('story-structure', { completed: true });
    },
    [dispatchStepFinish],
  );

  const handleFinishReadingStrategy = useCallback(
    () => {
      dispatchStepFinish('reading-strategy', { completed: true });
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
      dispatchStepFinish('vocab-word-search', { completed: true }, { vocabWordSearchCompleted: true });
    },
    [dispatchStepFinish],
  );

  const handleFinishKnowledgeStation = useCallback(
    () => {
      dispatchStepFinish('knowledge-station', { completed: true }, { knowledgeStationCompleted: true });
    },
    [dispatchStepFinish],
  );

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
      navigate(`/learn/${storyId}/${step.id}`);
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
    handleFinishFullReading,
    handleFinishListening,
    handleFinishReadingAnnotation,
    handleFinishVocabDefinitionMatch,
    handleFinishVocabApplication,
    handleFinishSentencePractice,
    handleFinishVocabWordSearch,
    handleFinishKnowledgeStation,
    handleRetry,
    handleSessionComplete,
    handleNextStep,
    handlePrevStep,
    handleComplete,
    handleStepClick,
  };
}
