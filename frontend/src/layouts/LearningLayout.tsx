import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Outlet, useParams, useNavigate, useOutletContext, useLocation } from 'react-router-dom';
import {
  Story,
  ReadingAttempt,
  LearningSession,
  ComprehensionResult,
  VocabResult,
  DictationResult,
  FullReadingResult,
} from '../types';
import type { AnnotationSummary } from '../components/reading-steps/ReadingAnnotation';
import type { VocabApplicationResult } from '../components/reading-steps/VocabApplication';
import type { VocabDefinitionMatchResult } from '../components/reading-steps/VocabDefinitionMatch';
import { fetchStory, saveActiveSession, clearActiveSession } from '../services/api';
import { submitAssignment } from '../services/assignmentApi';
import { useAuth } from '../contexts/AuthContext';
import { useLearningNav } from '../contexts/LearningNavContext';
import { STEP_PATH_TO_NUMBER as STEP_CONFIG_PATH_TO_NUMBER } from '../config/stepConfig';
import { ACTIVE_STEPS } from '../config/stepConfig';
import { useIdleTimer } from '../hooks/useIdleTimer';
import { useProgressSync } from '../hooks/useProgressSync';
import type { StepProgressData } from '../services/learningApi';
import SessionTimeoutWarning from '../components/SessionTimeoutWarning';
import { scopedStepStorageKey } from '../services/learningStorageScope';

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
  handleFinishVocab: (result: VocabResult) => void;
  handleFinishDictation: (result: DictationResult) => void;
  handleFinishFullReading: (result: FullReadingResult) => void;
  handleFinishReadingAnnotation: (summary: AnnotationSummary) => void;
  handleFinishVocabDefinitionMatch: (result: VocabDefinitionMatchResult) => void;
  handleFinishVocabApplication: (result: VocabApplicationResult) => void;
  handleFinishVocabWordSearch: (elapsedSeconds: number) => void;
  handleFinishKnowledgeStation: () => void;
  handleRetry: () => void;
  handleSessionComplete: () => void;
  emptyAttempt: ReadingAttempt;
  /** DB LearningSession integer ID — set after the session is created in the DB (Issue #242) */
  dbSessionId: number | null;
  /** Set of paragraph indices completed during LiveTutor (progressive unlock, Issue #85). */
  completedParagraphsSet: Set<number>;
  /** Notify layout that a paragraph was completed (Issue #85). */
  handleParagraphComplete: (paragraphIndex: number) => void;
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
   */
  saveStepProgressPatch: (opts: {
    stepId: string;
    stepData: Record<string, unknown>;
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
 * Map from step name in URL path to numeric step index (1-based, matching DB).
 * Sourced from stepConfig.ts — the single source of truth for step definitions.
 */
const STEP_PATH_TO_NUMBER = STEP_CONFIG_PATH_TO_NUMBER;
const STEP_NUMBER_TO_PATH: Record<number, string> = Object.fromEntries(
  Object.entries(STEP_PATH_TO_NUMBER).map(([path, n]) => [n, path]),
);

/**
 * Wraps the learning flow routes (/learn/:storyId/*).
 * Manages shared state: selectedStory, session, lastAttempt, rightPanelWidth.
 * Children access this state via useOutletContext<LearningContext>().
 */
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
const ACTIVE_ASSIGNMENT_CONTEXT_KEY = 'activeAssignmentContext';
const LEGACY_DB_SESSION_KEY_PREFIX = 'db-session-';
const ASSIGNMENT_DB_SESSION_KEY_PREFIX = 'assignment-db-session-';
const SELF_DB_SESSION_KEY_PREFIX = 'self-db-session-';
const SELF_PRACTICE_COMPLETED_KEY_PREFIX = 'self-practice-completed-';

const LearningLayout: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const learningNav = useLearningNav();
  const { user, token } = useAuth();

  const isAssignmentFlow = useMemo(() => {
    if (!storyId) return false;
    try {
      const assignmentId = sessionStorage.getItem('activeAssignmentId');
      if (!assignmentId) return false;
      const contextRaw = sessionStorage.getItem(ACTIVE_ASSIGNMENT_CONTEXT_KEY);
      if (!contextRaw) return true;
      const context = JSON.parse(contextRaw) as { storyKey?: string | null; userId?: string | null };
      const storyMatch = String(context.storyKey ?? '') === String(storyId);
      const userMatch = !context.userId || !user || String(context.userId) === String(user.id);
      return storyMatch && userMatch;
    } catch {
      return false;
    }
  }, [storyId, user]);

  const activeDbSessionStorageKey = useMemo(() => {
    if (!storyId) return null;
    if (isAssignmentFlow) {
      const assignmentId = sessionStorage.getItem('activeAssignmentId');
      if (assignmentId) {
        return `${ASSIGNMENT_DB_SESSION_KEY_PREFIX}${assignmentId}-${storyId}`;
      }
      return `${ASSIGNMENT_DB_SESSION_KEY_PREFIX}${storyId}`;
    }
    return `${SELF_DB_SESSION_KEY_PREFIX}${storyId}`;
  }, [isAssignmentFlow, storyId]);

  const tutorCompletedStorageKey = useMemo(() => {
    if (!storyId) return null;
    return scopedStepStorageKey('tutor_completed_', storyId);
  }, [storyId, isAssignmentFlow]);

  const liveTutorProgressStorageKey = useMemo(() => {
    if (!storyId) return null;
    return scopedStepStorageKey('liveTutor_progress_', storyId);
  }, [storyId, isAssignmentFlow]);

  const legacyDbSessionStorageKey = useMemo(() => {
    if (!storyId) return null;
    return `${LEGACY_DB_SESSION_KEY_PREFIX}${storyId}`;
  }, [storyId]);

  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [session, setSession] = useState<LearningSession | null>(null);
  const [lastAttempt, setLastAttempt] = useState<ReadingAttempt | null>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** DB LearningSession integer ID — created when the user starts the intro (Issue #242).
   * Persisted to sessionStorage so refresh within the same browser tab restores the session. */
  const [dbSessionId, setDbSessionId] = useState<number | null>(null);
  /** Progressive paragraph unlock tracking (Issue #85).
   * Restored from localStorage on mount so progress survives page refresh (Issue #689).
   *
   * Fix #806: also fall back to LiveTutor's own localStorage key (`liveTutor_progress_*`)
   * so that when `tutor_completed_*` was cleared at session end but the user returns to
   * the same story before LiveTutor clears its own cache, FullReading still sees all
   * paragraphs as done. */
  const [completedParagraphsSet, setCompletedParagraphsSet] = useState<Set<number>>(() => {
    const scopedTutorKey = storyId ? scopedStepStorageKey('tutor_completed_', storyId) : null;
    const scopedLiveTutorKey = storyId ? scopedStepStorageKey('liveTutor_progress_', storyId) : null;
    try {
      const raw = scopedTutorKey ? localStorage.getItem(scopedTutorKey) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && (parsed as number[]).length > 0) {
          return new Set<number>(parsed as number[]);
        }
      }
    } catch {
      // Non-fatal — continue to fallback
    }
    // Fallback: LiveTutor persists its own progress under a different key.
    // If the user refreshed the page or started a new session for the same story
    // before LiveTutor cleared its own cache, read completed paragraphs from there.
    try {
      const liveTutorRaw = scopedLiveTutorKey ? localStorage.getItem(scopedLiveTutorKey) : null;
      if (liveTutorRaw) {
        const liveTutorParsed = JSON.parse(liveTutorRaw) as {
          completedParagraphs?: unknown;
        };
        if (
          Array.isArray(liveTutorParsed.completedParagraphs) &&
          (liveTutorParsed.completedParagraphs as number[]).length > 0
        ) {
          return new Set<number>(liveTutorParsed.completedParagraphs as number[]);
        }
      }
    } catch {
      // Non-fatal — start fresh
    }
    return new Set<number>();
  });
  /** Reading goals from the active assignment, loaded from sessionStorage (Issue #414). */
  const [assignmentReadingGoals, setAssignmentReadingGoals] = useState<AssignmentReadingGoals | null>(() => {
    try {
      const raw = sessionStorage.getItem('activeAssignmentGoals');
      return raw ? (JSON.parse(raw) as AssignmentReadingGoals) : null;
    } catch {
      return null;
    }
  });
  /** Whether the session idle-timeout warning modal is visible (Issue #408). */
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  /** Ref to the idle-timer reset function so handleContinueLearning can call it. */
  const idleResetRef = useRef<(() => void) | null>(null);
  /** Guard ref that prevents concurrent POST /api/learning/sessions calls (Issue #984). */
  const isCreatingSession = useRef(false);
  const [stepProgressState, setStepProgressState] = useState<StepProgressData>({
    current_step: null,
    steps_completed: [],
    step_data: {},
  });

  const requiredAssignmentSteps = useMemo(
    () => ACTIVE_STEPS.filter((s) => s.id !== 'report').map((s) => ({ id: s.id, label: s.label })),
    [],
  );
  const completedStepsSet = useMemo(
    () => new Set(stepProgressState.steps_completed ?? []),
    [stepProgressState.steps_completed],
  );
  const missingAssignmentSteps = useMemo(
    () => requiredAssignmentSteps.filter((s) => !completedStepsSet.has(s.id)),
    [requiredAssignmentSteps, completedStepsSet],
  );
  const isAssignmentReadyForSubmit = missingAssignmentSteps.length === 0;
  const firstIncompleteStepPath = missingAssignmentSteps[0]?.id ?? 'reading-annotation';
  const hasActiveAssignment = useMemo(() => {
    try {
      return isAssignmentFlow;
    } catch {
      return false;
    }
  }, [isAssignmentFlow]);

  useEffect(() => {
    if (!storyId || !activeDbSessionStorageKey) {
      setDbSessionId(null);
      return;
    }

    try {
      const directRaw = sessionStorage.getItem(activeDbSessionStorageKey);
      const legacyRaw = legacyDbSessionStorageKey
        ? sessionStorage.getItem(legacyDbSessionStorageKey)
        : null;
      const chosenRaw = directRaw ?? legacyRaw;
      if (!chosenRaw) {
        setDbSessionId(null);
        return;
      }
      const parsed = parseInt(chosenRaw, 10);
      if (Number.isNaN(parsed)) {
        setDbSessionId(null);
        return;
      }
      setDbSessionId(parsed);
      // Migrate legacy key value to split key for future reads.
      if (!directRaw && legacyRaw) {
        sessionStorage.setItem(activeDbSessionStorageKey, String(parsed));
      }
    } catch {
      setDbSessionId(null);
    }
  }, [storyId, activeDbSessionStorageKey, legacyDbSessionStorageKey]);

  // ── Step progress DB sync (Issue #660) ──────────────────────────────────
  const { syncProgress, flushProgress } = useProgressSync({
    token: token ?? null,
    dbSessionId,
    onProgressLoaded: (data) => {
      const loadedCompleted = Array.isArray(data.steps_completed) ? data.steps_completed : [];
      const loadedStepData = (data.step_data ?? {}) as Record<string, unknown>;

      setStepProgressState({
        current_step: data.current_step ?? null,
        steps_completed: loadedCompleted,
        step_data: loadedStepData,
      });

      // When DB returns saved progress, update the in-memory session with
      // completed paragraphs from step_data so LiveTutor can restore unlock state.
      // This is best-effort — localStorage is the primary L1 store.
      if (loadedStepData.tutor) {
        const tutorData = loadedStepData.tutor as Record<string, unknown>;
        const completedIdxs = tutorData.completedParagraphs;
        if (Array.isArray(completedIdxs)) {
          setCompletedParagraphsSet(new Set(completedIdxs as number[]));
        }
      }

      // Rehydrate step results for report generation when resuming an assignment.
      setSession((prev) => {
        if (!prev) return prev;
        const tutorData = (loadedStepData.tutor ?? {}) as Record<string, unknown>;
        const fullReadingData = (loadedStepData['full-reading'] ?? {}) as Record<string, unknown>;
        const vocabData = (loadedStepData.vocab ?? {}) as Record<string, unknown>;
        const comprehensionData = (loadedStepData.comprehension ?? {}) as Record<string, unknown>;
        const readingAnnotationData = (loadedStepData['reading-annotation'] ?? {}) as Record<string, unknown>;
        const vocabDefinitionData = (loadedStepData['vocab-definition'] ?? {}) as Record<string, unknown>;
        const vocabApplicationData = (loadedStepData['vocab-application'] ?? {}) as Record<string, unknown>;
        const vocabWordSearchData = (loadedStepData['vocab-word-search'] ?? {}) as Record<string, unknown>;
        const knowledgeStationData = (loadedStepData['knowledge-station'] ?? {}) as Record<string, unknown>;

        return {
          ...prev,
          completedSteps: loadedCompleted,
          readingAttempt: (tutorData.readingAttempt as ReadingAttempt | undefined) ?? prev.readingAttempt,
          fullReadingResult: (fullReadingData.result as FullReadingResult | undefined) ?? prev.fullReadingResult,
          vocabResult: (vocabData.result as VocabResult | undefined) ?? prev.vocabResult,
          comprehensionResult: (comprehensionData.result as ComprehensionResult | undefined) ?? prev.comprehensionResult,
          readingAnnotationCompleted:
            (readingAnnotationData.completed as boolean | undefined) ?? loadedCompleted.includes('reading-annotation') ?? prev.readingAnnotationCompleted,
          vocabDefinitionMatchCompleted:
            (vocabDefinitionData.completed as boolean | undefined) ?? loadedCompleted.includes('vocab-definition') ?? prev.vocabDefinitionMatchCompleted,
          vocabApplicationCompleted:
            (vocabApplicationData.completed as boolean | undefined) ?? loadedCompleted.includes('vocab-application') ?? prev.vocabApplicationCompleted,
          vocabWordSearchCompleted:
            (vocabWordSearchData.completed as boolean | undefined) ?? loadedCompleted.includes('vocab-word-search') ?? prev.vocabWordSearchCompleted,
          knowledgeStationCompleted:
            (knowledgeStationData.completed as boolean | undefined) ?? loadedCompleted.includes('knowledge-station') ?? prev.knowledgeStationCompleted,
        };
      });
    },
  });

  const persistStepProgressState = useCallback(
    (
      opts: {
        currentStep?: string | null;
        completeStep?: string;
        stepDataPatch?: Record<string, unknown>;
      },
      immediate: boolean,
    ) => {
      setStepProgressState((prev) => {
        const completed = new Set<string>(prev.steps_completed);
        if (opts.completeStep) completed.add(opts.completeStep);

        const next: StepProgressData = {
          current_step: opts.currentStep ?? prev.current_step,
          steps_completed: Array.from(completed),
          step_data: {
            ...prev.step_data,
            ...(opts.stepDataPatch ?? {}),
          },
        };

        // Prevent no-op writes that can trigger parent-child update loops.
        const prevSig = JSON.stringify(prev);
        const nextSig = JSON.stringify(next);
        if (prevSig === nextSig) {
          return prev;
        }

        if (immediate) {
          flushProgress(next);
        } else {
          syncProgress(next);
        }

        setSession((prevSession) => {
          if (!prevSession) return prevSession;
          return {
            ...prevSession,
            completedSteps: Array.from(completed),
          };
        });
        return next;
      });
    },
    [flushProgress, syncProgress],
  );

  const saveStepProgressPatch = useCallback(
    (opts: {
      stepId: string;
      stepData: Record<string, unknown>;
      currentStep?: string | null;
      markCompleted?: boolean;
      immediate?: boolean;
    }) => {
      persistStepProgressState(
        {
          currentStep: opts.currentStep,
          completeStep: opts.markCompleted ? opts.stepId : undefined,
          stepDataPatch: {
            [opts.stepId]: {
              ...opts.stepData,
            },
          },
        },
        opts.immediate ?? false,
      );
    },
    [persistStepProgressState],
  );

  // ─────────────────────────────────────────────────────────────────────────

  /** Persist current step to localStorage for session resume. */
  const persistStep = useCallback(
    (step: number) => {
      if (!user || !storyId) return;
      saveActiveSession(String(user.id), {
        sessionId: 0, // no DB session ID in the current flow
        storyId,
        currentStep: step,
        timestamp: Date.now(),
      });
      persistStepProgressState(
        { currentStep: STEP_NUMBER_TO_PATH[step] ?? null },
        false,
      );
    },
    [user, storyId, persistStepProgressState],
  );

  /** Clear active session from localStorage and sessionStorage (called on completion).
   * Removing the sessionStorage key means the next visit creates a fresh DB session.
   * Also clears the tutor paragraph progress so a fresh session starts at zero (Issue #689).
   * Fix #806: also clear LiveTutor's own cache key so stale paragraph data from a
   * completed session never bleeds into a new session for the same story. */
  const clearPersistedSession = useCallback(() => {
    if (!user) return;
    clearActiveSession(String(user.id));
    if (activeDbSessionStorageKey) {
      try { sessionStorage.removeItem(activeDbSessionStorageKey); } catch { /* non-fatal */ }
    }
    if (legacyDbSessionStorageKey) {
      try { sessionStorage.removeItem(legacyDbSessionStorageKey); } catch { /* non-fatal */ }
    }
    if (tutorCompletedStorageKey) {
      try { localStorage.removeItem(tutorCompletedStorageKey); } catch { /* non-fatal */ }
    }
    if (liveTutorProgressStorageKey) {
      try { localStorage.removeItem(liveTutorProgressStorageKey); } catch { /* non-fatal */ }
    }
  }, [
    user,
    storyId,
    activeDbSessionStorageKey,
    legacyDbSessionStorageKey,
    tutorCompletedStorageKey,
    liveTutorProgressStorageKey,
  ]);

  // ── Idle-timeout warning (Issue #408) ────────────────────────────────────

  /** Show the warning modal when the user has been idle for IDLE_WARNING_TIMEOUT_MS. */
  const handleIdleTimeout = useCallback(() => {
    // Progress is already saved by persistStep on every step transition.
    // Just show the warning so the student knows what's happening.
    setShowTimeoutWarning(true);
  }, []);

  const { reset: resetIdleTimer } = useIdleTimer({
    timeout: IDLE_WARNING_TIMEOUT_MS,
    onIdle: handleIdleTimeout,
    // Only active when the user is inside the learning flow with a loaded story
    enabled: selectedStory !== null && !isLoading,
  });

  // Expose reset to the ref so the continue handler below can call it
  useEffect(() => {
    idleResetRef.current = resetIdleTimer;
  }, [resetIdleTimer]);

  /** User clicked "繼續學習" — hide warning and restart the idle timer. */
  const handleContinueLearning = useCallback(() => {
    setShowTimeoutWarning(false);
    idleResetRef.current?.();
  }, []);

  /** User clicked "離開並儲存" or the countdown expired — navigate to library. */
  const handleSessionExpired = useCallback(() => {
    setShowTimeoutWarning(false);
    // Progress was saved by persistStep; just navigate away.
    navigate('/library');
  }, [navigate]);

  // ─────────────────────────────────────────────────────────────────────────

  // Sync session/story to the nav context so the header StepperNav can read them
  useEffect(() => {
    learningNav.setSession(session);
    learningNav.setSelectedStory(selectedStory);
    return () => {
      learningNav.setSession(null);
      learningNav.setSelectedStory(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, selectedStory]);

  // Load story data when storyId changes
  useEffect(() => {
    if (!storyId) {
      navigate('/library', { replace: true });
      return;
    }

    // If we already have the right story loaded, skip
    if (selectedStory?.id === storyId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    fetchStory(storyId)
      .then((story) => {
        setSelectedStory(story);
        // Only create a new session if we don't have one for this story
        setSession((prev) => {
          if (prev && prev.storyId === storyId) return prev;
          return {
            storyId: story.id,
            startedAt: Date.now(),
            introCompleted: false,
            readingAttempt: null,
            comprehensionResult: null,
            vocabResult: null,
            dictationResult: null,
            fullReadingResult: null,
          };
        });
        // Persist step 1 (reading-annotation) as the starting point
        if (user) {
          saveActiveSession(String(user.id), {
            sessionId: 0,
            storyId,
            currentStep: STEP_PATH_TO_NUMBER['reading-annotation'],
            timestamp: Date.now(),
          });
        }
      })
      .catch((err) => {
        setError(err.message || 'Failed to load story');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [storyId, selectedStory?.id, navigate]);

  // Ensure a DB session exists for step_progress persistence even when the flow
  // starts from assignment entry points that skip the legacy intro action.
  // Guard with isCreatingSession ref to prevent concurrent POSTs (Issue #984).
  useEffect(() => {
    if (!token || !storyId || dbSessionId !== null || isLoading) return;
    if (isCreatingSession.current) return;

    isCreatingSession.current = true;
    fetch(`${API_BASE}/api/learning/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ story_slug: storyId }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.id) {
          setDbSessionId(data.id);
          if (activeDbSessionStorageKey) {
            try { sessionStorage.setItem(activeDbSessionStorageKey, String(data.id)); } catch { /* non-fatal */ }
          }
          if (legacyDbSessionStorageKey) {
            try { sessionStorage.removeItem(legacyDbSessionStorageKey); } catch { /* non-fatal */ }
          }
        }
      })
      .catch(() => {
        // Non-fatal: local progress still works without DB.
      })
      .finally(() => {
        isCreatingSession.current = false;
      });
  }, [token, storyId, dbSessionId, isLoading, activeDbSessionStorageKey, legacyDbSessionStorageKey]);

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

    // Create a DB learning session so dialogue can be persisted (Issue #242).
    // Skip if a session already exists or another creation is in flight (Issue #984).
    if (token && storyId && dbSessionId === null && !isCreatingSession.current) {
      isCreatingSession.current = true;
      fetch(`${API_BASE}/api/learning/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ story_slug: storyId }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.id) {
            setDbSessionId(data.id);
            if (activeDbSessionStorageKey) {
              try { sessionStorage.setItem(activeDbSessionStorageKey, String(data.id)); } catch { /* non-fatal */ }
            }
            if (legacyDbSessionStorageKey) {
              try { sessionStorage.removeItem(legacyDbSessionStorageKey); } catch { /* non-fatal */ }
            }
          }
        })
        .catch(() => {
          // Non-fatal — dialogue won't be persisted but learning still works
        })
        .finally(() => {
          isCreatingSession.current = false;
        });
    }

    navigate(`/learn/${storyId}/reading-annotation`);
  }, [
    storyId,
    selectedStory,
    navigate,
    persistStep,
    token,
    dbSessionId,
    activeDbSessionStorageKey,
    legacyDbSessionStorageKey,
  ]);

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
      navigate(`/learn/${storyId}/full-reading`);
    },
    [storyId, navigate, persistStep, persistStepProgressState],
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
      navigate(`/learn/${storyId}/vocab-word-search`);
    },
    [storyId, navigate, persistStep, persistStepProgressState],
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
      navigate(`/learn/${storyId}/vocab-definition`);
    },
    [storyId, navigate, persistStep, persistStepProgressState],
  );

  const handleFinishDictation = useCallback(
    (result: DictationResult) => {
      setSession((prev) => (prev ? { ...prev, dictationResult: result } : null));
      persistStep(STEP_PATH_TO_NUMBER['vocab-word-search']);
      navigate(`/learn/${storyId}/vocab-word-search`);
    },
    [storyId, navigate, persistStep],
  );

  const handleFinishFullReading = useCallback(
    (result: FullReadingResult) => {
      setSession((prev) => (prev ? { ...prev, fullReadingResult: result } : null));
      persistStepProgressState(
        {
          completeStep: 'full-reading',
          currentStep: 'vocab',
          stepDataPatch: {
            'full-reading': { result },
          },
        },
        true,
      );
      persistStep(STEP_PATH_TO_NUMBER['vocab']);
      navigate(`/learn/${storyId}/vocab`);
    },
    [storyId, navigate, persistStep, persistStepProgressState],
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
      navigate(`/learn/${storyId}/tutor`);
    },
    [storyId, navigate, persistStep, persistStepProgressState],
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
      navigate(`/learn/${storyId}/vocab-application`);
    },
    [storyId, navigate, persistStep, persistStepProgressState],
  );

  const handleFinishVocabApplication = useCallback(
    (_result: VocabApplicationResult) => {
      setSession((prev) => (prev ? { ...prev, vocabApplicationCompleted: true } : null));
      persistStepProgressState(
        {
          completeStep: 'vocab-application',
          currentStep: 'comprehension',
          stepDataPatch: {
            'vocab-application': { completed: true },
          },
        },
        true,
      );
      persistStep(STEP_PATH_TO_NUMBER['comprehension']);
      navigate(`/learn/${storyId}/comprehension`);
    },
    [storyId, navigate, persistStep, persistStepProgressState],
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
      navigate(`/learn/${storyId}/knowledge-station`);
    },
    [storyId, navigate, persistStep, persistStepProgressState],
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
      navigate(`/learn/${storyId}/report`);
    },
    [storyId, navigate, persistStep, persistStepProgressState],
  );

  const handleRetry = useCallback(() => {
    clearPersistedSession();
    setSession(null);
    setLastAttempt(null);
    setSelectedStory(null);
    navigate('/library');
  }, [navigate, clearPersistedSession]);

  /** Called when a session is fully completed (report viewed). Auto-submits if assignment active. */
  const handleSessionComplete = useCallback(() => {
    // Auto-submit assignment if this session was started from an assignment.
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

    // Assignment not complete yet: keep progress/context; do not auto-submit.
    if (assignmentId != null && !shouldSubmit) {
      return;
    }

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
      // Fire-and-forget: best-effort auto-submit; errors are silent to avoid disrupting the report view.
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
  ]);

  /** Mark a paragraph as completed in both local state and session (Issue #85).
   * Also persists to localStorage so progress survives page refresh (Issue #689). */
  const handleParagraphComplete = useCallback((paragraphIndex: number) => {
    setCompletedParagraphsSet((prev) => {
      if (prev.has(paragraphIndex)) return prev;
      const updated = new Set(prev);
      updated.add(paragraphIndex);
      // Persist to localStorage (L1 cache) — key per story so different stories don't collide
      if (tutorCompletedStorageKey) {
        try {
          localStorage.setItem(tutorCompletedStorageKey, JSON.stringify(Array.from(updated)));
        } catch {
          // Non-fatal — in-memory state still updated
        }
      }
      return updated;
    });
    setSession((prev) => {
      if (!prev) return prev;
      const existing = new Set(prev.completedParagraphs ?? []);
      if (existing.has(paragraphIndex)) return prev;
      existing.add(paragraphIndex);
      return { ...prev, completedParagraphs: Array.from(existing) };
    });
  }, [storyId, tutorCompletedStorageKey]);

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
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-red-600">{error || '找不到此課文'}</p>
          <button
            onClick={() => navigate('/library')}
            className="text-accent hover:text-accent-hover font-medium text-sm"
          >
            返回圖書館
          </button>
        </div>
      </div>
    );
  }

  const ctx: LearningContext = {
    selectedStory,
    session,
    lastAttempt,
    rightPanelWidth,
    setRightPanelWidth,
    handleStartReading,
    handleFinishReading,
    handleFinishComprehension,
    handleFinishVocab,
    handleFinishDictation,
    handleFinishFullReading,
    handleFinishReadingAnnotation,
    handleFinishVocabDefinitionMatch,
    handleFinishVocabApplication,
    handleFinishVocabWordSearch,
    handleFinishKnowledgeStation,
    handleRetry,
    handleSessionComplete,
    emptyAttempt: EMPTY_ATTEMPT,
    dbSessionId,
    completedParagraphsSet,
    handleParagraphComplete,
    assignmentReadingGoals,
    syncProgress,
    flushProgress,
    stepProgressData: stepProgressState,
    saveStepProgressPatch,
    isAssignmentReadyForSubmit,
    missingAssignmentSteps,
    firstIncompleteStepPath,
    hasActiveAssignment,
  };

  return (
    <>
      <Outlet context={ctx} />
      <SessionTimeoutWarning
        visible={showTimeoutWarning}
        countdownSeconds={WARNING_COUNTDOWN_SECONDS}
        onContinue={handleContinueLearning}
        onExpired={handleSessionExpired}
      />
    </>
  );
};

/** Hook for child routes to access learning context. */
export function useLearningContext(): LearningContext {
  return useOutletContext<LearningContext>();
}

export default LearningLayout;
