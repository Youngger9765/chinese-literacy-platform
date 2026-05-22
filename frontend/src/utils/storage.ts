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
