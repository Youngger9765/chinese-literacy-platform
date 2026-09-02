import { useCallback, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AuthUser } from '../services/authApi';
import { clearActiveSession, saveActiveSession } from '../services/api';
import { resolveActiveSteps, STEP_PATH_TO_NUMBER } from '../config/stepConfig';
import { useProgressSync } from './useProgressSync';
import type { StepProgressData } from '../services/learningApi';
import type {
  ComprehensionResult,
  KeyPassageReadingResult,
  LearningSession,
  ReadingAttempt,
  Story,
  VocabResult,
} from '../types';
import { scopedStepStorageKey } from '../services/learningStorageScope';

const LEGACY_DB_SESSION_KEY_PREFIX = 'db-session-';
const ASSIGNMENT_DB_SESSION_KEY_PREFIX = 'assignment-db-session-';
const SELF_DB_SESSION_KEY_PREFIX = 'self-db-session-';

const STEP_NUMBER_TO_PATH: Record<number, string> = Object.fromEntries(
  Object.entries(STEP_PATH_TO_NUMBER).map(([path, n]) => [n, path]),
);

interface PersistStepProgressOptions {
  currentStep?: string | null;
  completeStep?: string;
  stepDataPatch?: Record<string, unknown>;
}

interface SaveStepProgressPatchOptions {
  /** 目前這一步的完整 key（多篇課帶 `#slug`）。由 LearningLayout 補上，
   *  各步驟頁只要照舊傳 base id 就好（#2930）。 */
  currentStepKey?: string;
  stepId: string;
  stepData: Record<string, unknown>;
  currentStep?: string | null;
  markCompleted?: boolean;
  immediate?: boolean;
}

interface UseStepProgressPersistenceOptions {
  storyId: string | undefined;
  user: AuthUser | null;
  token: string | null;
  dbSessionId: number | null;
  selectedStory: Story | null;
  isAssignmentFlow: boolean;
  setSession: Dispatch<SetStateAction<LearningSession | null>>;
}

interface UseStepProgressPersistenceReturn {
  stepProgressState: StepProgressData;
  persistStepProgressState: (opts: PersistStepProgressOptions, immediate: boolean) => void;
  persistStep: (step: number) => void;
  saveStepProgressPatch: (opts: SaveStepProgressPatchOptions) => void;
  clearPersistedSession: () => void;
  /** Issue #2532: full tutor reset for「再讀一次」— clears all completion/成績 sources. */
  resetTutorStep: () => void;
  completedParagraphsSet: Set<number>;
  setCompletedParagraphsSet: Dispatch<SetStateAction<Set<number>>>;
  handleParagraphComplete: (paragraphIndex: number) => void;
  lessonActiveSteps: ReturnType<typeof resolveActiveSteps>;
  completedStepsSet: Set<string>;
  missingAssignmentSteps: Array<{ id: string; label: string }>;
  isAssignmentReadyForSubmit: boolean;
  firstIncompleteStepPath: string;
  hasActiveAssignment: boolean;
  syncProgress: (data: StepProgressData) => void;
  flushProgress: (data: StepProgressData) => void;
  /**
   * Issue #3024 — badge keys unlocked mid-session by a step-complete save,
   * not yet acknowledged by the student. Rendered by LearningLayout as a
   * BadgeUnlockToast. Empty array when there is nothing pending.
   */
  midSessionBadgeUnlocks: string[];
  /** Dismiss the current mid-session badge unlock toast (Issue #3024). */
  dismissMidSessionBadgeUnlocks: () => void;
}

