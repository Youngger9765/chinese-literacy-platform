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
  const [assignmentContext, setAssignmentContext] = useState<AssignmentContext | null>(() => readAssignmentContext());
  const [assignmentReadingGoals] = useState<AssignmentReadingGoals | null>(() => {
    try {
      const raw = sessionStorage.getItem('activeAssignmentGoals');
      return raw ? (JSON.parse(raw) as AssignmentReadingGoals) : null;
    } catch {
      return null;
    }
  });
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
    if (isToolboxMode()) {
      setDbSessionId(null);
      return;
    }

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
      if (!directRaw && legacyRaw) {
        sessionStorage.setItem(activeDbSessionStorageKey, String(parsed));
      }
    } catch {
      setDbSessionId(null);
    }
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
      });
  }, [token, storyId, dbSessionId, isLoading, storeSessionId]);

  return {
    isAssignmentFlow,
    isToolboxFlow,
    assignmentContext,
    assignmentReadingGoals,
    dbSessionId,
    isLoading,
    error,
    selectedStory,
    session,
    setSession,
    setSelectedStory,
    ensureDbSession,
  };
}
