import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { AuthUser } from '../services/authApi';
import { fetchStory, saveActiveSession } from '../services/api';
import type { LearningSession, Story } from '../types';
import { STEP_PATH_TO_NUMBER } from '../config/stepConfig';
import { isToolboxMode } from '../services/learningStorageScope';
import type { AssignmentReadingGoals } from '../layouts/LearningLayout';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
const ACTIVE_ASSIGNMENT_CONTEXT_KEY = 'activeAssignmentContext';
const LEGACY_DB_SESSION_KEY_PREFIX = 'db-session-';
const ASSIGNMENT_DB_SESSION_KEY_PREFIX = 'assignment-db-session-';
const SELF_DB_SESSION_KEY_PREFIX = 'self-db-session-';

interface AssignmentContext {
  assignmentId?: number;
  userId?: string | null;
  storyKey?: string | null;
}

interface UseLearningSessionBootstrapOptions {
  storyId: string | undefined;
  user: AuthUser | null;
  token: string | null;
  navigate: NavigateFunction;
}

interface UseLearningSessionBootstrapReturn {
  isAssignmentFlow: boolean;
  isToolboxFlow: boolean;
  assignmentContext: AssignmentContext | null;
  assignmentReadingGoals: AssignmentReadingGoals | null;
  dbSessionId: number | null;
  /** Issue #3707 — true once the sessionStorage restore-lookup has run at
   *  least once for the current storyId (regardless of whether it found a
   *  session). False means dbSessionId's current `null` is still unchecked
   *  and must not be treated as "no existing session". */
  hasCheckedStoredSession: boolean;
  /** Issue #3707 — true once the orphaned-in-progress-session lookup has
   *  settled (found one / created a new one / failed), for the case where
   *  hasCheckedStoredSession resolved to "nothing stored". False while that
   *  fetch is in flight or hasn't started (recovery doesn't apply — e.g.
   *  toolbox mode, or dbSessionId is already non-null). */
  hasCheckedForOrphanedSession: boolean;
  isLoading: boolean;
  error: string | null;
  selectedStory: Story | null;
  session: LearningSession | null;
  setSession: React.Dispatch<React.SetStateAction<LearningSession | null>>;
  setSelectedStory: React.Dispatch<React.SetStateAction<Story | null>>;
  ensureDbSession: () => void;
}

function readAssignmentContext(): AssignmentContext | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_ASSIGNMENT_CONTEXT_KEY);
    return raw ? (JSON.parse(raw) as AssignmentContext) : null;
  } catch {
    return null;
  }
}

