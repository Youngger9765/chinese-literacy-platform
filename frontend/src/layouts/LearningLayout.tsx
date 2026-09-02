import React, { useEffect, useRef, useMemo } from 'react';
import { useCurrentStepId } from '../hooks/useCurrentStepId';
import { storyForStep } from '../services/api';
import { Outlet, useParams, useNavigate, useOutletContext, useLocation } from 'react-router-dom';
import type {
  Story,
  ReadingAttempt,
  LearningSession,
  ComprehensionResult,
  VocabResult,
  DictationResult,
  KeyPassageReadingResult,
} from '../types';
import type { ListeningResult } from '../components/reading-steps/ListeningPractice';
import type { AnnotationSummary } from '../components/reading-steps/FullTextAnnotate';
import type { VocabApplicationResult } from '../components/reading-steps/VocabApplication';
import type { VocabDefinitionMatchResult } from '../components/reading-steps/VocabDefinitionMatch';
import { useAuth } from '../contexts/AuthContext';
import { useLearningNav } from '../contexts/LearningNavContext';
import { useIdleTimer } from '../hooks/useIdleTimer';
import type { StepProgressData } from '../services/learningApi';
import SessionTimeoutWarning from '../components/SessionTimeoutWarning';
import BadgeUnlockToast from '../components/gamification/BadgeUnlockToast';
import { isToolboxMode } from '../services/learningStorageScope';

// Extracted hooks (Issue #1906 — deep split of the god component)
import { useLearningSessionBootstrap } from '../hooks/useLearningSessionBootstrap';
import { useStepProgressPersistence } from '../hooks/useStepProgressPersistence';
import { useLearningStepNavigation } from '../hooks/useLearningStepNavigation';

/** Idle time before showing warning modal (15 minutes). */
const IDLE_WARNING_TIMEOUT_MS = 15 * 60 * 1000;
/** Countdown duration shown in the warning modal (60 seconds). */
const WARNING_COUNTDOWN_SECONDS = 60;

const EMPTY_ATTEMPT: ReadingAttempt = {
  storyId: '',
  accuracy: 0,
  fluency: 0,
  cpm: 0,
  mispronouncedWords: [],
  transcription: '',
  timestamp: 0,
};

/** Reading goals for an assignment session (Issue #414). */
export interface AssignmentReadingGoals {
  target_cpm: number | null;
  target_accuracy: number | null;
  difficulty_label: string | null;
  effective_cpm: number;
  effective_accuracy: number;
}

export interface LearningContext {
  selectedStory: Story | null;
  session: LearningSession | null;
  lastAttempt: ReadingAttempt | null;
  rightPanelWidth: number;
  setRightPanelWidth: (w: number) => void;
  handleStartReading: () => void;
  handleFinishReading: (attempt: ReadingAttempt) => void;
  handleFinishComprehension: (result: ComprehensionResult) => void;
  /** Issue #1335: advance from 文章重點表 step to 閱讀聚光燈 */
  handleFinishStoryStructure: () => void;
  /** Issue #1335: advance from 閱讀聚光燈 step to 閱讀理解 */
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
  /** 文言文專屬 steps (#2752) — see useLearningStepNavigation.ts for why these
   *  route through the lesson-aware dispatchStepFinish override. */
  handleFinishClassicalText: () => void;
  handleFinishClassicalSentenceMatching: () => void;
  handleFinishClassicalWordMatching: () => void;
  handleFinishClassicalSelfChallenge: () => void;
  handleRetry: () => void;
  handleSessionComplete: () => void;
  emptyAttempt: ReadingAttempt;
  /** DB LearningSession integer ID — set after the session is created in the DB (Issue #242) */
  dbSessionId: number | null;
  /** Set of paragraph indices completed during ParagraphReading (progressive unlock, Issue #85). */
  completedParagraphsSet: Set<number>;
  /** Notify layout that a paragraph was completed (Issue #85). */
  handleParagraphComplete: (paragraphIndex: number) => void;
  /** Issue #2532: full tutor reset for「再讀一次」— clears every completion/成績 source. */
  resetTutorStep: () => void;
  /** Reading goals set by teacher for the active assignment (Issue #414). Null for free-play. */
  assignmentReadingGoals: AssignmentReadingGoals | null;
  /**
   * Sync step progress to DB (debounced 5 s) and to localStorage.
   * Non-blocking — API failures do not break the learning flow (Issue #660).
   */
  syncProgress: (data: StepProgressData) => void;
  /**
   * Force an immediate DB save (e.g. on step completion or page unload).
   * Non-blocking (Issue #660).
   */
  flushProgress: (data: StepProgressData) => void;
  /** Current persisted step progress snapshot loaded from DB/local state. */
  stepProgressData: StepProgressData;
  /**
   * Merge a per-step progress payload into step_progress and persist it.
   * Use this for in-step process/history persistence (e.g. dialogue turns).
   *
   * `stepData` is typed as `object` (not `Record<string, unknown>`) so the
   * strict per-step shapes from `types/stepProgress.ts` are assignable
   * without a cast at every call site. Runtime behaviour is unchanged — the
   * payload is spread into `step_data[stepId]` JSONB regardless of shape.
   */
  saveStepProgressPatch: (opts: {
    stepId: string;
    stepData: object;
    currentStep?: string | null;
    markCompleted?: boolean;
    immediate?: boolean;
  }) => void;
  /** Whether current assignment has completed all required steps (except report). */
  isAssignmentReadyForSubmit: boolean;
  /** Missing required assignment steps used by report blocking UI. */
  missingAssignmentSteps: Array<{ id: string; label: string }>;
  /** First incomplete step path to resume from. */
  firstIncompleteStepPath: string;
  /** Whether this learning flow is currently tied to an active assignment. */
  hasActiveAssignment: boolean;
}

