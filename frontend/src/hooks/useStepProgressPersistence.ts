import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AuthUser } from '../services/authApi';
import { clearActiveSession, saveActiveSession } from '../services/api';
import { filterRequiredAssignmentSteps, resolveActiveSteps, stepIdMatchesCompleted, STEP_PATH_TO_NUMBER } from '../config/stepConfig';
import { useProgressSync } from './useProgressSync';
import { isIslandStoryMode, notifyIslandWordBabyReward } from '../pages/lab/island/storyMode';
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

/**
 * Merge progress loaded from the server into what the page already holds.
 *
 * Issue #3694: when two saves race, the losing one gets a 409 and the page
 * reloads progress from the server. That reload can return a snapshot taken
 * before the winning save landed, so replacing local state with it erased a
 * step the student had just finished; the page then asked them to redo it
 * even though the server (which only ever adds completed steps) still had it.
 * Completed steps therefore only grow here too, and step data the page
 * already has for a step wins over the loaded copy.
 */
export function mergeLoadedStepProgress(
  local: StepProgressData,
  loaded: StepProgressData,
): StepProgressData {
  const completed = [...(loaded.steps_completed ?? [])];
  for (const id of local.steps_completed ?? []) {
    if (!completed.includes(id)) completed.push(id);
  }
  return {
    current_step: loaded.current_step ?? local.current_step ?? null,
    steps_completed: completed,
    step_data: { ...(loaded.step_data ?? {}), ...(local.step_data ?? {}) },
  };
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
  // Latest progress for the load handler below, which runs from async callbacks.
  const stepProgressStateRef = useRef(stepProgressState);
  useEffect(() => { stepProgressStateRef.current = stepProgressState; }, [stepProgressState]);

  const lessonActiveSteps = useMemo(
    () => resolveActiveSteps(selectedStory?.stepSequence),
    [selectedStory?.stepSequence],
  );

  const requiredAssignmentSteps = useMemo(
    // See filterRequiredAssignmentSteps (stepConfig.ts) — single source of
    // truth shared with the assignment list's progress count (#3682), so
    // "done" never means two different things in two different screens.
    () => filterRequiredAssignmentSteps(lessonActiveSteps).map((s) => ({ id: s.id, label: s.label })),
    [lessonActiveSteps],
  );
  const completedStepsSet = useMemo(
    () => new Set(stepProgressState.steps_completed ?? []),
    [stepProgressState.steps_completed],
  );
  const missingAssignmentSteps = useMemo(() => {
    // #3682 fix C (part 3) — a legacy bare completion entry (saved before
    // the write-path fix started keying current_step/steps_completed
    // correctly) must still satisfy a now-composite requirement when there
    // is no ambiguity about which round it was for. See
    // stepIdMatchesCompleted's own doc comment for why.
    const requiredIds = requiredAssignmentSteps.map((s) => s.id);
    return requiredAssignmentSteps.filter(
      (s) => !stepIdMatchesCompleted(s.id, completedStepsSet, requiredIds),
    );
  }, [requiredAssignmentSteps, completedStepsSet]);
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
    // #3780 接島上：過關回島的「這站掉了碎片／遇到寶貝」小提示，只在喝采島
    // 故事模式下才有人在聽（ReadingIslandLab 的 message listener）——一般
    // /learn 教材框完全沒有接這個訊息，所以 gate 在這裡避免做無意義的
    // postMessage（iframe 外層是 window.top 自己時 postMessage 本來就是
    // no-op，但明確 gate 讓意圖看得見，也省一次呼叫）。
    onWordBabyRewarded: (rewards) => {
      if (isIslandStoryMode()) {
        notifyIslandWordBabyReward(rewards);
      }
    },
    // The server only ever adds completed steps, so after each save its list is
    // the truth. If a racing save left this page missing a step the server has,
    // adopt it; otherwise the student is asked to redo a finished step (#3694).
    onProgressSaved: (data) => {
      const serverCompleted = Array.isArray(data.steps_completed) ? data.steps_completed : [];
      const local = stepProgressStateRef.current;
      const missing = serverCompleted.filter((id) => !local.steps_completed.includes(id));
      if (missing.length === 0) return;
      const merged = { ...local, steps_completed: [...local.steps_completed, ...missing] };
      stepProgressStateRef.current = merged;
      setStepProgressState(merged);
      setSession((prev) => {
        if (!prev) return prev;
        const have = prev.completedSteps ?? [];
        return { ...prev, completedSteps: [...have, ...serverCompleted.filter((id) => !have.includes(id))] };
      });
    },
    onProgressLoaded: (data) => {
      const loadedStepData = (data.step_data ?? {}) as Record<string, unknown>;
      // Never let a reload drop a step this page already completed (#3694).
      const merged = mergeLoadedStepProgress(stepProgressStateRef.current, {
        current_step: data.current_step ?? null,
        steps_completed: Array.isArray(data.steps_completed) ? data.steps_completed : [],
        step_data: loadedStepData,
      });
      const loadedCompleted = merged.steps_completed;
      stepProgressStateRef.current = merged;
      setStepProgressState(merged);

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
          // Issue #3682 — tells the backend every required step is done, so it
          // can auto-submit a linked assignment from the DB side of the wire.
          //
          // Uses stepIdMatchesCompleted — the SAME satisfaction rule
          // missingAssignmentSteps/isAssignmentReadyForSubmit use below (round-
          // aware legacy-bare-entry backward compat, #3682 fix C part 3) — so
          // this flag and the UI's own "ready to submit" state can never
          // disagree. Computed fresh from `completed` (the list about to be
          // sent in THIS save), not from the isAssignmentReadyForSubmit return
          // value (which reflects the previous render's stepProgressState and
          // would lag one render behind this save). Deliberately NOT gated on
          // hasActiveAssignment/isAssignmentFlow: that flag is itself derived
          // from sessionStorage.getItem('activeAssignmentId')
          // (useLearningSessionBootstrap.ts), which is exactly what goes
          // missing when a student opens the lesson in a new tab, restarts
          // their browser, or comes back days later — the root cause of this
          // bug. requiredAssignmentSteps depends only on this story's own
          // step list, never on sessionStorage, so the flag still comes out
          // true in that scenario. The backend only acts on it when the
          // session is actually linked to an in_progress AssignmentSubmission
          // (maybe_auto_submit_assignment_session), so sending `true` for a
          // plain self-practice session is a harmless no-op.
          assignment_ready_for_submit:
            requiredAssignmentSteps.length > 0 &&
            requiredAssignmentSteps.every((s) =>
              stepIdMatchesCompleted(s.id, completed, requiredAssignmentSteps.map((r) => r.id)),
            ),
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
    [flushProgress, syncProgress, setSession, requiredAssignmentSteps],
  );


  const saveStepProgressPatch = useCallback(
    (opts: SaveStepProgressPatchOptions) => {
      // 一課多篇時，每個步驟頁傳的都是寫死的 base id（`keypoints-table`）——
      // 三篇會寫進同一個 key，做完第 2 篇第 1 篇也變完成，而且完全沒有徵兆。
      // 這裡補上網址帶的輪次；單篇課沒有 `#`，keyed === stepId，行為不變（#2930）。
      const k = opts.currentStepKey ?? '';
      const keyed = k.startsWith(`${opts.stepId}#`) ? k : opts.stepId;
      // Issue #3682 fix C（production root cause）：每個步驟頁呼叫這支時，
      // `currentStep` 傳的也是寫死的 bare id（跟 `opts.stepId` 一模一樣）——
      // 從來沒有人把輪次補上去。於是 `step_progress.current_step` 永遠是
      // bare 的，「班級作業→繼續」讀到它組網址時自然沒有 `?p=`，回到的頁
      // 讀不到輪次，這一步的完成紀錄也跟著存成 bare key，永遠對不上這堂課
      // 真正要求的 `base#slug`（recheck-prod.log case (b)）。
      //
      // 修法：caller 回報的就是「自己這一步」時（絕大多數真實呼叫都是這
      // 樣——`currentStep === stepId`），一併套用已經算好的 `keyed`；呼叫端
      // 明確指向別的步驟（例如完成後轉場到下一步）時維持原樣，不覆蓋。
      const keyedCurrentStep = opts.currentStep === opts.stepId ? keyed : opts.currentStep;
      persistStepProgressState(
        {
          currentStep: keyedCurrentStep,
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
        // Issue #3682 follow-up (team-lead review): the server's steps_completed
        // is now a monotonic union — simply omitting 'paragraph-reading' here
        // would get it silently re-added from stored data. reset_steps makes
        // this a DELIBERATE un-complete the server must honor, not a race.
        reset_steps: ['paragraph-reading'],
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
