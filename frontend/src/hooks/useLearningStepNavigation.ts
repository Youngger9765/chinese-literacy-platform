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

  const handleFinishReading = useCallback(
    (attempt: ReadingAttempt) => {
      setLastAttempt(attempt);
      setSession((prev) => (prev ? { ...prev, readingAttempt: attempt } : null));
      persistStepProgressState(
        {
          completeStep: 'tutor',
          currentStep: 'full-reading',
          stepDataPatch: {
            tutor: { readingAttempt: attempt },
          },
        },
        true,
      );
      persistStep(STEP_PATH_TO_NUMBER['full-reading']);
      navigateAfterFinish('full-reading');
    },
    [navigateAfterFinish, persistStep, persistStepProgressState, setLastAttempt, setSession],
  );

  const handleFinishComprehension = useCallback(
    (result: ComprehensionResult) => {
      setSession((prev) => (prev ? { ...prev, comprehensionResult: result } : null));
      persistStepProgressState(
        {
          completeStep: 'comprehension',
          currentStep: 'vocab-word-search',
          stepDataPatch: {
            comprehension: { result },
          },
        },
        true,
      );
      persistStep(STEP_PATH_TO_NUMBER['vocab-word-search']);
      navigateAfterFinish('vocab-word-search');
    },
    [navigateAfterFinish, persistStep, persistStepProgressState, setSession],
  );

  const handleFinishVocab = useCallback(
    (result: VocabResult) => {
      setSession((prev) => (prev ? { ...prev, vocabResult: result } : null));
      persistStepProgressState(
        {
          completeStep: 'vocab',
          currentStep: 'vocab-definition',
          stepDataPatch: {
            vocab: { result },
          },
        },
        true,
      );
      persistStep(STEP_PATH_TO_NUMBER['vocab-definition']);
      navigateAfterFinish('vocab-definition');
    },
    [navigateAfterFinish, persistStep, persistStepProgressState, setSession],
  );

  const handleFinishDictation = useCallback(
    (result: DictationResult) => {
      setSession((prev) => (prev ? { ...prev, dictationResult: result } : null));
      persistStep(STEP_PATH_TO_NUMBER['vocab-word-search']);
      navigateAfterFinish('vocab-word-search');
    },
    [navigateAfterFinish, persistStep, setSession],
  );

  const handleFinishFullReading = useCallback(
    (result: FullReadingResult) => {
      setSession((prev) => (prev ? { ...prev, fullReadingResult: result } : null));
      persistStepProgressState(
        {
          completeStep: 'full-reading',
          stepDataPatch: {
            'full-reading': { result },
          },
        },
        true,
      );
      persistStep(STEP_PATH_TO_NUMBER['listening']);
      navigateAfterFinish('listening');
    },
    [navigateAfterFinish, persistStep, persistStepProgressState, setSession],
  );

  const handleFinishListening = useCallback(
    (result: ListeningResult) => {
      persistStepProgressState(
        {
          completeStep: 'listening',
          currentStep: 'vocab',
          stepDataPatch: {
            listening: { completed: true, score: result.score, feedback: result.feedback },
          },
        },
        true,
      );
      persistStep(STEP_PATH_TO_NUMBER['vocab']);
      navigateAfterFinish('vocab');
    },
    [navigateAfterFinish, persistStep, persistStepProgressState],
  );

  const handleFinishReadingAnnotation = useCallback(
    (_summary: AnnotationSummary) => {
      setSession((prev) => (prev ? { ...prev, readingAnnotationCompleted: true } : null));
      persistStepProgressState(
        {
          completeStep: 'reading-annotation',
          currentStep: 'tutor',
          stepDataPatch: {
            'reading-annotation': { completed: true },
          },
        },
        true,
      );
      persistStep(STEP_PATH_TO_NUMBER['tutor']);
      navigateAfterFinish('tutor');
    },
    [navigateAfterFinish, persistStep, persistStepProgressState, setSession],
  );

  const handleFinishVocabDefinitionMatch = useCallback(
    (result: VocabDefinitionMatchResult) => {
      setSession((prev) => (prev ? { ...prev, vocabDefinitionMatchCompleted: true } : null));
      persistStepProgressState(
        {
          completeStep: 'vocab-definition',
          currentStep: 'vocab-application',
          stepDataPatch: {
            'vocab-definition': { completed: true, result },
          },
        },
        true,
      );
      persistStep(STEP_PATH_TO_NUMBER['vocab-application']);
      navigateAfterFinish('vocab-application');
    },
    [navigateAfterFinish, persistStep, persistStepProgressState, setSession],
  );

  const handleFinishVocabApplication = useCallback(
    (_result: VocabApplicationResult) => {
      setSession((prev) => (prev ? { ...prev, vocabApplicationCompleted: true } : null));
      persistStepProgressState(
        {
          completeStep: 'vocab-application',
          currentStep: 'story-structure',
          stepDataPatch: {
            'vocab-application': { completed: true },
          },
        },
        true,
      );
      persistStep(STEP_PATH_TO_NUMBER['story-structure']);
      navigateAfterFinish('story-structure');
    },
    [navigateAfterFinish, persistStep, persistStepProgressState, setSession],
  );

  const handleFinishStoryStructure = useCallback(
    () => {
      persistStepProgressState(
        {
          completeStep: 'story-structure',
          currentStep: 'reading-strategy',
          stepDataPatch: {
            'story-structure': { completed: true },
          },
        },
        true,
      );
      persistStep(STEP_PATH_TO_NUMBER['reading-strategy']);
      navigateAfterFinish('reading-strategy');
    },
    [navigateAfterFinish, persistStep, persistStepProgressState],
  );

  const handleFinishReadingStrategy = useCallback(
    () => {
      persistStepProgressState(
        {
          completeStep: 'reading-strategy',
          currentStep: 'comprehension',
          stepDataPatch: {
            'reading-strategy': { completed: true },
          },
        },
        true,
      );
      persistStep(STEP_PATH_TO_NUMBER['comprehension']);
      navigateAfterFinish('comprehension');
    },
    [navigateAfterFinish, persistStep, persistStepProgressState],
  );

  const handleFinishSentencePractice = useCallback(
    () => {
      persistStepProgressState(
        {
          completeStep: 'sentence-practice',
          currentStep: 'vocab-definition',
          stepDataPatch: {
            'sentence-practice': { completed: true },
          },
        },
        true,
      );
      persistStep(STEP_PATH_TO_NUMBER['sentence-practice']);
      navigateAfterFinish('vocab-definition');
    },
    [navigateAfterFinish, persistStep, persistStepProgressState],
  );

  const handleFinishVocabWordSearch = useCallback(
    (_elapsedSeconds: number) => {
      setSession((prev) => (prev ? { ...prev, vocabWordSearchCompleted: true } : null));
      persistStepProgressState(
        {
          completeStep: 'vocab-word-search',
          currentStep: 'knowledge-station',
          stepDataPatch: {
            'vocab-word-search': { completed: true },
          },
        },
        true,
      );
      persistStep(STEP_PATH_TO_NUMBER['knowledge-station']);
      navigateAfterFinish('knowledge-station');
    },
    [navigateAfterFinish, persistStep, persistStepProgressState, setSession],
  );

  const handleFinishKnowledgeStation = useCallback(
    () => {
      setSession((prev) => (prev ? { ...prev, knowledgeStationCompleted: true } : null));
      persistStepProgressState(
        {
          completeStep: 'knowledge-station',
          currentStep: 'report',
          stepDataPatch: {
            'knowledge-station': { completed: true },
          },
        },
        true,
      );
      persistStep(STEP_PATH_TO_NUMBER['report']);
      navigateAfterFinish('report');
    },
    [navigateAfterFinish, persistStep, persistStepProgressState, setSession],
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
