const ACTIVE_ASSIGNMENT_CONTEXT_KEY = 'activeAssignmentContext';
const TOOLBOX_MODE_KEY = 'toolboxMode';

/**
 * Build a storage scope for learning-step cache keys.
 *
 * - Toolbox:       scope = storyId + "__t"      (#1460 — single-shot, isolated)
 * - Assignment:    scope = storyId + "__a_" + assignmentId
 * - Self-practice: scope = storyId
 *
 * Toolbox takes precedence so a student entering a tool from /tools never
 * sees self-practice or assignment leftovers (and vice versa).
 */
export function getLearningStorageScope(storyId: string | number): string {
  const storyKey = String(storyId);

  try {
    if (sessionStorage.getItem(TOOLBOX_MODE_KEY) === '1') {
      return `${storyKey}__t`;
    }

    const assignmentId = sessionStorage.getItem('activeAssignmentId');
    if (!assignmentId) return storyKey;

    const contextRaw = sessionStorage.getItem(ACTIVE_ASSIGNMENT_CONTEXT_KEY);
    if (contextRaw) {
      const context = JSON.parse(contextRaw) as { storyKey?: string | null };
      if (String(context.storyKey ?? '') !== storyKey) {
        return storyKey;
      }
    }

    return `${storyKey}__a_${assignmentId}`;
  } catch {
    return storyKey;
  }
}

export function scopedStepStorageKey(prefix: string, storyId: string | number): string {
  return `${prefix}${getLearningStorageScope(storyId)}`;
}

/**
 * Toggle toolbox-mode (#1460). When active:
 *   - localStorage scope gains a "__t" suffix → no data leak with self-practice
 *   - ImmersiveTopBar hides the multi-step navigation (single-shot UX)
 *   - Back button returns to /tools instead of /library
 */
export function setToolboxMode(active: boolean): void {
  try {
    if (active) sessionStorage.setItem(TOOLBOX_MODE_KEY, '1');
    else sessionStorage.removeItem(TOOLBOX_MODE_KEY);
  } catch {
    // sessionStorage unavailable (private mode, SSR) — best-effort
  }
}

export function isToolboxMode(): boolean {
  try {
    return sessionStorage.getItem(TOOLBOX_MODE_KEY) === '1';
  } catch {
    return false;
  }
}
