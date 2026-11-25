import { authToken } from '../utils/storage';

const ACTIVE_ASSIGNMENT_CONTEXT_KEY = 'activeAssignmentContext';
const TOOLBOX_MODE_KEY = 'toolboxMode';

/**
 * 目前登入的使用者 id，從登入 token 的 `sub` 解出來（#4081）。
 *
 * 學習步驟的快取原本只綁課：共用平板上，學生 A 做過的作答，學生 B 打開同一課時
 * 會被當成「還原進度」顯示出來，接著被存進 B 自己的資料庫紀錄。快取 key 綁上
 * 使用者，換人就是另一組 key。
 *
 * 從 token 解而不是從 React 狀態拿：步驟元件在 render 當下（lazy useState）就讀
 * 快取，比 AuthContext 的 effect 還早；token 是登入那一刻就寫好的，永遠跟目前的
 * 使用者一致。只是拿來分開快取，不做任何驗證，解不出來就回 null。
 */
export function currentLearnerId(): string | null {
  try {
    const token = authToken.get();
    const part = token?.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' || typeof sub === 'number' ? String(sub) : null;
  } catch {
    return null;
  }
}

/**
 * Build a storage scope for learning-step cache keys.
 *
 * Every scope is prefixed with `u<userId>__` when someone is logged in (#4081).
 *
 * - Toolbox:       scope = storyId + "__t"      (#1460 — single-shot, isolated)
 * - Assignment:    scope = storyId + "__a_" + assignmentId
 * - Self-practice: scope = storyId
 *
 * Toolbox takes precedence so a student entering a tool from /tools never
 * sees self-practice or assignment leftovers (and vice versa).
 */
export function getLearningStorageScope(storyId: string | number): string {
  const learner = currentLearnerId();
  // 使用者放在最前面：toolbox 的 `__t` 結尾不變，clearToolboxScopeForStory 照樣比得到。
  return learner ? `u${learner}__${storyScope(storyId)}` : storyScope(storyId);
}

function storyScope(storyId: string | number): string {
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

// 清除學習快取放在 utils/storage（登出流程在那裡，避免兩個模組互相 import）。
export { LEARNING_CACHE_PREFIXES, clearLearningCache } from '../utils/storage';