export function useStepProgressPersistence({
  storyId,
  user,
  token,
  dbSessionId,
  selectedStory,
  isAssignmentFlow,
  setSession,
}: UseStepProgressPersistenceOptions): UseStepProgressPersistenceReturn {
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

  const [completedParagraphsSet, setCompletedParagraphsSet] = useState<Set<number>>(() => {
    const scopedTutorKey = storyId ? scopedStepStorageKey('tutor_completed_', storyId) : null;
    const scopedParagraphReadingKey = storyId ? scopedStepStorageKey('liveTutor_progress_', storyId) : null;
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
    try {
      const liveTutorRaw = scopedParagraphReadingKey ? localStorage.getItem(scopedParagraphReadingKey) : null;
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

  const [stepProgressState, setStepProgressState] = useState<StepProgressData>({
    current_step: null,
    steps_completed: [],
    step_data: {},
  });

  const lessonActiveSteps = useMemo(
    () => resolveActiveSteps(selectedStory?.stepSequence),
    [selectedStory?.stepSequence],
  );

  const requiredAssignmentSteps = useMemo(
    () => lessonActiveSteps.filter((s) => s.id !== 'report').map((s) => ({ id: s.id, label: s.label })),
    [lessonActiveSteps],
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
  const firstIncompleteStepPath = missingAssignmentSteps[0]?.id ?? 'full-text-annotate';
  const hasActiveAssignment = useMemo(() => {
    try {
      return isAssignmentFlow;
    } catch {
      return false;
    }
  }, [isAssignmentFlow]);

  // Issue #3024 — badge keys unlocked mid-session, pending student ack.
  const [midSessionBadgeUnlocks, setMidSessionBadgeUnlocks] = useState<string[]>([]);
  const dismissMidSessionBadgeUnlocks = useCallback(() => {
    setMidSessionBadgeUnlocks([]);
  }, []);

  const { syncProgress, flushProgress, isProgressLoading } = useProgressSync({
    token: token ?? null,
    dbSessionId,
    onXpAwarded: ({ badgesUnlocked }) => {
      if (badgesUnlocked.length > 0) {
        setMidSessionBadgeUnlocks((prev) => [...prev, ...badgesUnlocked]);
      }
    },
    onProgressLoaded: (data) => {
      const loadedCompleted = Array.isArray(data.steps_completed) ? data.steps_completed : [];
      const loadedStepData = (data.step_data ?? {}) as Record<string, unknown>;

      setStepProgressState({
        current_step: data.current_step ?? null,
        steps_completed: loadedCompleted,
        step_data: loadedStepData,
      });

      if (loadedStepData.tutor) {
        const tutorData = loadedStepData.tutor as Record<string, unknown>;
        const completedIdxs = tutorData.completedParagraphs;
        if (Array.isArray(completedIdxs)) {
          setCompletedParagraphsSet(new Set(completedIdxs as number[]));
        }
      }

      setSession((prev) => {
        if (!prev) return prev;
        const tutorData = (loadedStepData.tutor ?? {}) as Record<string, unknown>;
        const fullReadingData = (loadedStepData['key-passage-reading'] ?? {}) as Record<string, unknown>;
        const vocabData = (loadedStepData.vocab ?? {}) as Record<string, unknown>;
        const comprehensionData = (loadedStepData.comprehension ?? {}) as Record<string, unknown>;
        const readingAnnotationData = (loadedStepData['full-text-annotate'] ?? {}) as Record<string, unknown>;
        const vocabDefinitionData = (loadedStepData['vocab-definition'] ?? {}) as Record<string, unknown>;
        const vocabApplicationData = (loadedStepData['vocab-application'] ?? {}) as Record<string, unknown>;
        const vocabWordSearchData = (loadedStepData['vocab-review'] ?? {}) as Record<string, unknown>;
        const knowledgeStationData = (loadedStepData['knowledge-station'] ?? {}) as Record<string, unknown>;

        return {
          ...prev,
          completedSteps: loadedCompleted,
          readingAttempt: (tutorData.readingAttempt as ReadingAttempt | undefined) ?? prev.readingAttempt,
          fullReadingResult: (fullReadingData.result as KeyPassageReadingResult | undefined) ?? prev.fullReadingResult,
          vocabResult: (vocabData.result as VocabResult | undefined) ?? prev.vocabResult,
          comprehensionResult: (comprehensionData.result as ComprehensionResult | undefined) ?? prev.comprehensionResult,
          readingAnnotationCompleted:
            (readingAnnotationData.completed as boolean | undefined) ?? loadedCompleted.includes('full-text-annotate') ?? prev.readingAnnotationCompleted,
          vocabDefinitionMatchCompleted:
            (vocabDefinitionData.completed as boolean | undefined) ?? loadedCompleted.includes('vocab-definition') ?? prev.vocabDefinitionMatchCompleted,
          vocabApplicationCompleted:
            (vocabApplicationData.completed as boolean | undefined) ?? loadedCompleted.includes('vocab-application') ?? prev.vocabApplicationCompleted,
          vocabWordSearchCompleted:
            (vocabWordSearchData.completed as boolean | undefined) ?? loadedCompleted.includes('vocab-review') ?? prev.vocabWordSearchCompleted,
          knowledgeStationCompleted:
            (knowledgeStationData.completed as boolean | undefined) ?? loadedCompleted.includes('knowledge-station') ?? prev.knowledgeStationCompleted,
        };
      });
    },
  });

  const persistStepProgressState = useCallback(
    (opts: PersistStepProgressOptions, immediate: boolean) => {
      setStepProgressState((prev) => {
        const completed = new Set<string>(prev.steps_completed);
        if (opts.completeStep) completed.add(opts.completeStep);

        // Issue #2530: merge each step's patch ONE LEVEL deep instead of replacing the
        // whole step entry. A partial finish patch (e.g. tutor's { readingAttempt }) must
        // not wipe detailed data another writer already put under the same step key
        // (e.g. ParagraphReading's line_results / paragraph_summaries_data). Also fixes the
        // latent same issue for full-reading (#2503). Non-object values still replace.
        const mergedStepData: Record<string, unknown> = { ...prev.step_data };
        const isPlainObject = (v: unknown): v is Record<string, unknown> =>
          !!v && typeof v === 'object' && !Array.isArray(v);
        for (const [key, patchVal] of Object.entries(opts.stepDataPatch ?? {})) {
          const prevVal = mergedStepData[key];
          mergedStepData[key] = isPlainObject(prevVal) && isPlainObject(patchVal)
            ? { ...prevVal, ...patchVal }
            : patchVal;
        }

        const next: StepProgressData = {
          current_step: opts.currentStep ?? prev.current_step,
          steps_completed: Array.from(completed),
          step_data: mergedStepData,
        };

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
    [flushProgress, syncProgress, setSession],
  );


  const saveStepProgressPatch = useCallback(
    (opts: SaveStepProgressPatchOptions) => {
      // 一課多篇時，每個步驟頁傳的都是寫死的 base id（`keypoints-table`）——
      // 三篇會寫進同一個 key，做完第 2 篇第 1 篇也變完成，而且完全沒有徵兆。
      // 這裡補上網址帶的輪次；單篇課沒有 `#`，keyed === stepId，行為不變（#2930）。
      const k = opts.currentStepKey ?? '';
      const keyed = k.startsWith(`${opts.stepId}#`) ? k : opts.stepId;
      persistStepProgressState(
        {
          currentStep: opts.currentStep,
          completeStep: opts.markCompleted ? keyed : undefined,
          stepDataPatch: {
            [keyed]: {
              ...opts.stepData,
            },
          },
        },
        opts.immediate ?? false,
      );
    },
    [persistStepProgressState],
  );

  const persistStep = useCallback(
    (step: number) => {
      if (!user || !storyId) return;
      saveActiveSession(String(user.id), {
        sessionId: 0,
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
    activeDbSessionStorageKey,
    legacyDbSessionStorageKey,
    tutorCompletedStorageKey,
    liveTutorProgressStorageKey,
  ]);

  const handleParagraphComplete = useCallback((paragraphIndex: number) => {
    setCompletedParagraphsSet((prev) => {
      if (prev.has(paragraphIndex)) return prev;
      const updated = new Set(prev);
      updated.add(paragraphIndex);
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
  }, [setSession, tutorCompletedStorageKey]);

  /**
   * Issue #2532 (review): full tutor reset for「再讀一次」. `resetForRetry()` in
   * useParagraphReadingProgress only clears React state + liveTutor_progress_ localStorage —
   * that's a "half reset". Completion/成績 actually live in FOUR places; this clears
   * ALL of them so navigating away+back or a full reload can't resurrect old data:
   *   1. step_data.tutor — fully replaced with an empty entry (also drops readingAttempt)
   *   2. steps_completed — 'paragraph-reading' removed (so the stepper doesn't stay ticked)
   *   3. session.readingAttempt / completedParagraphs / completedSteps('paragraph-reading')
   *      (ReportPage reads session.readingAttempt; reload rehydrates it from step_data)
   *   4. completedParagraphsSet (in-memory) + tutor_completed_ / liveTutor_progress_ localStorage
   */
  const resetTutorStep = useCallback(() => {
    setCompletedParagraphsSet(new Set());
    if (tutorCompletedStorageKey) {
      try { localStorage.removeItem(tutorCompletedStorageKey); } catch { /* non-fatal */ }
    }
    if (liveTutorProgressStorageKey) {
      try { localStorage.removeItem(liveTutorProgressStorageKey); } catch { /* non-fatal */ }
    }

    setStepProgressState((prev) => {
      const completed = new Set(prev.steps_completed);
      completed.delete('paragraph-reading');
      const next: StepProgressData = {
        current_step: prev.current_step,
        steps_completed: Array.from(completed),
        step_data: {
          ...prev.step_data,
          // Full replace (not shallow merge) so readingAttempt / reading_attempt are dropped too.
          tutor: {
            completed_paragraphs: [],
            paragraph_summaries: [],
            current_line_index: 0,
            line_results: [],
            paragraph_summaries_data: {},
          },
        },
      };
      flushProgress(next); // immediate — the student may navigate right after
      return next;
    });

    setSession((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        readingAttempt: null,
        completedParagraphs: [],
        completedSteps: (prev.completedSteps ?? []).filter((s) => s !== 'paragraph-reading'),
      };
    });
  }, [
    tutorCompletedStorageKey,
    liveTutorProgressStorageKey,
    setCompletedParagraphsSet,
    flushProgress,
    setSession,
  ]);

  return {
    stepProgressState,
    persistStepProgressState,
    persistStep,
    saveStepProgressPatch,
    clearPersistedSession,
    resetTutorStep,
    completedParagraphsSet,
    setCompletedParagraphsSet,
    handleParagraphComplete,
    lessonActiveSteps,
    completedStepsSet,
    missingAssignmentSteps,
    isAssignmentReadyForSubmit,
    firstIncompleteStepPath,
    hasActiveAssignment,
    syncProgress,
    flushProgress,
    isProgressLoading,
    midSessionBadgeUnlocks,
    dismissMidSessionBadgeUnlocks,
  };
}