export function useLearningSessionBootstrap({
  storyId,
  user,
  token,
  navigate,
}: UseLearningSessionBootstrapOptions): UseLearningSessionBootstrapReturn {
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [session, setSession] = useState<LearningSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dbSessionId, setDbSessionId] = useState<number | null>(null);
  // Issue #3707 — false until the sessionStorage restore-lookup below has
  // actually run once (regardless of outcome), true forever after. Lets
  // LearningLayout tell "we haven't checked for an existing session yet"
  // (must wait) apart from "we checked and there genuinely isn't one"
  // (dbSessionId === null is final) — see the restore effect for why this
  // distinction matters.
  //
  // Scope note (critic review): this protects the FIRST mount only, not a
  // later storyId change on an instance that stays mounted (e.g. one-課多篇
  // navigating between texts without unmounting LearningLayout). Once true
  // it never resets, so a subsequent storyId swap gets no re-check window
  // from this flag — the pre-existing dbSessionId reset in the effect below
  // is still the only guard for that case, same as before this fix.
  const [hasCheckedStoredSession, setHasCheckedStoredSession] = useState(false);
  // Issue #3707 (critic review finding #2) — same race, sibling path: when
  // sessionStorage genuinely has no session for this story (hasCheckedStoredSession
  // is already true, dbSessionId stayed null), the effect below fires an async
  // lookup for an orphaned in_progress session before falling back to creating
  // a new one. LearningLayout's gate must keep waiting through that lookup too —
  // otherwise a step page mounts with dbSessionId still null on this exact same
  // "checked storage, found nothing, haven't checked the server yet" render,
  // reintroducing #3707 via the recovery path instead of the storage-restore path.
  const [hasCheckedForOrphanedSession, setHasCheckedForOrphanedSession] = useState(false);
  const [assignmentContext, setAssignmentContext] = useState<AssignmentContext | null>(() => readAssignmentContext());
  const [assignmentReadingGoals] = useState<AssignmentReadingGoals | null>(() => {
    try {
      const raw = sessionStorage.getItem('activeAssignmentGoals');
      return raw ? (JSON.parse(raw) as AssignmentReadingGoals) : null;
    } catch {
      return null;
    }
  });
  // Shared between ensureDbSession() (called manually, e.g. from
  // handleStartReading) and the auto-recovery effect below — both can try to
  // create a session for this story, and this ref is their mutex. A narrow
  // edge case this doesn't cover: if ensureDbSession() wins the race, the
  // auto-recovery effect's own early return (isCreatingSession.current is
  // already true) never reaches its `.finally()`, so
  // hasCheckedForOrphanedSession stays false for that render cycle — resolved
  // once ensureDbSession's own call sets dbSessionId, which makes this
  // hook's third waitingForProgress clause moot anyway (dbSessionId !== null).
  const isCreatingSession = useRef(false);
  const isToolboxFlow = isToolboxMode();

  useEffect(() => {
    setAssignmentContext(readAssignmentContext());
  }, [storyId, user]);

  const isAssignmentFlow = useMemo(() => {
    if (!storyId) return false;
    try {
      const assignmentId = sessionStorage.getItem('activeAssignmentId');
      if (!assignmentId) return false;
      if (!assignmentContext) return true;
      const storyMatch = String(assignmentContext.storyKey ?? '') === String(storyId);
      const userMatch = !assignmentContext.userId || !user || String(assignmentContext.userId) === String(user.id);
      return storyMatch && userMatch;
    } catch {
      return false;
    }
  }, [assignmentContext, storyId, user]);

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

  const legacyDbSessionStorageKey = useMemo(() => {
    if (!storyId) return null;
    return `${LEGACY_DB_SESSION_KEY_PREFIX}${storyId}`;
  }, [storyId]);

  const storeSessionId = useCallback(
    (id: number) => {
      setDbSessionId(id);
      if (activeDbSessionStorageKey) {
        try { sessionStorage.setItem(activeDbSessionStorageKey, String(id)); } catch { /* non-fatal */ }
      }
      if (legacyDbSessionStorageKey) {
        try { sessionStorage.removeItem(legacyDbSessionStorageKey); } catch { /* non-fatal */ }
      }
    },
    [activeDbSessionStorageKey, legacyDbSessionStorageKey],
  );

  useEffect(() => {
    // Issue #3707 — single exit point so `hasCheckedStoredSession` flips to
    // true exactly once per lookup, on every path (found / not found / bad
    // value / storage unavailable). Previously each branch returned early
    // right after `setDbSessionId`, which is what let a step page mount
    // while dbSessionId still held its unchecked `null` default.
    let nextId: number | null = null;

    if (!isToolboxMode() && storyId && activeDbSessionStorageKey) {
      try {
        const directRaw = sessionStorage.getItem(activeDbSessionStorageKey);
        const legacyRaw = legacyDbSessionStorageKey
          ? sessionStorage.getItem(legacyDbSessionStorageKey)
          : null;
        const chosenRaw = directRaw ?? legacyRaw;
        if (chosenRaw) {
          const parsed = parseInt(chosenRaw, 10);
          if (!Number.isNaN(parsed)) {
            nextId = parsed;
            if (!directRaw && legacyRaw) {
              sessionStorage.setItem(activeDbSessionStorageKey, String(parsed));
            }
          }
        }
      } catch {
        nextId = null;
      }
    }

    setDbSessionId(nextId);
    setHasCheckedStoredSession(true);
  }, [storyId, activeDbSessionStorageKey, legacyDbSessionStorageKey]);

  useEffect(() => {
    if (!storyId) {
      navigate('/library', { replace: true });
      return;
    }

    if (selectedStory?.id === storyId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    fetchStory(storyId)
      .then((story) => {
        setSelectedStory(story);
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
        if (user) {
          saveActiveSession(String(user.id), {
            sessionId: 0,
            storyId,
            currentStep: STEP_PATH_TO_NUMBER['full-text-annotate'],
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

  const ensureDbSession = useCallback(() => {
    if (isToolboxMode()) return;
    if (!token || !storyId || dbSessionId !== null) return;
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
          storeSessionId(data.id);
        }
      })
      .catch(() => {
        // Non-fatal — dialogue won't be persisted but learning still works
      })
      .finally(() => {
        isCreatingSession.current = false;
      });
  }, [token, storyId, dbSessionId, storeSessionId]);

  useEffect(() => {
    if (isToolboxMode()) return;
    if (!token || !storyId || dbSessionId !== null || isLoading) return;
    if (isCreatingSession.current) return;

    isCreatingSession.current = true;

    fetch(`${API_BASE}/api/learning/sessions?story_slug=${encodeURIComponent(storyId)}&status=in_progress&limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const existing = data?.items?.[0];
        if (existing?.id) {
          storeSessionId(existing.id);
          return null;
        }
        return fetch(`${API_BASE}/api/learning/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ story_slug: storyId }),
        });
      })
      .then((res) => {
        if (!res) return null;
        return res.ok ? res.json() : null;
      })
      .then((data) => {
        if (data?.id) {
          storeSessionId(data.id);
        }
      })
      .catch(() => {
        // Non-fatal: local progress still works without DB.
      })
      .finally(() => {
        isCreatingSession.current = false;
        setHasCheckedForOrphanedSession(true);
      });
  }, [token, storyId, dbSessionId, isLoading, storeSessionId]);

  return {
    isAssignmentFlow,
    isToolboxFlow,
    assignmentContext,
    assignmentReadingGoals,
    dbSessionId,
    hasCheckedStoredSession,
    hasCheckedForOrphanedSession,
    isLoading,
    error,
    selectedStory,
    session,
    setSession,
    setSelectedStory,
    ensureDbSession,
  };
}
