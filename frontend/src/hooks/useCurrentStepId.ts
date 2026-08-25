import { useLocation } from 'react-router-dom';
import { STEP_REGISTRY } from '../config/stepConfig';

/**
 * Derive the learning step id from the current route instead of hardcoding it
 * in the page component (#2588).
 *
 * Learning routes are generated from STEP_REGISTRY by buildLearningRoutes():
 * `/learn/:storyId/<stepId>`, so the last path segment *is* the step id.  A page
 * that hardcodes its own id silently drifts when the step is renamed or mounted
 * on a second route — progress would be written under one key and read/completed
 * under another, which breaks assignment submission with no visible error.
 *
 * Fail-safe: the segment is only accepted when it is a registered step.  Anything
 * else (unknown segment, non-learning route, trailing slash) falls back to the
 * canonical id the caller passes in, so we never persist an unknown step key.
 *
 * ⚠️ Step ids are also persisted to the backend, which maps them to step numbers
 * via `_FRONTEND_STEP_ALIAS` / `STEP_NAMES` in `backend/app/models/session.py`.
 * Renaming a step id requires updating that map too.
 */
/**
 * 輪次 slug 的形狀 —— 抽取器發的不透明 id：24 個字母的字母表、5 碼。
 * 收得嚴一點，是因為這個值會變成進度紀錄的 key 寫進資料庫；
 * 讓網址決定 key 的形狀等於讓任何人塞任意字串進去。
 */
const ROUND_SLUG = /^[34679acdefhjkmnpqrtuvwxy]{4,8}$/;

export function useCurrentStepId(fallbackStepId: string): string {
  const { pathname, search } = useLocation();

  const segment = pathname.split('/').filter(Boolean).pop() ?? '';
  if (!STEP_REGISTRY[segment]) return fallbackStepId;

  // 一課印了好幾篇課文時，同一個大題會出現好幾次（#2916）。
  // 路由是從 STEP_REGISTRY 生的，路徑上只有 base id，輪次走 `?p=`：
  //     /learn/20063/key-passage-reading?p=9a7x4   → key-passage-reading#9a7x4
  // 不帶輪次的話三篇的進度會寫進同一個 key，最後一篇覆蓋前兩篇 ——
  // 而且完全沒有徵兆：有存到、讀得回來、只是三篇共用一份。
  const round = new URLSearchParams(search).get('p') ?? '';
  return ROUND_SLUG.test(round) ? `${segment}#${round}` : segment;
}

/**
 * 目前這一步屬於哪一節（`?p=` 的代號），沒有輪次就是 null（#2916）。
 *
 * 課堂上的 QR 按鈕要印**這一節自己的**代號 —— 老師站在第 2 篇的頁面按下去，
 * 印出來就該是第 2 篇的。少了它三篇會印出同一張 QR。
 */
export function useCurrentSectionSlug(): string | null {
  const stepId = useCurrentStepId('');
  const i = stepId.indexOf('#');
  return i < 0 ? null : stepId.slice(i + 1) || null;
}

export default useCurrentStepId;
