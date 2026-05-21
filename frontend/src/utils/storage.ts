/**
 * storage.ts — typed, safe wrappers around localStorage / sessionStorage.
 *
 * #1786: previously 31+ files read/wrote storage directly, each with its own
 * ad-hoc try/catch (or none), and the auth-token key was hardcoded in 5+ places
 * (#1777 was caused by one of those copies using `'token'` instead of
 * `'lingoleap_token'`). This module centralises:
 *  - graceful degradation when storage is unavailable (private browsing,
 *    Safari ITP quota, disabled cookies)
 *  - the auth-token key (single source of truth)
 *  - typed JSON read/write
 *
 * Callers should NOT touch `localStorage` / `sessionStorage` directly. Add a
 * helper here instead.
 */

/* ─── primitives ─────────────────────────────────────────────────────────── */

function safeGet(area: Storage | null, key: string): string | null {
  if (!area) return null;
  try {
    return area.getItem(key);
  } catch {
    // Private browsing / cookies disabled / quota exceeded
    return null;
  }
}

function safeSet(area: Storage | null, key: string, value: string): boolean {
  if (!area) return false;
  try {
    area.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(area: Storage | null, key: string): void {
  if (!area) return;
  try {
    area.removeItem(key);
  } catch {
    /* swallow — storage unavailable */
  }
}

/* The `window.localStorage` property access itself can throw `SecurityError`
 * in Firefox when "block all cookies" is set, even though `'localStorage' in
 * window` returns true. Wrap each lookup in try/catch so this module can be
 * imported safely under any privacy setting. */
const _localStorage: Storage | null = (() => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
})();
const _sessionStorage: Storage | null = (() => {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
})();

export const safeStorage = {
  local: {
    get: (key: string): string | null => safeGet(_localStorage, key),
    set: (key: string, value: string): boolean => safeSet(_localStorage, key, value),
    remove: (key: string): void => safeRemove(_localStorage, key),
  },
  session: {
    get: (key: string): string | null => safeGet(_sessionStorage, key),
    set: (key: string, value: string): boolean => safeSet(_sessionStorage, key, value),
    remove: (key: string): void => safeRemove(_sessionStorage, key),
  },
};

/* ─── typed JSON helpers ─────────────────────────────────────────────────── */

export function readJSON<T>(area: 'local' | 'session', key: string): T | null {
  const raw = safeStorage[area].get(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Corrupted value — treat as missing.
    return null;
  }
}

export function writeJSON(area: 'local' | 'session', key: string, value: unknown): boolean {
  try {
    return safeStorage[area].set(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

/* ─── auth token (single source of truth, replaces hardcoded keys) ───────── */

export const AUTH_TOKEN_KEY = 'lingoleap_token';

export const authToken = {
  get: (): string | null => safeStorage.local.get(AUTH_TOKEN_KEY),
  set: (token: string): boolean => {
    const ok = safeStorage.local.set(AUTH_TOKEN_KEY, token);
    if (!ok && import.meta.env.DEV) {
      // Surface storage failures in dev (private mode / quota) — silent in
      // prod so we don't pollute users' consoles with a known degraded mode.
      // eslint-disable-next-line no-console
      console.warn('[storage] authToken.set failed — session will not persist across reload');
    }
    return ok;
  },
  remove: (): void => safeStorage.local.remove(AUTH_TOKEN_KEY),
  /** Build an Authorization header from the stored token. Empty object if not present.
   *  Goes through `authToken.get()` so any future logic added to get (refresh /
   *  expiry check) propagates here automatically. */
  authHeader: (): Record<string, string> => {
    const t = authToken.get();
    return t ? { Authorization: `Bearer ${t}` } : {};
  },
};
