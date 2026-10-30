/**
 * archipelagoLayout.ts — 不規則群島佈局 + 相鄰互通（#3780 PRD §3.2 二次
 * 訂正，docs/prd/2026-10-30-archipelago-clusters-prd.md，2026-10-31
 * Young：「做出不規則群島的感覺，相鄰的島有一點互通的機制，但隨意
 * 材料」，取代前一版「蜂巢螺旋＋逐一連成一條鍊」）。
 *
 * 範圍（team-lead 2026-10-31 明確授權，等美術指導書出來前只做這段）：
 * 這支只管「版面邏輯」——島的大小形狀、擺放位置、哪些島相鄰互通、連接物
 * 材料是哪一種（純字串標籤）。長什麼樣子（色票/幾何/貼圖）是皮膚層的事，
 * 等 `docs/design/island-v2/art-direction.md` 出來才做，這裡不含任何
 * three.js 物件、不含任何顏色或造型決定。
 *
 * **尚未接線**：`createArchipelagoWorld.ts` 目前還是用
 * `hexSpiralCoord`/舊版逐一連線——那是「骨架」，依指示先不動，等美術
 * 指導書出來、connector 的渲染方式定案後再一次接進去（避免做兩次）。
 *
 * 決定性：同一組 `storyIds`（呼叫端已經照 lessonSeq 排序）+ 同一個
 * `seed` 字串，兩次呼叫結果逐欄位相等——不靠 `Math.random()`，靠字串
 * 雜湊出種子餵給 mulberry32（公開演算法，不是自己發明的隨機數學，來源
 * https://github.com/bryc/code/blob/master/jshash/PRNGs.md）。
 */

import { hexSpiralCoord, axialToCartesian, type AxialCoord } from './archipelagoClusters';

export type FootprintSize = 1 | 2 | 3;

/** 連接物材料——只是資料標籤，渲染成真的橋/石頭/船是皮膚層的事（等美術
 *  指導書）。這裡只保證「有 5 種，隨機挑，不是永遠同一種」。 */
export const CONNECTOR_MATERIALS = ['boardwalk', 'stepping-stones', 'rope-bridge', 'shoal', 'ferry'] as const;
export type ConnectorMaterial = (typeof CONNECTOR_MATERIALS)[number];

/** 兩座島之間「夠近才算相鄰互通」的格距門檻（PRD §3.2：「連接只出現在
 *  距離門檻內」）。這是可調的骨架常數，不是鎖死的魔法數字——美術指導書
 *  出來後如果視覺上覺得太密/太疏，調這個數字即可，不需要動演算法本身。
 *
 * 2026-10-31 從 2 收緊到 1（team-lead 真機截圖抓到：小群的連接物視覺上
 * 橫跨螢幕一大部分，像連到很遠的島）——格距 2 在小群（例如 20 座島）
 * 佔整群範圍的比例遠大於在大群（71 座島），視覺上看起來不成比例地長；
 * 收緊到 1（只接受真正緊鄰、共用一格邊界距離的島）後，連接物長度會
 * 跟島本身的格子大小同一個量級，不會看起來像橫跨地圖的長橋。 */
export const DISTANCE_THRESHOLD = 1;

export interface HexCell {
  q: number;
  r: number;
}

export interface IslandBlob {
  /** 課程 id，或 `'plaza'`（傳送門廣場）。 */
  id: string;
  /** 1~3 格，彼此在同一塊內緊鄰（連通的 polyhex），互不跟別座島重疊。 */
  cells: HexCell[];
  /** 這塊格子的世界座標中心（平均值）。 */
  center: { x: number; z: number };
}

export interface IslandConnection {
  a: string;
  b: string;
  material: ConnectorMaterial;
}

export interface ArchipelagoLayoutResult {
  plaza: IslandBlob;
  islands: IslandBlob[];
  connections: IslandConnection[];
  /** 零連接的島 id，明確列出來——PRD §3.2「每座島至少有一個鄰居或明確
   *  標為獨立島」，呼叫端不必自己從 `connections` 反推誰是孤島。 */
  isolatedIds: string[];
}

// ---------------------------------------------------------------------------
// 決定性 PRNG（mulberry32）——字串種子先用 FNV-1a 雜湊成整數，再餵進去。
// ---------------------------------------------------------------------------

