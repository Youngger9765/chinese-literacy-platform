/**
 * AI 派發：從推薦清單挑 2 課（#4161）
 *
 * 推薦規則沿用現有後端（年級、弱項、體裁），這裡只負責「每次給 2 課、再派一組換下一組」。
 */
import type { StoryRecommendationItem } from '../../../services/progressApi';

export type DispatchRec = StoryRecommendationItem;
export const PAIR_SIZE = 2;
const DEFAULT_REASON = '依你的年級與最近的練習挑選';

/**
 * recs 已依分數由高到低；shown 是這個畫面已經派過的課號，exclude 是剛做完的那一課。
 * 回傳最多 PAIR_SIZE 張，每張一定有一句理由。
 */
export function pickPair(recs: DispatchRec[], shown: string[], exclude?: string): DispatchRec[] {
  const skip = new Set(shown);
  if (exclude) skip.add(exclude);
  return recs
    .filter((r) => !skip.has(r.story_slug))
    .slice(0, PAIR_SIZE)
    .map((r) => ({ ...r, reason: r.reason?.trim() ? r.reason : DEFAULT_REASON }));
}
