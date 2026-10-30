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

/**
 * 不規則群島版面邏輯（#3780 PRD §3.2 二次訂正，2026-10-31）——目前只有
 * 純函式＋測試，**尚未接進 `createArchipelagoWorld.ts`**（team-lead
 * 2026-10-31 授權：顏色/材質/造型細節等美術指導書出來再接，避免做兩次）。
 * 先透過這個 barrel 匯出，接線時呼叫端不用改 import 路徑。
 */
export {
  layoutArchipelago,
  blobMinDistance,
  CONNECTOR_MATERIALS,
  DISTANCE_THRESHOLD,
  type FootprintSize,
  type ConnectorMaterial,
  type HexCell,
  type IslandBlob,
  type IslandConnection,
  type ArchipelagoLayoutResult,
} from './archipelagoLayout';
