/**
 * core/index.ts — 骨架層公開介面（`.claude/skills/archipelago-module/
 * SKILL.md` §1：分群→座標→狀態→點島/登島→傳送門，「不知道長什麼樣子」）。
 *
 * 呼叫端（`StudentArchipelagoPage.tsx`／`createArchipelagoWorld.ts`）一律
 * 從這支檔案 import，不要直接 import `./archipelagoClusters`——實作細節
 * 將來要再拆（例如把蜂巢座標搬進獨立檔案）不會動到呼叫端的 import 路徑。
 */
export {
  normalizeGenre,
  normalizeCategory,
  clusterKeyFor,
  clusterLabel,
  groupIntoClusters,
  portalsFor,
  hexSpiralCoord,
  axialToCartesian,
  defaultClusterKey,
  type ClusterMode,
  type ClusterStory,
  type Cluster,
  type AxialCoord,
  type RecentProgressEntry,
} from './archipelagoClusters';

export { GROUPINGS, type GroupingStrategy, type ClusterSummary } from './groupings';