function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0; // FNV-1a offset basis
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seedNum: number): () => number {
  let a = seedNum >>> 0;
  return function rand(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 六角格幾何——跟 `archipelagoClusters.ts` 同一套 axial 座標系與六個方向
// 單位向量（redblobgames.com/grids/hexagons），刻意不 import 它的私有
// `HEX_DIRECTIONS`（沒有 export），在這裡重宣告同一組標準常數；這是「骨架
// 不要動」的保守做法——零風險地不碰那支已經被鎖住測試的檔案。
// ---------------------------------------------------------------------------

const HEX_DIRECTIONS: readonly AxialCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function cellKey(c: HexCell): string {
  return `${c.q},${c.r}`;
}

function neighborsOf(c: HexCell): HexCell[] {
  return HEX_DIRECTIONS.map((d) => ({ q: c.q + d.q, r: c.r + d.r }));
}

function hexDistance(a: HexCell, b: HexCell): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - (b.q + b.r)) + Math.abs(a.r - b.r)) / 2;
}

/** 兩個島塊之間最短的格距——「夠近才連」用這個判斷，不是比中心點距離
 *  （中心點距離在島塊大小不一時會失真，格距才是真正決定「這兩塊中間隔
 *  幾格水」的量）。 */
export function blobMinDistance(a: readonly HexCell[], b: readonly HexCell[]): number {
  let min = Infinity;
  for (const ca of a) {
    for (const cb of b) {
      const d = hexDistance(ca, cb);
      if (d < min) min = d;
    }
  }
  return min;
}

// ---------------------------------------------------------------------------
// 島塊生成：1~3 格的連通 polyhex，形狀不固定（不是永遠長成一直線）
// ---------------------------------------------------------------------------

const FOOTPRINT_WEIGHTS: ReadonlyArray<readonly [FootprintSize, number]> = [
  [1, 0.5],
  [2, 0.35],
  [3, 0.15],
];

function pickFootprintSize(rand: () => number): FootprintSize {
  const roll = rand();
  let acc = 0;
  for (const [size, weight] of FOOTPRINT_WEIGHTS) {
    acc += weight;
    if (roll < acc) return size;
  }
  return 1; // 保底（理論上加總=1，浮點誤差極端情況才會落到這裡）
}

function pickMaterial(rand: () => number): ConnectorMaterial {
  const idx = Math.floor(rand() * CONNECTOR_MATERIALS.length);
  return CONNECTOR_MATERIALS[Math.min(idx, CONNECTOR_MATERIALS.length - 1)];
}

/**
 * 從 `seedCell` 長出一塊 `size` 格的連通 polyhex——每一步隨機挑「目前這塊
 * 裡的哪一格」、再隨機挑「往哪個方向長」，形狀才不會永遠長成一直線。
 * `occupied` 是全域已佔用格（其他島/廣場/水道），只讀不寫（呼叫端自己
 * 決定何時把回傳的格子標記進 `occupied`）。長不到目標大小時提早結束
 * （地圖邊緣/擁擠處會發生，回傳比 `size` 小的陣列，不是 bug）。
 */
function growBlob(seedCell: HexCell, size: FootprintSize, occupied: ReadonlySet<string>, rand: () => number): HexCell[] {
  const cells: HexCell[] = [seedCell];
  const cellSet = new Set<string>([cellKey(seedCell)]);
  while (cells.length < size) {
    let grown = false;
    const cellStart = Math.floor(rand() * cells.length);
    for (let ci = 0; ci < cells.length && !grown; ci++) {
      const from = cells[(cellStart + ci) % cells.length];
      const dirs = neighborsOf(from);
      const dirStart = Math.floor(rand() * dirs.length);
      for (let di = 0; di < dirs.length; di++) {
        const cand = dirs[(dirStart + di) % dirs.length];
        const key = cellKey(cand);
        if (occupied.has(key) || cellSet.has(key)) continue;
        cells.push(cand);
        cellSet.add(key);
        grown = true;
        break;
      }
    }
    if (!grown) break;
  }
  return cells;
}

