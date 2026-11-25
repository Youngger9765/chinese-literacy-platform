/**
 * storage.ts — Typed localStorage/sessionStorage helpers.
 *
 * Issue #1786: Centralizes auth token access so the key is never hardcoded
 * across files. Direct reads in AuthContext / ttsApi / useTtsPlayback /
 * learningApi / feedbackApi are replaced by authToken.* helpers here.
 *
 * Provides:
 *   - safeStorage.local / safeStorage.session  — try/catch-wrapped primitive ops
 *   - readJSON<T> / writeJSON                   — typed JSON serialization
 *   - AUTH_TOKEN_KEY                            — single source of truth for key name
 *   - authToken                                 — token read/write/header helpers
 *
 * Graceful degrade: Private browsing / Safari ITP / quota errors return null/false
 * instead of throwing, so callers never see a white screen from storage errors.
 */

// ---------------------------------------------------------------------------
// Raw safe storage
// ---------------------------------------------------------------------------

export const safeStorage = {
  local: {
    get(key: string): string | null {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string): boolean {
      try {
        localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key: string): void {
      try {
        localStorage.removeItem(key);
      } catch {
        // non-fatal
      }
    },
  },
  session: {
    get(key: string): string | null {
      try {
        return sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string): boolean {
      try {
        sessionStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key: string): void {
      try {
        sessionStorage.removeItem(key);
      } catch {
        // non-fatal
      }
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Typed JSON helpers
// ---------------------------------------------------------------------------

export function readJSON<T>(store: 'local' | 'session', key: string): T | null {
  const raw = safeStorage[store].get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJSON(store: 'local' | 'session', key: string, value: unknown): boolean {
  try {
    return safeStorage[store].set(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Auth token — single source of truth
// ---------------------------------------------------------------------------

/** The localStorage key under which the JWT is stored. Exported for tests
 *  and migration scripts; never duplicate this constant in other files. */
export const AUTH_TOKEN_KEY = 'lingoleap_token';

export const authToken = {
  get(): string | null {
    return safeStorage.local.get(AUTH_TOKEN_KEY);
  },
  set(token: string): void {
    safeStorage.local.set(AUTH_TOKEN_KEY, token);
  },
  remove(): void {
    safeStorage.local.remove(AUTH_TOKEN_KEY);
  },
  /** Returns `{ Authorization: 'Bearer <token>' }` or `{}` if no token. */
  authHeader(): Record<string, string> {
    const token = safeStorage.local.get(AUTH_TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
};

/**
 * 學習步驟在瀏覽器裡的快取前綴（#4081）。登出時全部清掉 —— 學習紀錄的真相在資料庫，
 * 這些只是快取；留著只會讓下一個在同一台裝置登入的人看到（並存進）上一個人的作答。
 * 新增一個步驟快取時把前綴加到這裡。
 */
export const LEARNING_CACHE_PREFIXES = [
  'annotations_',
  'fullReading_progress_',
  'vocabDef_progress_',
  'vocabApp_progress_',
  'vocab_app_progress_',
  'wordSearch_progress_',
  'knowledge_viewed_',
  'sentencePractice_progress_',
  'liveTutor_progress_',
  'tutor_completed_',
  'vocabPractice_progress_',
  'comprehension_completion_',
  'report_viewed_',
  'self-practice-completed-',
  'lingoleap-active-session-',
] as const;

export function clearLearningCache(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && LEARNING_CACHE_PREFIXES.some((p) => key.startsWith(p))) keys.push(key);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // localStorage unavailable (private mode, SSR) — best-effort
  }
}

// ---------------------------------------------------------------------------
// Session cleanup — single logout primitive
// ---------------------------------------------------------------------------

/**
 * localStorage flag set when the session was sourced from Junyi SSO (#1260).
 * Read on logout to decide whether to also clear Junyi-side cookies. Single
 * source of truth — never duplicate this constant in other files.
 */
export const JUNYI_SESSION_FLAG = 'lingoleap_junyi_session';

/** sessionStorage key holding the active assignment context (#1260). */
export const ACTIVE_ASSIGNMENT_CONTEXT_KEY = 'activeAssignmentContext';

/**
 * Clears all LingoLeap client-side credentials and learning session state:
 * the JWT (localStorage), the Junyi session flag, and per-session learning
 * keys in sessionStorage.
 *
 * Shared by AuthContext.logout and the Junyi Single Logout route
 * (JunyiSloLogoutPage) so both clear exactly the same state. Idempotent and
 * never throws — storage errors degrade gracefully. Callers own any React
 * state reset and post-cleanup navigation.
 */
export function clearAuthSession(): void {
  authToken.remove();
  // #4081：學習步驟的快取也清掉 —— 下一個在同一台裝置登入的人不該看到上一個人的作答。
  clearLearningCache();
  safeStorage.local.remove(JUNYI_SESSION_FLAG);
  try {
    sessionStorage.removeItem('activeAssignmentId');
    sessionStorage.removeItem('activeAssignmentGoals');
    sessionStorage.removeItem(ACTIVE_ASSIGNMENT_CONTEXT_KEY);

    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (!key) continue;
      if (
        key.startsWith('db-session-')
        || key.startsWith('assignment-db-session-')
        || key.startsWith('self-db-session-')
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // non-fatal
  }
}
