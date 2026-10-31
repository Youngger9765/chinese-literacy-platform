/**
 * core/groupings/types.ts — GroupingStrategy 契約
 * （`.claude/skills/archipelago-module/SKILL.md` §2.2）。
 *
 * 這支只定義型別，不含任何邏輯——三個分群方式的實作（grade/genre/
 * category）都是薄層，實際運算全部委派給 `../archipelagoClusters.ts`
 * 既有的 `clusterKeyFor`/`groupIntoClusters`（搬進 core/ 時刻意「搬不
 * 重寫」，見 team-lead 2026-10-30 指示），這裡只是把它包成 SKILL 要求的
 * 介面形狀，給「未來要加一種全新分群方式」的人一個不用碰共用邏輯檔案的
 * 擴充點。
 */
import type { ClusterStory, ClusterMode } from '../archipelagoClusters';

/** `GroupingStrategy.clusters()` 回傳的群摘要——跟 `Cluster<T>` 的差別是
 *  這裡不帶完整課程陣列，只帶「這群長什麼樣子」給皮膚層（傳送門門牌、
 *  HUD 群摘要）用，不需要知道群內每一課的細節。 */
export interface ClusterSummary {
  key: string;
  label: string;
  storyCount: number;
}

export interface GroupingStrategy {
  id: ClusterMode | string;
  label: string;
  /** 一課屬於哪一群，必須唯一（同一課用同一個 strategy 呼叫兩次要回傳
   *  同一個 key）。 */
  clusterOf: (story: ClusterStory) => string;
  /** 把一批課程分成群摘要陣列——群的順序即顯示順序。 */
  clusters: (stories: ClusterStory[]) => ClusterSummary[];
}
