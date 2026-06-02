/**
 * learningSessionStorage.ts — session-storage helpers for LearningLayout (Issue #1878)
 *
 * Extracted from LearningLayout.tsx so the storage logic is testable in
 * isolation and does not clutter the React component.
 *
 * Key hierarchy (sessionStorage):
 *   assignment flow  → "assignment-db-session-{assignmentId}-{storyId}"
 *   self-practice    → "self-db-session-{storyId}"
 *   legacy (migrate) → "db-session-{storyId}"
 *
 * Toolbox mode never reads or writes any of these keys.
 */

// ─── Storage key prefixes / constants ────────────────────────────────────────

export const ACTIVE_ASSIGNMENT_CONTEXT_KEY = 'activeAssignmentContext';
export const LEGACY_DB_SESSION_KEY_PREFIX = 'db-session-';
export const ASSIGNMENT_DB_SESSION_KEY_PREFIX = 'assignment-db-session-';
export const SELF_DB_SESSION_KEY_PREFIX = 'self-db-session-';
export const SELF_PRACTICE_COMPLETED_KEY_PREFIX = 'self-practice-completed-';

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Build the active-session storage key for sessionStorage.
 *
 * Assignment flow: "assignment-db-session-{assignmentId}-{storyId}"
 *                  or "assignment-db-session-{storyId}" when assignmentId unknown.
 * Self-practice:   "self-db-session-{storyId}"
 */
export function buildActiveDbSessionKey(storyId: string, isAssignmentFlow: boolean): string {
  if (isAssignmentFlow) {
    try {
      const assignmentId = sessionStorage.getItem('activeAssignmentId');
      if (assignmentId) return `${ASSIGNMENT_DB_SESSION_KEY_PREFIX}${assignmentId}-${storyId}`;
    } catch {
      // sessionStorage unavailable — fall through to prefix-only key
    }
    return `${ASSIGNMENT_DB_SESSION_KEY_PREFIX}${storyId}`;
  }
  return `${SELF_DB_SESSION_KEY_PREFIX}${storyId}`;
}

/**
 * Read a saved dbSessionId from sessionStorage.
 *
 * Tries `activeKey` first, then falls back to `legacyKey`.
 * Returns null when nothing is found or the stored value is not a valid integer.
 */
export function readDbSessionId(activeKey: string, legacyKey: string | null): number | null {
  try {
    const direct = sessionStorage.getItem(activeKey);
    const legacy = legacyKey ? sessionStorage.getItem(legacyKey) : null;
    const raw = direct ?? legacy;
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

/**
 * Persist a dbSessionId to sessionStorage under `activeKey` and remove the
 * legacy key so subsequent reads go through the new key.
 */
export function writeDbSessionId(activeKey: string, legacyKey: string | null, id: number): void {
  try {
    sessionStorage.setItem(activeKey, String(id));
  } catch { /* non-fatal */ }
  try {
    if (legacyKey) sessionStorage.removeItem(legacyKey);
  } catch { /* non-fatal */ }
}

/**
 * Clear all session-related storage keys when a session ends.
 *
 * Called by clearPersistedSession in LearningLayout on session completion
 * or retry.  Each operation is wrapped independently — a failure in one
 * does not prevent the others from running.
 */
export function clearAllSessionKeys(opts: {
  activeKey: string | null;
  legacyKey: string | null;
  tutorLocalKey: string | null;
  liveTutorLocalKey: string | null;
}): void {
  try { if (opts.activeKey) sessionStorage.removeItem(opts.activeKey); } catch { /* non-fatal */ }
  try { if (opts.legacyKey) sessionStorage.removeItem(opts.legacyKey); } catch { /* non-fatal */ }
  try { if (opts.tutorLocalKey) localStorage.removeItem(opts.tutorLocalKey); } catch { /* non-fatal */ }
  try { if (opts.liveTutorLocalKey) localStorage.removeItem(opts.liveTutorLocalKey); } catch { /* non-fatal */ }
}
