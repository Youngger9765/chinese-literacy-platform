/**
 * archipelagoDomain.ts — pure, DOM-free logic for 我的群島頁 + 遊戲區「島嶼
 * 探索」卡 (#3780 D1/D3, PRD docs/prd/2026-10-26-reading-island-3d-prd.md
 * §5.6/§5.7/§6).
 *
 * `/api/learning/students/{id}/progress` 的 `is_occupied`/`stations_done`/
 * `stations_total` 已經是伺服器算好的（§5.6「兩邊各自寫測試、鎖同一組案例」
 * ——這支檔案只負責「用這些既有欄位」，不重新判定一次「這站算不算完成」，
 * 避免前後端規則分岔。
 */

export type IslandStatus = 'occupied' | 'in_progress' | 'not_started';

/** 從 `/progress` 的 `texts[]` 單筆抽出來的子集——故意只列這支檔案真正
 * 需要的欄位，不是整個 `TextProgressItem`，讓這份型別不會跟著後端回應
 * 多了什麼欄位就要改。 */
export interface ArchipelagoProgress {
  story_slug: string;
  is_occupied: boolean;
  has_session: boolean;
  stations_done: number;
  stations_total: number;
}

/** 從 `/api/stories` 單筆抽出來的子集。 */
export interface ArchipelagoStory {
  id: string;
  title: string;
  grade: string;
  /** #3780 群島模式（docs/prd/2026-10-30-archipelago-clusters-prd.md）：
   *  依文體／類別分群要用，原始值（未正規化），正規化規則見
   *  `archipelago/archipelagoClusters.ts` 的 `normalizeGenre`/`normalizeCategory`
   *  ——兩邊刻意分開，這裡只負責「資料長什麼樣」，正規化規則只活在一處。
   *  Optional（不是後端缺這兩欄，是既有呼叫端/測試只建構
   *  `{id,title,grade}` 這個子集——見 `buildArchipelago()` 用 `?? ''` 補
   *  預設值，不強迫既有呼叫端跟著改）。 */
  genre?: string;
  category?: string;
  /** 蜂巢螺旋排列順序，見 types.ts `Story.lessonSeq` 的說明。 */
  lessonSeq?: number;
}

export interface ArchipelagoIsland {
  storySlug: string;
  title: string;
  grade: string;
  genre: string;
  category: string;
  lessonSeq?: number;
  status: IslandStatus;
  stationsDone: number;
  stationsTotal: number;
}

/** 單課的佔領狀態——`is_occupied`/`has_session`/`stations_done` 三個欄位
 * 都是「同一套規則」算出來的（見 PRD §5.6），這裡只是把它們轉成給 UI 用的
 * 三態，不重新判斷任何一站完成與否。 */
export function islandStatus(progress: ArchipelagoProgress | undefined): IslandStatus {
  if (!progress || !progress.has_session) return 'not_started';
  if (progress.is_occupied) return 'occupied';
  return 'in_progress';
}

/** 合併 `/api/stories` 的全部課程清單跟 `/progress` 的 `texts[]`，用
 * `story_slug` 對照（PRD §5.6：「沒有出現在 texts[] 的課 = 完全沒碰過」）。
 * 保留 `stories` 原本的順序與筆數——這是唯一的權威課程清單（§5.7：只打
 * 這兩支 API 各一次，不逐課再打）。 */
export function buildArchipelago(
  stories: ArchipelagoStory[],
  progressTexts: ArchipelagoProgress[],
): ArchipelagoIsland[] {
  const bySlug = new Map(progressTexts.map((t) => [t.story_slug, t]));
  return stories.map((s) => {
    const p = bySlug.get(s.id);
    return {
      storySlug: s.id,
      title: s.title,
      grade: s.grade,
      genre: s.genre ?? '',
      category: s.category ?? '',
      lessonSeq: s.lessonSeq,
      status: islandStatus(p),
      stationsDone: p?.stations_done ?? 0,
      stationsTotal: p?.stations_total ?? 0,
    };
  });
}

export interface ArchipelagoFilter {
  grade?: string;
  /** 課名關鍵字，不分大小寫、部分比對。 */
  search?: string;
}

export function filterArchipelago(
  islands: ArchipelagoIsland[],
  filter: ArchipelagoFilter,
): ArchipelagoIsland[] {
  const search = filter.search?.trim().toLowerCase();
  return islands.filter((island) => {
    if (filter.grade && island.grade !== filter.grade) return false;
    if (search && !island.title.toLowerCase().includes(search)) return false;
    return true;
  });
}

/** 四年級看得懂的狀態文案（team-lead 明令：文案給四年級看得懂）。 */
export function islandStatusLabel(island: Pick<ArchipelagoIsland, 'status' | 'stationsDone' | 'stationsTotal'>): string {
  switch (island.status) {
    case 'occupied':
      return '已佔領';
    case 'in_progress':
      return `探索中 ${island.stationsDone}/${island.stationsTotal} 站`;
    case 'not_started':
      return '尚未探索';
  }
}

/** 已佔領島嶼數——遊戲區卡片跟群島頁都要用這個同一個函式算，兩邊數字
 * 才不會兜不起來（PRD §6「顯示的佔領數...跟群島頁一致」）。 */
export function occupiedCount(islands: ArchipelagoIsland[]): number {
  return islands.filter((i) => i.status === 'occupied').length;
}

/** 遊戲區卡片只打 `/progress`，沒有打 `/api/stories`，組不出完整的
 * `ArchipelagoIsland[]` 餵給 `occupiedCount()`。這支函式讓它直接對
 * `/progress` 的 `texts[]` 算，但底層呼叫的是同一個 `islandStatus()`——
 * 不是另外寫一條「看起來一樣」的規則（code review 2026-10-28：兩個計算
 * 路徑要證明真的共用同一套判定，不是巧合一致）。 */
export function occupiedCountFromProgress(progressTexts: ArchipelagoProgress[]): number {
  return progressTexts.filter((p) => islandStatus(p) === 'occupied').length;
}

/** PRD §6（D1／D3 前端，§5.7）：`/api/stories?page_size=300` 回來後要
 * 斷言 `stories.length === total`——`page_size=300` 理論上一次拿滿全部
 * 課程，但課程數哪天超過 300、或後端 `total` 算錯，分頁會悄悄漏課，
 * 畫面上只看起來「島變少了」，不會有任何提示。不相等就回一則訊息，
 * 呼叫端（StudentArchipelagoPage）負責印出來；維持純函式方便測、
 * 不在這裡直接呼叫 `console.error`。 */
export function storiesPageMismatchMessage(storiesLength: number, total: number): string | null {
  if (storiesLength === total) return null;
  return `我的群島頁：/api/stories 回傳 stories.length(${storiesLength}) 跟 total(${total}) 不相等，分頁可能漏課`;
}

/** 把年級選單拆成「數字年級」跟「特殊主題（文言文／品格教育）」兩組，
 * 各自保留後端回傳的原順序。四年級看這兩種混在同一排會搞不清楚差別
 * （code review 2026-10-28），所以 UI 要分兩排、不同樣式呈現。 */
export function splitGradeOptions(grades: string[]): { grades: string[]; themes: string[] } {
  const numeric: string[] = [];
  const themes: string[] = [];
  for (const g of grades) {
    (/^\d+$/.test(g) ? numeric : themes).push(g);
  }
  return { grades: numeric, themes };
}
