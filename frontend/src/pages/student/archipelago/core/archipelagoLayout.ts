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
 * **已接線**（2026-10-30 起）：`createArchipelagoWorld.ts` 的 `loadCluster()`
 * 直接呼叫這支的 `layoutArchipelago()` 決定位置/相鄰/連接物材料，長什麼
 * 樣子（色票/幾何/貼圖）向 `theme.connector()` 要——上面這段話是接線前
 * 寫的，接完線沒有一併更新，故修正（避免讀的人誤以為骨架還沒接這支）。
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

/**
 * 2026-10-31 team-lead 明令：≥50% 的課程島要是 2～3 格的多格島，不能還是
 * 正六角形那種觀感。原本的權重 [0.5, 0.35, 0.15]（理論期望值 50%）量起來
 * 實際只有 35～60% 不等、且群越大越低（71 島群只有 36.6%）——原因是
 * `growBlob()` 在擁擠處會提早結束、長不到目標大小，縮回 1 格，這個「縮水
 * 損耗」沒算進權重設計裡。把權重往多格的一側加重（期望值抬到 70%），
 * 留buffer 蓋過縮水損耗，20/30/50/71 四種規模實測都要 ≥50%（見
 * `archipelagoLayout.test.ts` 的鎖）。 */
const FOOTPRINT_WEIGHTS: ReadonlyArray<readonly [FootprintSize, number]> = [
  [1, 0.3],
  [2, 0.4],
  [3, 0.3],
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

// ---------------------------------------------------------------------------
// 連接物生成（team-lead 2026-10-31 二次訂正）：舊版「距離門檻內兩兩全連」
// 在小群裡會長出一張交叉的網——好幾條橋橫越整個畫面還互相交叉，門檻收緊
// 到 1 也沒解決，因為問題不是「連太遠」，是「每座島連太多條、而且沒人管
// 線段會不會打架」。改成：①每座島最多 2 條連線 ②先用最小生成樹保證整群
// 連通（可以用比門檻遠的邊，只要是連通整群最短的那些）③再從門檻內、還沒
// 連過的島對裡，挑「兩端都還有名額、不會跟任何既有線段交叉」
// 的加進去，數量自然很少（名額剩不多、交叉限制又擋掉大半）。
// ---------------------------------------------------------------------------

/** 每座島（含廣場）最多幾條連線——骨架常數，不是渲染層的事。 */
export const MAX_CONNECTIONS_PER_ISLAND = 2;

interface Point2D {
  x: number;
  z: number;
}

/** 2D 線段方向判斷（orientation test，redblobgames/一般計算幾何教材的標準
 *  寫法）：>0 逆時針、<0 順時針、≈0 共線。EPSILON 容忍浮點誤差。 */
function orientation(a: Point2D, b: Point2D, c: Point2D): number {
  const v = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const EPSILON = 1e-9;
  if (Math.abs(v) < EPSILON) return 0;
  return v > 0 ? 1 : -1;
}

function onSegment(a: Point2D, b: Point2D, p: Point2D): boolean {
  return (
    Math.min(a.x, b.x) - 1e-9 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-9 &&
    Math.min(a.z, b.z) - 1e-9 <= p.z && p.z <= Math.max(a.z, b.z) + 1e-9
  );
}

/**
 * 兩條線段是否相交（含端點共享不算相交——兩條連接物共用同一座島很正常，
 * 那是共用端點不是線段打架）。標準 orientation-based 演算法，涵蓋一般
 * 情況與共線特例。純函式，吃四個 2D 點，不碰任何群島特定的資料結構，
 * 可以直接餵合成座標測試。
 */
export function segmentsIntersect(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): boolean {
  // 共用端點＝同一座島的兩條不同連接物，不算「交叉」。
  const sharesEndpoint = (a: Point2D, b: Point2D) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9;
  if (sharesEndpoint(p1, p3) || sharesEndpoint(p1, p4) || sharesEndpoint(p2, p3) || sharesEndpoint(p2, p4)) {
    return false;
  }
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  // 共線重疊特例（理論上群島座標很難剛好共線，但還是處理，不留洞）。
  if (o1 === 0 && onSegment(p1, p2, p3)) return true;
  if (o2 === 0 && onSegment(p1, p2, p4)) return true;
  if (o3 === 0 && onSegment(p3, p4, p1)) return true;
  if (o4 === 0 && onSegment(p3, p4, p2)) return true;
  return false;
}

function distance2D(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** 簡易 union-find——Kruskal's MST 判斷「加這條邊會不會成環」要用。 */
class UnionFind {
  private parent: Map<string, string> = new Map();
  find(id: string): string {
    if (!this.parent.has(id)) this.parent.set(id, id);
    const p = this.parent.get(id)!;
    if (p === id) return id;
    const root = this.find(p);
    this.parent.set(id, root);
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  connected(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }
}

/**
 * 建出一整群的連接物——度數上限（`MAX_CONNECTIONS_PER_ISLAND`）＋
 * 不交叉是硬限制，分兩階段：
 *
 * ① 度數受限的最小生成樹（Kruskal 變體）：所有島兩兩配對依中心點距離
 *    由近到遠排序，依序嘗試加進去——加了會成環、或任一端已經額滿、或會
 *    跟已經加入的線段交叉，就跳過，換下一條。這個階段用「全部島對」不是
 *    只看門檻內的，因為目標是「保證整群連通」，必要時可以用比門檻遠一點
 *    的邊連住原本會孤立的島（但因為是由近到遠處理，實際選到的邊幾乎都還
 *    是很短，只有真的沒有更近選項時才會用遠邊）。
 * ② 額外的相鄰連線：① 做完後，门檻内、兩端都還有名額、且不會跟任何現有
 *    線段交叉的島對，依距離由近到遠補進去（這階段**不**檢查成環——多一條
 *    捷徑形成小迴圈是刻意要的視覺豐富度，不是 bug）。因為度數名額多半已
 *    經在①用完，這裡真正補得進去的數量自然很少。
 */
function buildConnections(allBlobs: readonly IslandBlob[], rand: () => number): IslandConnection[] {
  const byId = new Map(allBlobs.map((b) => [b.id, b]));
  const degree = new Map<string, number>(allBlobs.map((b) => [b.id, 0]));
  const accepted: { a: string; b: string }[] = [];

  const hasBudget = (id: string) => (degree.get(id) ?? 0) < MAX_CONNECTIONS_PER_ISLAND;
  const crossesExisting = (a: IslandBlob, b: IslandBlob) =>
    accepted.some((e) => segmentsIntersect(a.center, b.center, byId.get(e.a)!.center, byId.get(e.b)!.center));

  // 所有島對，依中心點距離由近到遠排序——近的優先，MST 跟「額外連線」都
  // 從這張同一份排序清單取用，只是篩選條件不同。
  const allPairs: { a: IslandBlob; b: IslandBlob; dist: number }[] = [];
  for (let i = 0; i < allBlobs.length; i++) {
    for (let j = i + 1; j < allBlobs.length; j++) {
      allPairs.push({ a: allBlobs[i], b: allBlobs[j], dist: distance2D(allBlobs[i].center, allBlobs[j].center) });
    }
  }
  allPairs.sort((p, q) => p.dist - q.dist);

  // ① 度數受限的 MST
  const uf = new UnionFind();
  for (const { a, b } of allPairs) {
    if (uf.connected(a.id, b.id)) continue; // 會成環
    if (!hasBudget(a.id) || !hasBudget(b.id)) continue;
    if (crossesExisting(a, b)) continue;
    uf.union(a.id, b.id);
    degree.set(a.id, (degree.get(a.id) ?? 0) + 1);
    degree.set(b.id, (degree.get(b.id) ?? 0) + 1);
    accepted.push({ a: a.id, b: b.id });
  }

  // ② 額外的相鄰連線（只看門檻內、還沒連過的島對，不檢查成環）
  const alreadyConnected = new Set(accepted.map((e) => [e.a, e.b].sort().join('|')));
  for (const { a, b, dist: _dist } of allPairs) {
    const key = [a.id, b.id].sort().join('|');
    if (alreadyConnected.has(key)) continue;
    if (blobMinDistance(a.cells, b.cells) > DISTANCE_THRESHOLD) continue;
    if (!hasBudget(a.id) || !hasBudget(b.id)) continue;
    if (crossesExisting(a, b)) continue;
    degree.set(a.id, (degree.get(a.id) ?? 0) + 1);
    degree.set(b.id, (degree.get(b.id) ?? 0) + 1);
    accepted.push({ a: a.id, b: b.id });
    alreadyConnected.add(key);
  }

  return accepted.map((e) => ({ a: e.a, b: e.b, material: pickMaterial(rand) }));
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

  // 相鄰互通：度數受限的 MST 保證整群連通＋少量額外相鄰連線（見
  // `buildConnections` 註解——取代舊版「門檻內兩兩全連」，那個做法在小群
  // 會長出一張交叉的網）。
  const allBlobs: readonly IslandBlob[] = [plaza, ...islands];
  const connections: IslandConnection[] = buildConnections(allBlobs, rand);

  const connectedIds = new Set<string>();
  for (const conn of connections) {
    connectedIds.add(conn.a);
    connectedIds.add(conn.b);
  }
  const isolatedIds = islands.filter((isl) => !connectedIds.has(isl.id)).map((isl) => isl.id);

  return { plaza, islands, connections, isolatedIds };
}
