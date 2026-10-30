/**
 * archipelagoClusters.ts — pure, DOM-free clustering logic for 群島模式
 * (#3780, docs/prd/2026-10-30-archipelago-clusters-prd.md).
 *
 * 179 課不互聯——依「年級」「文體」「類別」三種可切換方式分成大群（§2），
 * 每群一張場景、用蜂巢螺旋排列小島（§3.2）。這支只管「怎麼分、怎麼排、
 * 落在哪群」，不碰 three.js/DOM；3D 場景在
 * `createArchipelagoWorld.ts` 另外用 createIslandWorld.ts 同一套慣例寫。
 */

export type ClusterMode = 'grade' | 'genre' | 'category';

/** 分群用得到的最小課程子集——跟 `archipelagoDomain.ts` 的
 * `ArchipelagoIsland`/`ArchipelagoStory` 故意保持欄位相容（genre/category/
 * lessonSeq 同名），呼叫端兩邊都能直接餵進來，不用轉接。 */
export interface ClusterStory {
  id: string;
  grade?: string;
  genre?: string;
  category?: string;
  lessonSeq?: number;
}

/**
 * PRD §2.2「文體」正規化表——原始值到正規化桶。鍵是真實
 * `/api/stories` 擷取到的原始字串（含「論說文」「記敘說理文」這類沒有
 * 直接寫在 PRD 表格裡、但確實出現在真實資料的變體）。查不到的值一律
 * fail-closed 歸「其他」，不炸錯、不讓新的課程型態靜默消失。
 */
const GENRE_CANONICAL: Record<string, string> = {
  說明文: '說明文',
  記敘文: '記敘文',
  議論文: '議論文',
  文言文: '文言文',
  抒情文: '抒情文',
  應用文: '應用文',
  論說文: '議論文', // PRD §2.2：議論文（含論說文）
  記敘說理文: '記敘文', // PRD §2.2：記敘文（含記敘說理／記敘抒情／科學故事）
  記敘抒情文: '記敘文',
  '記敘文/科學故事': '記敘文',
};

export function normalizeGenre(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '其他';
  return GENRE_CANONICAL[trimmed] ?? '其他';
}

/** PRD §2.2「類別」正規化表——後端存的是英文代碼（Science/Fable/
 * History/Daily），這裡轉成中文顯示名稱。 */
const CATEGORY_CANONICAL: Record<string, string> = {
  Science: '自然科學',
  Fable: '寓言故事',
  History: '歷史人文',
  Daily: '生活',
};

export function normalizeCategory(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '其他';
  return CATEGORY_CANONICAL[trimmed] ?? '其他';
}

/** 這一課在指定分群方式下屬於哪一群的 key——`grade` 直接用原始值（後端
 * 回傳的 grade 本身就是互斥、已經是最終分類，不需要正規化表）。 */
export function clusterKeyFor(story: ClusterStory, mode: ClusterMode): string {
  if (mode === 'grade') return story.grade?.trim() || '其他';
  if (mode === 'genre') return normalizeGenre(story.genre);
  return normalizeCategory(story.category);
}

const GRADE_LABELS: Record<string, string> = {
  '4': '第 4 級群島',
  '5': '第 5 級群島',
  '6': '第 6 級群島',
  '7': '第 7 級群島',
  '8': '第 8 級群島',
  '9': '第 9 級群島',
  品格教育: '品格群島',
  文言文: '古文群島',
};

/** 群島顯示名稱——年級有專屬命名（PRD §2.1 表格最後一欄），文體／類別
 * 統一用「{key}群島」。 */
export function clusterLabel(key: string, mode: ClusterMode): string {
  if (mode === 'grade') return GRADE_LABELS[key] ?? `${key}群島`;
  return `${key}群島`;
}

/** 三種分群方式各自的群顯示順序——不是字母序或出現順序，年級要照 PRD §2.1
 * 表格由小到大＋兩個主題放最後；文體／類別照 PRD §2.2 表格列出的順序，
 * 「其他」永遠排最後。不在表裡的 key（理論上不該發生，§2.2 正規化表已經
 * 涵蓋全部真實原始值）排在已知順序之後，不會讓整個排序炸掉。 */
const CLUSTER_KEY_ORDER: Record<ClusterMode, string[]> = {
  grade: ['4', '5', '6', '7', '8', '9', '品格教育', '文言文'],
  genre: ['說明文', '記敘文', '議論文', '抒情文', '文言文', '應用文', '其他'],
  category: ['自然科學', '寓言故事', '歷史人文', '生活', '其他'],
};

function clusterSortIndex(key: string, mode: ClusterMode): number {
  const idx = CLUSTER_KEY_ORDER[mode].indexOf(key);
  return idx === -1 ? CLUSTER_KEY_ORDER[mode].length : idx;
}

export interface Cluster<T extends ClusterStory = ClusterStory> {
  key: string;
  mode: ClusterMode;
  label: string;
  /** 群內課程，依 `lessonSeq`（查無則退回 `Number(id)`）排序——這是蜂巢
   *  螺旋由內而外排列要用的順序（§3.2），不是原始陣列順序。 */
  stories: T[];
}

/**
 * 把一批課程依指定方式分群——§8.5/§8.8 的核心邏輯：三種分群方式分別
 * 跑一次都要「加總 = 全部課數、每課只出現一次」，用 `__tests__/
 * archipelagoClusters.test.ts` 對真實 179 課資料鎖住。
 */