/**
 * Wraps the learning flow routes (/learn/:storyId/*).
 * Manages shared state via three extracted hooks (Issue #1906):
 *   - useLearningSessionBootstrap  — story load, DB session create/restore
 *   - useStepProgressPersistence   — step progress state + localStorage sync
 *   - useLearningStepNavigation    — all handleFinish* callbacks + handleSessionComplete
 *
 * Children access this state via useOutletContext<LearningContext>().
 */
const LearningLayout: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const learningNav = useLearningNav();
  const { user, token } = useAuth();

  // ── Right panel width (UI-only, no business logic) ───────────────────────
  const [rightPanelWidth, setRightPanelWidthState] = React.useState(320);
  const setRightPanelWidth = React.useCallback((w: number) => setRightPanelWidthState(w), []);

  // ── Last attempt (carried across steps for report) ───────────────────────
  const [lastAttempt, setLastAttempt] = React.useState<ReadingAttempt | null>(null);

  // ── Idle timeout warning ─────────────────────────────────────────────────
  const [showTimeoutWarning, setShowTimeoutWarning] = React.useState(false);
  const idleResetRef = useRef<(() => void) | null>(null);

  // ── Hook 1: session bootstrap (story load + DB session) ──────────────────
  const bootstrap = useLearningSessionBootstrap({ storyId, user, token, navigate });
  const {
    isAssignmentFlow,
    assignmentReadingGoals,
    dbSessionId,
    isLoading,
    error,
    selectedStory,
    session,
    setSession,
    setSelectedStory,
    ensureDbSession,
  } = bootstrap;

  // ── Hook 2: step progress persistence ────────────────────────────────────
  const stepPersistence = useStepProgressPersistence({
    storyId,
    user,
    token,
    dbSessionId,
    selectedStory,
    isAssignmentFlow,
    setSession,
  });
  const {
    stepProgressState,
    persistStepProgressState,
    persistStep,
    saveStepProgressPatch,
    clearPersistedSession,
    resetTutorStep,
    completedParagraphsSet,
    handleParagraphComplete,
    missingAssignmentSteps,
    isAssignmentReadyForSubmit,
    firstIncompleteStepPath,
    hasActiveAssignment,
    syncProgress,
    flushProgress,
    isProgressLoading,
    midSessionBadgeUnlocks,
    dismissMidSessionBadgeUnlocks,
  } = stepPersistence;

  // ── Hook 3: step navigation (all handleFinish* callbacks) ────────────────
  const stepNav = useLearningStepNavigation({
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
  });
  const {
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
  } = stepNav;

  // ── Idle-timeout warning (Issue #408) ────────────────────────────────────

  const handleIdleTimeout = React.useCallback(() => {
    setShowTimeoutWarning(true);
  }, []);

  const { reset: resetIdleTimer } = useIdleTimer({
    timeout: IDLE_WARNING_TIMEOUT_MS,
    onIdle: handleIdleTimeout,
    enabled: selectedStory !== null && !isLoading,
  });

  useEffect(() => {
    idleResetRef.current = resetIdleTimer;
  }, [resetIdleTimer]);

  const handleContinueLearning = React.useCallback(() => {
    setShowTimeoutWarning(false);
    idleResetRef.current?.();
  }, []);

  const handleSessionExpired = React.useCallback(() => {
    setShowTimeoutWarning(false);
    navigate(isToolboxMode() ? '/tools' : '/library');
  }, [navigate]);

  // ── Sync nav context so StepperNav can read session/story ────────────────
  useEffect(() => {
    learningNav.setSession(session);
    learningNav.setSelectedStory(selectedStory);
    return () => {
      learningNav.setSession(null);
      learningNav.setSelectedStory(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, selectedStory]);

  // Memoise the outlet-context object so the Outlet (and any child component
  // destructuring via useLearningContext) sees a stable reference when no
  // dependency actually changed. Without useMemo, each LearningLayout render
  // minted a fresh object; child useEffect hooks that depend on context
  // identity (rather than individual fields) would needlessly re-run.
  // NOTE: must be before early returns to satisfy Rules of Hooks.
  // 這一步該看到哪一篇（#2916）。一課印了好幾篇課文時，
  // `key-passage-reading#9a7x4` 是第 2 篇的念順順 —— 不換的話三篇都會渲染
  // 頂層的 `key_reading`（＝第 1 篇）。有段落、會唸、不報錯，只是唸錯篇。
  //
  // 換在這裡而不是各步驟頁裡：所有步驟頁都吃 `selectedStory`，
  // 一處換完全部正確；散在各頁換就會有人漏掉，而漏掉是看不出來的。
  const stepKey = useCurrentStepId('');
  // 各步驟頁寫進度時傳的是寫死的 base id（`keypoints-table`）。
  // 一課多篇時三篇會寫進同一個 key，做完第 2 篇第 1 篇也變完成，而且沒有徵兆。
  // 在這裡補上輪次，10 個步驟頁都不用改（#2930）。
  const saveStepProgressPatchKeyed = React.useCallback(
    (opts: Parameters<typeof saveStepProgressPatch>[0]) =>
      saveStepProgressPatch({ ...opts, currentStepKey: stepKey }),
    [saveStepProgressPatch, stepKey],
  );

  const storyForThisStep = useMemo(
    () => storyForStep(selectedStory, stepKey),
    [selectedStory, stepKey],
  );

  const ctx: LearningContext = useMemo(
    () => ({
      selectedStory: storyForThisStep,
      session,
      lastAttempt,
      rightPanelWidth,
      setRightPanelWidth,
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
      emptyAttempt: EMPTY_ATTEMPT,
      dbSessionId,
      completedParagraphsSet,
      handleParagraphComplete,
      resetTutorStep,
      assignmentReadingGoals,
      syncProgress,
      flushProgress,
      stepProgressData: stepProgressState,
      saveStepProgressPatch: saveStepProgressPatchKeyed,
      isAssignmentReadyForSubmit,
      missingAssignmentSteps,
      firstIncompleteStepPath,
      hasActiveAssignment,
    }),
    [
      storyForThisStep,
      session,
      lastAttempt,
      rightPanelWidth,
      setRightPanelWidth,
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
      dbSessionId,
      completedParagraphsSet,
      handleParagraphComplete,
      resetTutorStep,
      assignmentReadingGoals,
      syncProgress,
      flushProgress,
      stepProgressState,
      saveStepProgressPatch,
      isAssignmentReadyForSubmit,
      missingAssignmentSteps,
      firstIncompleteStepPath,
      hasActiveAssignment,
    ],
  );

  // ── Loading / error states (after all hooks) ─────────────────────────────

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-400">載入課文中...</span>
        </div>
      </div>
    );
  }

  if (error || !selectedStory) {
    const inToolbox = isToolboxMode();
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-red-600">{error || '找不到此課文'}</p>
          <button
            onClick={() => navigate(inToolbox ? '/tools' : '/library')}
            className="text-accent hover:text-accent-hover font-medium text-sm"
          >
            {inToolbox ? '回到練習工具箱' : '返回圖書館'}
          </button>
        </div>
      </div>
    );
  }

  // Issue #1549 — when a DB session exists but step_progress is still loading,
  // delay child render so pages don't initialise local state from an empty
  // snapshot. Without this gate the async DB load lands after the child has
  // already useState-initialised with undefined, and the rehydrated answers
  // never appear in the UI even though they're stored correctly.
  const waitingForProgress = dbSessionId !== null && isProgressLoading;

  return (
    <>
      {waitingForProgress ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-400">載入學習進度中...</span>
          </div>
        </div>
      ) : (
        <Outlet context={ctx} />
      )}
      <SessionTimeoutWarning
        visible={showTimeoutWarning}
        countdownSeconds={WARNING_COUNTDOWN_SECONDS}
        onContinue={handleContinueLearning}
        onExpired={handleSessionExpired}
      />
      {/* Issue #3024 — badge unlocked mid-lesson (rendered at the layout
          level, not per-step, so it shows up regardless of which step the
          student is currently on). */}
      <BadgeUnlockToast
        badgeKeys={midSessionBadgeUnlocks}
        onDismiss={dismissMidSessionBadgeUnlocks}
      />
    </>
  );
};

/** Hook for child routes to access learning context. */
export function useLearningContext(): LearningContext {
  return useOutletContext<LearningContext>();
}

export default LearningLayout;