function averageCartesian(cells: readonly HexCell[], hexSize: number): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (const c of cells) {
    const p = axialToCartesian(c, hexSize);
    x += p.x;
    z += p.z;
  }
  return { x: x / cells.length, z: z / cells.length };
}

// ---------------------------------------------------------------------------
// 主函式
// ---------------------------------------------------------------------------

/**
 * 給一群課程 id（已經照 lessonSeq 排序，`groupIntoClusters()` 的輸出）＋
 * 種子字串，算出整個不規則群島佈局：每座島多大、擺在哪、哪些相鄰互通、
 * 連接物是哪一種材料。
 *
 * @param storyIds 這一群的課程 id，依序處理（順序會影響佈局，呼叫端要
 *   傳固定順序才能保證「同一群每次打開長一樣」——`groupIntoClusters()`
 *   本身已經保證 lessonSeq 排序）
 * @param seed 種子字串，建議用 `${mode}:${clusterKey}` 這類穩定字串，
 *   不要用時間戳記或隨機值
 * @param hexSize 相鄰格中心距離（世界單位），預設 1——實際渲染時由呼叫端
 *   傳 `createArchipelagoWorld.ts` 的 `HEX_SIZE` 常數
 */
export function layoutArchipelago(storyIds: readonly string[], seed: string, hexSize = 1): ArchipelagoLayoutResult {
  const rand = mulberry32(hashSeed(seed));
  const occupied = new Set<string>();

  // 傳送門廣場固定在中心，給 3 格（PRD §3.2「比其他島大、明顯」——結構上
  // 真的比一般 1 格島大，不是只靠渲染放大倍率）。
  const plazaCells = growBlob({ q: 0, r: 0 }, 3, occupied, rand);
  for (const c of plazaCells) occupied.add(cellKey(c));
  const plaza: IslandBlob = { id: 'plaza', cells: plazaCells, center: averageCartesian(plazaCells, hexSize) };

  let spiralIndex = 1;
  function nextFreeCell(): HexCell {
    // 用既有的蜂巢螺旋序列當「候選巡邏路線」——不是直接照順序緊貼著放，
    // 真正的「不規則」來自下面三件事：①隨機跳過 0~2 個候選格永遠當水道
    // ②每座島長成 1~3 格不等、形狀不固定 ③螺旋序列本身在環與環的接縫
    // 處本來就不是每一步都緊鄰。
    for (;;) {
      const c = hexSpiralCoord(spiralIndex);
      spiralIndex += 1;
      if (!occupied.has(cellKey(c))) return c;
    }
  }

  const islands: IslandBlob[] = [];
  for (const storyId of storyIds) {
    // 隨機留白：跳過的候選格直接標記成水道，永久不再被選中——寬窄不一的
    // 水道就是這樣來的，不是每座島都緊貼著前一座。
    const skip = Math.floor(rand() * 3); // 0, 1, 2
    for (let i = 0; i < skip; i++) {
      occupied.add(cellKey(nextFreeCell()));
    }

    const size = pickFootprintSize(rand);
    const seedCell = nextFreeCell();
    const cells = growBlob(seedCell, size, occupied, rand);
    for (const c of cells) occupied.add(cellKey(c));
    islands.push({ id: storyId, cells, center: averageCartesian(cells, hexSize) });
  }

  // 相鄰互通：只排近的（距離門檻內），不是每座都連——也不是只連「前一座」
  // （舊版那條鍊的病根），是看「真實格距」兩兩判斷。
  const allBlobs: readonly IslandBlob[] = [plaza, ...islands];
  const connections: IslandConnection[] = [];
  for (let i = 0; i < allBlobs.length; i++) {
    for (let j = i + 1; j < allBlobs.length; j++) {
      if (blobMinDistance(allBlobs[i].cells, allBlobs[j].cells) <= DISTANCE_THRESHOLD) {
        connections.push({ a: allBlobs[i].id, b: allBlobs[j].id, material: pickMaterial(rand) });
      }
    }
  }

  const connectedIds = new Set<string>();
  for (const conn of connections) {
    connectedIds.add(conn.a);
    connectedIds.add(conn.b);
  }
  const isolatedIds = islands.filter((isl) => !connectedIds.has(isl.id)).map((isl) => isl.id);

  return { plaza, islands, connections, isolatedIds };
}