export function groupIntoClusters<T extends ClusterStory>(stories: readonly T[], mode: ClusterMode): Cluster<T>[] {
  const byKey = new Map<string, T[]>();
  for (const story of stories) {
    const key = clusterKeyFor(story, mode);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(story);
  }
  return [...byKey.entries()]
    .map(([key, list]) => ({
      key,
      mode,
      label: clusterLabel(key, mode),
      stories: [...list].sort((a, b) => (a.lessonSeq ?? Number(a.id)) - (b.lessonSeq ?? Number(b.id))),
    }))
    .sort((a, b) => clusterSortIndex(a.key, mode) - clusterSortIndex(b.key, mode));
}

/** 傳送門廣場上該顯示哪些門——PRD §4：「當前分群方式的其他每一群各一座
 *  門」，不含自己這一群。 */
export function portalsFor<T extends ClusterStory>(clusters: readonly Cluster<T>[], currentKey: string): Cluster<T>[] {
  return clusters.filter((c) => c.key !== currentKey);
}

// ---------------------------------------------------------------------------
// 蜂巢螺旋座標（PRD §3.2：傳送門廣場在中心，課程島由內而外沿六角蜂巢螺旋排列）
// ---------------------------------------------------------------------------

export interface AxialCoord {
  q: number;
  r: number;
}

/** 六角格六個方向的軸座標單位向量——標準參考實作
 * （redblobgames.com/grids/hexagons 的 axial 座標系），不是自己發明的。 */
const HEX_DIRECTIONS: readonly AxialCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function hexAdd(a: AxialCoord, b: AxialCoord): AxialCoord {
  return { q: a.q + b.q, r: a.r + b.r };
}

function hexScale(a: AxialCoord, k: number): AxialCoord {
  return { q: a.q * k, r: a.r * k };
}

/** 半徑 `radius`（≥1）那一圈的全部格子，從方向 4 的起點開始，依序走 6 條
 *  邊、每邊 `radius` 步——這是「環」本身的幾何，跟 index 怎麼對應到哪個
 *  環是兩件事，分開寫比較看得懂、也比較好測。 */
function hexRing(radius: number): AxialCoord[] {
  const result: AxialCoord[] = [];
  let hex = hexScale(HEX_DIRECTIONS[4], radius);
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      result.push(hex);
      hex = hexAdd(hex, HEX_DIRECTIONS[side]);
    }
  }
  return result;
}

/**
 * 第 `index` 個蜂巢格的軸座標——index=0 是中心（傳送門廣場），index 1~6
 * 是第一環，7~18 是第二環，以此類推（第 k 環有 6k 格）。決定性、不含
 * 隨機，同一個 index 永遠算出同一個座標（§3.2「位置是決定性的」）。
 */
export function hexSpiralCoord(index: number): AxialCoord {
  if (index === 0) return { q: 0, r: 0 };
  let remaining = index;
  let ring = 1;
  while (remaining > 6 * ring) {
    remaining -= 6 * ring;
    ring += 1;
  }
  return hexRing(ring)[remaining - 1];
}

/** 軸座標轉三維世界座標（flat-top 六角格），`size` 是相鄰格中心距離。
 *  只用 x/z（跟 createIslandWorld.ts 一樣地面在 x-z 平面，y 是高度）。 */
export function axialToCartesian(coord: AxialCoord, size: number): { x: number; z: number } {
  const x = size * (3 / 2) * coord.q;
  const z = size * ((Math.sqrt(3) / 2) * coord.q + Math.sqrt(3) * coord.r);
  return { x, z };
}

// ---------------------------------------------------------------------------
// 預設落點（PRD §5）
// ---------------------------------------------------------------------------

export interface RecentProgressEntry {
  storySlug: string;
  hasSession: boolean;
  /** ISO 字串，用字串比較即可（同一來源格式一致，不需要真的 parse 成
   *  Date——避免把時區/格式解析的風險帶進一個應該很單純的純函式）。 */
  startedAt: string;
}

/**
 * PRD §5：預設落在「最近一次學習的那一課所在的群」，沒有學習紀錄（或查無
 * 對照課程、或全部都是 `hasSession=false`）就退回第 4 級——grade 模式的
 * fallback 明確是 `'4'`；其他分群方式沒有自然對應的「預設」，一樣退回
 * grade='4' 那一課所在的群（呼叫端通常本來就是在 grade 模式下決定落點，
 * 其餘模式由使用者自己切換，不強求每種模式都要猜一個「最近」）。
 */
export function defaultClusterKey<T extends ClusterStory>(
  progress: readonly RecentProgressEntry[],
  clusters: readonly Cluster<T>[],
  mode: ClusterMode,
): string {
  const storyToCluster = new Map<string, string>();
  for (const cluster of clusters) {
    for (const story of cluster.stories) storyToCluster.set(story.id, cluster.key);
  }

  const withSession = progress.filter((p) => p.hasSession && storyToCluster.has(p.storySlug));
  if (withSession.length > 0) {
    const mostRecent = [...withSession].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    return storyToCluster.get(mostRecent.storySlug)!;
  }

  if (mode === 'grade') return '4';
  // genre/category 模式沒有 PRD 定義的「預設主題」，退回「第 4 級那些課」
  // 所在的群，確保一定回傳一個真的存在於 `clusters` 裡的 key，不會讓呼叫
  // 端拿到一個查不到群的死胡同 key。
  const gradeFourStory = [...clusters].flatMap((c) => c.stories).find((s) => s.grade === '4');
  return gradeFourStory ? clusterKeyFor(gradeFourStory, mode) : clusters[0]?.key ?? '4';
}
