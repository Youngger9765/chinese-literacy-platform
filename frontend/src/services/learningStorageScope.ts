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

/**
 * Wipe every localStorage entry scoped under `${storyId}__t` (#1460).
 *
 * Called on each entry from /tools so consecutive practices of the same tool
 * always start blank — "每一次練習都是獨立的，紀錄不會留到下一次"
 * (UX spec, 2026-05-04).
 *
 * Self-practice (`${storyId}`) and assignment (`${storyId}__a_${id}`) keys
 * are unaffected because they don't end with `__t`.
 *
 * The suffix includes a leading underscore so `storyId=3` doesn't match keys
 * ending in `13__t`, `23__t`, etc. All scopedStepStorageKey prefixes end with
 * an underscore (e.g. `vocabDef_progress_`), so this is a safe and precise
 * boundary marker.
 */
export function clearToolboxScopeForStory(storyId: string | number): void {
  const suffix = `_${String(storyId)}__t`;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.endsWith(suffix)) {
        keysToRemove.push(key);
      }
    }
    for (const k of keysToRemove) {
      localStorage.removeItem(k);
    }
  } catch {
    // localStorage unavailable (private mode, SSR) — best-effort
  }
}
