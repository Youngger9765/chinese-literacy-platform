import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { disposeObjectTree } from '../../lab/island/islandBuildingShapes';
import { axialToCartesian, type ClusterMode } from './core/archipelagoClusters';
import { layoutArchipelago, type IslandBlob, type HexCell } from './core/archipelagoLayout';
import { createSceneCtx } from './core/sceneCtx';
import type { IslandStatus } from './core/islandStatus';
import { requiredGroundRadius } from './core/groundRadius';
import type { ArchipelagoTheme, CellInfo } from './themes/types';

/**
 * createArchipelagoWorld.ts — 群島模式 3D 場景骨架（#3780，
 * docs/prd/2026-10-30-archipelago-clusters-prd.md §3/§4/§7/§8.5；
 * `.claude/skills/archipelago-module/SKILL.md`）。
 *
 * 模組重構（2026-10-30）：這支不再寫死任何視覺（底面、顏色常數）——長
 * 什麼樣子一律向傳進來的 `theme: ArchipelagoTheme` 要（`themes/` 底下的
 * 各份皮膚設定檔）。這支只管：鏡頭、互動（拖曳/縮放/點擊/hover）、佈局
 * 座標換算、換群時的資源釋放、resize/render loop——SKILL §1「骨架層
 * 不知道長什麼樣子」。
 *
 * **不規則群島佈局**（PRD §3.2 二次訂正，2026-10-31）：位置／哪些島相鄰／
 * 連接材料全部由 `core/archipelagoLayout.ts` 的 `layoutArchipelago()`
 * 決定（純函式，已獨立測試＋mutation-tested）——取代舊版蜂巢螺旋＋逐一
 * 連成一條鍊。種子直接用「這一群的課程 id 依序接起來」，保證「同一群
 * 每次打開長一樣」不需要額外傳參數。
 *
 * 跟 `lab/island/createIslandWorld.ts`（單課島、第一人稱走動）是兩種場景：
 * 這支是「一張地圖看一整群課程島＋中央傳送門廣場」的俯瞰場景，互動是拖曳
 * 旋轉／縮放＋點擊選取，不是第一人稱移動。
 *
 * 效能取捨（team-lead 2026-10-30 授權「介面不合理就直接改」）：用
 * `island(ctx, cell): THREE.Object3D` 介面整座島（含地基）交給主題建——
 * 代價是拿掉了地基的 InstancedMesh。在目前的規模（單群最多 71 座島，
 * `genre`/`category` 模式最大群）這不是效能問題——InstancedMesh 是給數百
 * 上千個實例才真的重要；拿掉它換來的是「換主題真的只改一份設定檔，
 * 骨架一行都不用動」，這是 SKILL 的核心訴求。
 */

export interface ArchipelagoWorldIsland {
  storySlug: string;
  title: string;
  /** 已正規化（自然科學/寓言故事/歷史人文/生活/其他）——呼叫端必須先用
   *  `core/archipelagoClusters.ts` 的 `normalizeCategory()` 轉過一次再傳
   *  進來（code review 2026-10-30 blocker：之前呼叫端直接傳
   *  `/api/stories` 的原始類別碼，這裡／現在主題的 `landmarks` 比對的是
   *  中文標籤，兩邊對不上，全部島都掉進 default 造型）。 */
  category: string;
  status: IslandStatus;
  stationsDone: number;
  stationsTotal: number;
}

export interface ArchipelagoWorldPortal {
  key: string;
  label: string;
  occupiedCount: number;
  total: number;
}

export interface ArchipelagoWorldEvents {
  onSelectIsland: (storySlug: string) => void;
  onSelectPortal: (clusterKey: string) => void;
  onHoverIsland?: (storySlug: string | null) => void;
}

/** 相鄰六角格中心距離——決定「島跟島隔多遠」的骨架常數，不是主題設定，
 *  換皮不該改變佈局間距。同時也是 `unionBoundary()` 的 `cellRadius`
 *  （透過 `CellInfo.cellRadius` 傳給皮膚），讓同一座島裡黏在一起的格子
 *  剛好緊貼、不留縫——見 `themes/types.ts` `CellInfo.cellRadius` 的說明。 */
export const HEX_SIZE = 3.6;

/** 傳送門離廣場中心多遠——骨架常數（跟 `HEX_SIZE` 一樣，換皮不該改變
 *  佈局間距）。 */
const PORTAL_DISTANCE_FROM_HUB = 3.0;

/** 名牌重疊偵測／遮擋 raycast 節流（美術指導書 §7：「每幀投影所有名牌的
 *  螢幕座標…節流到每 3 幀一次」）——不是效能擔心的猜測，是指導書明寫的
 *  頻率，照做。 */
const NAMEPLATE_THROTTLE_FRAMES = 3;

/**
 * 霧密度（美術指導書 §2.2 白屏事故訂正，2026-10-31，team-lead 算出根因）：
 * 原本的 `density = 2.2 / maxRadius` 是「先決定密度，再看它產生出來的
 * 霧化係數」，小群時密度太高，讓整片場景的霧化係數趨近 1，全部變成霧色
 * （霧色是淺色系，於是畫面整片洗白）。
 *
 * 反過來想：先決定「最遠那座島該有多少霧化係數」（`targetFogFactor`，
 * 預設 0.35——看得到島、有空氣感，但不是完全看不見也不是幾乎沒有霧），
 * 再用 `FogExp2` 的公式 `factor = 1 - exp(-(density×distance)²)` 反推
 * 密度：`density = sqrt(-ln(1-factor)) / distance`。
 *
 * `FARTHEST_DISTANCE_MULTIPLIER`：這裡的「最遠距離」指的是**鏡頭到場景
 * 最遠點**的距離，不是群自己的半徑（`maxDist`）——鏡頭本身就在
 * `orbitRadius = maxDist × 1.7` 外（見 `loadCluster()` 的鏡頭自動縮放），
 * 場景最遠的點又可能在鏡頭對側再加上一個 `maxDist`，所以用
 * `(1.7 + 1) × maxDist = 2.7 × maxDist` 當「最遠距離」的估計值。
 */
export const FARTHEST_DISTANCE_MULTIPLIER = 2.7;

/** `FogExp2` 本身的霧化係數公式，獨立拆出來是因為「反推密度」跟「驗證
 *  反推對不對」要用同一個公式，不要兩邊各寫一次、公式打錯一邊測試也測
 *  不出來。 */
export function archipelagoFogFactorAt(density: number, distance: number): number {
  return 1 - Math.exp(-((density * distance) ** 2));
}

export function archipelagoFogDensity(maxDist: number, targetFogFactor = 0.35): number {
  const farthestDistance = Math.max(1, maxDist) * FARTHEST_DISTANCE_MULTIPLIER;
  return Math.sqrt(-Math.log(1 - targetFogFactor)) / farthestDistance;
}

/**
 * 畫質分級（PRD 效能要求：iPad／390 手機都要 ≥30fps，2026-10-31 補）。
 * SSAO 是新加的後製 pass 裡最貴的一個（每像素都要額外取樣深度/法線緩衝
 * 做環境光遮蔽），窄螢幕（手機）預設關掉，只留 bloom／暈影；pixelRatio
 * 上限也跟著降，減少 fill-rate 負擔。門檻直接沿用 PRD §6 既有的「手機
 * （< 640 寬）」門檻（右側面板在這個寬度改成底部抽屜），不是另外發明一個
 * 跟畫面其他地方不一致的數字。
 *
 * iPad（常見寬度 768/1024）落在寬螢幕分級——團隊長特別點名 iPad 也要
 * ≥30fps，但 iPad 的 GPU 效能足夠負擔 SSAO，不需要跟手機一起降級；真的
 * 量到 iPad 上 SSAO 導致掉幀的話，再把門檻或判斷式改成也看
 * `navigator.hardwareConcurrency`/UA 之類的裝置能力訊號，不是這裡先猜。
 */
export const NARROW_WIDTH_THRESHOLD = 640;

export interface ArchipelagoQualityTier {
  ssaoEnabled: boolean;
  pixelRatioCap: number;
}

export function qualityTierForWidth(width: number): ArchipelagoQualityTier {
  if (width < NARROW_WIDTH_THRESHOLD) return { ssaoEnabled: false, pixelRatioCap: 1.25 };
  return { ssaoEnabled: true, pixelRatioCap: 1.7 };
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface OccluderBox {
  /** 這個包圍盒屬於哪座島——跟名牌自己的 `ownSlug` 相同時不算遮擋（島不會
   *  擋自己的名牌）。 */
  slug: string;
  min: Vec3Like;
  max: Vec3Like;
}

/**
 * 名牌遮擋判斷（美術指導書 §7 + team-lead 2026-10-31 訂正）——抽成純函式，
 * 參數只吃「相機位置、名牌錨點、可遮擋物的包圍盒清單」，不碰 three.js
 * 的 Raycaster/Scene，可以直接餵合成資料寫測試，不必在真實佈局裡旋轉
 * 鏡頭碰運氣找一個剛好被擋住的案例（2026-10-31 實測：在一個 20 島群裡
 * 試了 10 種角度都沒能逼出真實案例，但不代表機制沒用——只是沒測到）。
 *
 * 做法：相機到名牌錨點視為一條線段（不是無限長的射線，錨點背後的東西
 * 不該算遮擋），對每個「不屬於這座島自己」的包圍盒做 ray-vs-AABB 相交
 * 測試；交點若比名牌本身更靠近相機（扣掉 `marginBeforeLabel` 的容忍值，
 * 避免名牌所在島自己的地面/建築邊緣誤判成遮擋自己），就算被擋住。
 */
export function isNameplateOccluded(
  cameraPos: Vec3Like,
  labelAnchor: Vec3Like,
  ownSlug: string,
  occluders: OccluderBox[],
  marginBeforeLabel = 0.3,
): boolean {
  const origin = new THREE.Vector3(cameraPos.x, cameraPos.y, cameraPos.z);
  const target = new THREE.Vector3(labelAnchor.x, labelAnchor.y, labelAnchor.z);
  const toLabel = target.clone().sub(origin);
  const distToLabel = toLabel.length();
  if (distToLabel < 1e-6) return false; // 名牌就在相機位置——不可能被擋住
  const direction = toLabel.clone().normalize();
  const ray = new THREE.Ray(origin, direction);
  const hitPoint = new THREE.Vector3();
  for (const occluder of occluders) {
    if (occluder.slug === ownSlug) continue;
    const box = new THREE.Box3(
      new THREE.Vector3(occluder.min.x, occluder.min.y, occluder.min.z),
      new THREE.Vector3(occluder.max.x, occluder.max.y, occluder.max.z),
    );
    const hit = ray.intersectBox(box, hitPoint);
    if (!hit) continue;
    const hitDistance = hit.distanceTo(origin);
    if (hitDistance < distToLabel - marginBeforeLabel) return true;
  }
  return false;
}

export interface ClusterBoundingCircle {
  center: Vec3Like;
  radius: number;
}

export interface RectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * 名牌卡片本身有沒有超出畫布邊界（team-lead 2026-10-31 審查發現：
 * `silhouette-history3.png` 的 36 島大群裡，名牌卡片整張伸出畫布邊界，
 * 蓋到旁邊的 UI 側欄）。`CSS2DRenderer` 只負責把 DOM 元素擺在 3D 投影到
 * 的螢幕座標，完全不知道畫布邊界在哪——名牌卡片自然會被擺出畫布外。
 * 純函式，吃兩個矩形（名牌卡片的 `getBoundingClientRect()`／畫布的
 * `getBoundingClientRect()`），可以直接用合成矩形測，不必在真實佈局裡
 * 找一張剛好跑出邊界的名牌。
 */
export function isRectOutOfBounds(rect: RectLike, container: RectLike): boolean {
  return rect.left < container.left || rect.right > container.right || rect.top < container.top || rect.bottom > container.bottom;
}

/**
 * 名牌該顯示課名卡片還是退化成狀態色小圓點（PRD §3.2 2026-10-31
 * team-lead 訂正：「已佔領、探索中、鏡頭焦點最近 8 座常駐顯示課名；其餘
 * 島顯示狀態色小圓點，hover／點一下展開名牌」）。純函式，吃狀態/是否在
 * 最近名額內/是否正在 hover，不碰 Three.js 或 DOM——可以直接用合成輸入
 * 測，不必在真實佈局裡湊一個「剛好大多數島都是 not_started」的資料
 * （2026-10-31 實測：demo 學生帳號幾乎每座島都已經是 in_progress，36 島
 * 的群用真實資料測這個函式會全部回傳 true，完全驗不到 false 分支）。
 */
export function shouldShowFullNameplate(status: IslandStatus, isClosest: boolean, isHovered: boolean): boolean {
  return status !== 'not_started' || isClosest || isHovered;
}

/**
 * 名牌優先序分數（team-lead 2026-10-31 二次訂正：「排序：hover > 已佔領 >
 * 鏡頭最近 > 探索中。這條規則不管狀態都要套用」）——分數只決定「兩張卡片
 * 重疊時誰留下」，跟 `shouldShowFullNameplate`（誰一開始夠不夠格顯示卡片）
 * 是兩個獨立的判斷，不要混在一起：這支只在「已經確定要顯示卡片」的候選
 * 之間排序。嚴格分級（不是加總）——hover 最高、已佔領次之、在最近名額
 * 內再次之、其餘（探索中等）墊底，符合團隊長原文的「>」序列。
 */
export function nameplatePriorityScore(status: IslandStatus, isClosest: boolean, isHovered: boolean): number {
  if (isHovered) return 3;
  if (status === 'occupied') return 2;
  if (isClosest) return 1;
  return 0;
}

export interface ScoredNameplateRect {
  slug: string;
  rect: RectLike;
  score: number;
}

function rectsOverlap(a: RectLike, b: RectLike): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * 重疊解決（team-lead 2026-10-31 退回重做明確要求：「補合成資料測試，
 * 輸入是三張彼此相交的矩形加上分數，鎖住『分數低的那張變圓點』、『重疊數
 * 為 0』，再做 mutation 驗證」）——純函式，吃一組「矩形＋分數」，回傳該
 * 退化成圓點的 slug 集合。
 *
 * 演算法是標準的「依優先序貪婪挑選」（interval scheduling 的 2D 版本），
 * **不是**原本那種「逐一兩兩比較、比較到的那一對裡分數低的那個退讓」——
 * 舊寫法處理 3 張互相牽連的矩形時無法保證最終重疊數是 0（A-B 重疊、B-C
 * 重疊、但 A-C 不重疊時，依陣列順序逐對處理可能漏掉需要退讓的那個）。
 * 貪婪法則有數學上的保證：分數由高到低排序，依序把「目前還沒跟已保留
 * 的任何一張衝突」的矩形留下，衝突就退化——保留下來的每一張都已經跟
 * *所有*更早保留（=更高分）的矩形比較過不衝突，所以保留集合裡任兩張
 * 保證不重疊，不是「大部分時候不重疊」。
 */
export function resolveNameplateOverlaps(candidates: readonly ScoredNameplateRect[]): Set<string> {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const kept: ScoredNameplateRect[] = [];
  const demoted = new Set<string>();
  for (const candidate of sorted) {
    const conflicts = kept.some((k) => rectsOverlap(candidate.rect, k.rect));
    if (conflicts) demoted.add(candidate.slug);
    else kept.push(candidate);
  }
  return demoted;
}

/**
 * 開場鏡頭構圖（team-lead 2026-10-31 明令：「開場鏡頭要能框住整群，傳送門
 * 廣場放在畫面正中央，不要像現在只截到一角」）——根因查到：鏡頭一直固定
 * `lookAt (0,0,0)`（世界原點），但傳送門廣場的實際質心**不是**世界原點
 * （`layoutArchipelago()` 的廣場格子是從 (0,0) 往外長 3 格，長出來的形狀
 * 不對稱時質心會偏離原點——實測一個 20 島群廣場中心量到 `(-1,0)`，不是
 * `(0,0)`），鏡頭看著一個錯的點，整群當然會歪向畫面一角。
 *
 * 改成：先算出「所有島（含廣場）的外接圓」（用 bounding-box 中心當圓心，
 * 不是質心——質心會被密度不均的一側拉偏，bbox 中心在視覺上比較貼近「真正
 * 置中」，算法也更簡單、更穩定），鏡頭 `lookAt` 這個圓心，`orbitRadius`
 * 依這個圓的半徑縮放（取代原本「距離原點最遠的島」那個算法，語意從
 * 「離原點多遠」換成「離整群真正的中心多遠」，更正確）。
 *
 * 純函式，只吃一組 2D 位置，不碰 three.js 場景——可以直接餵合成座標測試。
 */
/**
 * @param forceCenter 強制指定圓心（不計算 bbox 中心）——團隊長的兩個要求
 *   其實是同一個點比較好同時滿足：「傳送門廣場距畫面中心 ≤10%」最穩妥的
 *   做法是鏡頭直接看著廣場本身（距離恆為 0%，不是算出來剛好很小），
 *   「框住整群」則用「以廣場為圓心、到最遠島的距離」當半徑——廣場不剛好
 *   在整群的幾何中心也沒關係，只要半徑算對，整群一樣會被框住。不傳這個
 *   參數時退回 bbox 中心（給沒有特定基準點的泛用呼叫端，也是既有測試
 *   覆蓋的預設行為）。
 */
export function computeClusterBoundingCircle(
  positions: readonly { x: number; z: number }[],
  forceCenter?: { x: number; z: number },
): ClusterBoundingCircle {
  if (positions.length === 0) return { center: { x: 0, y: 0, z: 0 }, radius: 1 };
  let center: { x: number; z: number };
  if (forceCenter) {
    center = forceCenter;
  } else {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of positions) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  }
  let radius = 0;
  for (const p of positions) {
    radius = Math.max(radius, Math.hypot(p.x - center.x, p.z - center.z));
  }
  return { center: { x: center.x, y: 0, z: center.z }, radius: Math.max(1, radius) };
}

/** WebGL 無法建立時回傳 `null`（PRD §6：自動降級到清單模式，不是顯示錯誤
 *  頁），呼叫端用這個判斷要不要 render 3D 容器。
 *
 * @param theme 要哪個皮膚——`themes/index.ts` 的 `THEMES[id]`，呼叫端負責
 *   選（HUD 切換、localStorage 偏好都在呼叫端，這支不管）。
 */
export function createArchipelagoWorld(
  container: HTMLElement,
  events: ArchipelagoWorldEvents,
  theme: ArchipelagoTheme,
): ArchipelagoWorld | null {
  let renderer: THREE.WebGLRenderer;
  try {
    // alpha:true + 透明清除色（team-lead 2026-10-31 三次訂正）：天空穹頂
    // 整顆拿掉，canvas 本身變透明，背景交給 3D 容器的 CSS 漸層（呼叫端
    // `StudentArchipelagoPage.tsx`）——`setClearColor` 的顏色參數在 alpha=0
    // 時完全不影響畫面（沒有東西會用它的 RGB），傳 0 只是「反正用不到」。
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;
  renderer.setClearColor(0, 0);

  // 畫質分級（PRD 效能要求：iPad／390 手機都要 ≥30fps）——窄螢幕關 SSAO、
  // 降 pixelRatio 上限，純函式見 `qualityTierForWidth()` 的說明。容器這時
  // 可能還沒掛載完成、量到 0，退回桌機尺寸（寬螢幕分級，不會誤判成手機
  // 關掉 SSAO）；真正的尺寸在 `resize()` 第一次呼叫時就會量到。
  const qualityTier = qualityTierForWidth(container.clientWidth || 1280);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityTier.pixelRatioCap));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  container.appendChild(renderer.domElement);

  // ---------------------------------------------------------------------
  // 名牌 CSS2D 疊層（美術指導書 §7）——獨立於 WebGL canvas 的 DOM 疊層，
  // 用絕對定位蓋滿同一個容器。`pointer-events: none`：名牌只是資訊，不是
  // 互動目標（點擊走既有的 3D raycast，見下面 `onClickUp`），不能擋住底下
  // canvas 的滑鼠事件。
  // ---------------------------------------------------------------------
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  // `scene.background` 刻意不設（維持 `null`）——設了會蓋過
  // renderer 的透明清除色，CSS 漸層就會被 WebGL 畫面擋住看不見。
  // 霧色改用 `horizon`（不是 `fog`）：team-lead 2026-10-31 三次訂正要求
  // 「霧的顏色要等於 horizon 色，遠處的島才會融進地平線，而不是融進一塊
  // 灰色」——`horizon` 同時也是 CSS 漸層最下緣的顏色，三者（霧／地平線／
  // 漸層底色）本來就該是同一個數字，不是各自決定。
  scene.fog = new THREE.FogExp2(theme.palette.horizon, 0.01); // loadCluster() 會依群大小覆寫密度（§2.2）
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);

  const ambient = new THREE.HemisphereLight(theme.lighting.hemisphereSky, theme.lighting.hemisphereGround, theme.lighting.ambient);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(theme.lighting.sunColor, theme.lighting.sunIntensity);
  sun.position.set(...theme.lighting.sunDirection);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  // 背光／輪廓光（美術指導書 §2.1：「目前完全沒有 rim，建築輪廓跟天空
  // 背景融在一起分不開」）——方向跟主光相對，顏色/強度向主題要，骨架
  // 不決定這顆燈該是什麼顏色。
  const rim = new THREE.DirectionalLight(theme.lighting.rimColor, theme.lighting.rimIntensity);
  rim.position.set(-theme.lighting.sunDirection[0], theme.lighting.sunDirection[1] * 0.6, -theme.lighting.sunDirection[2]);
  scene.add(rim);

  // ---------------------------------------------------------------------
  // 後製鏈（美術指導書 §2.4）——bloom 只讓金色飾條/水晶/占領光暈發光，
  // SSAO 補建築與島面的接觸陰影，OutputPass 一定要在最後（否則 tone
  // mapping 不生效，`threejs-postprocessing` 反模式第一條）。參數是數字
  // 不是顏色常數，不違反契約測試④（只擋 hex 色碼跟主題字眼）。
  // ---------------------------------------------------------------------
  // `UnrealBloomPass`／`SSAOPass` 都吃「目前畫面的實際像素尺寸」去配置內部
  // render target——不是什麼都能先丟一個佔位值之後再說。這裡先用容器掛載
  // 當下量得到的尺寸（還沒掛上 DOM 前可能是 0，退回一個合理預設），下面
  // `resize()` 每次呼叫都會用真正的尺寸呼叫兩者的 `setSize()` 校正一次。
  const initialWidth = container.clientWidth || 1280;
  const initialHeight = container.clientHeight || 900;
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  // 螢幕截圖驗收抓到：修完 1×1 解析度 bug 之後畫面還是整片洗白——根因是
  // §1 色票的天空穹頂（`gradientSky.ts`）本身是淺色系暖白/粉彩（`MeshBasicMaterial`
  // 不受光照，亮度就是色票本身），這些顏色的線性亮度本來就逼近或超過
  // 0.82 這個 threshold（算過：`#f7ecd0` 線性亮度約 0.84），於是**整片天空
  // 都被判定成「夠亮該發光」**，疊加 bloom 之後進一步被推向全白——threshold
  // 調高到 0.95（只留真正接近純白／高強度 emissive 的東西才發光）、
  // strength 腰斬到 0.15（指導書要的是「只讓金色飾條/水晶/占領光暈發光」，
  // 不是整場景發光，見下面原本保留的註解）。
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(initialWidth, initialHeight), 0.15, 0.4, 0.95);
  composer.addPass(bloomPass);
  const ssaoPass = new SSAOPass(scene, camera, initialWidth, initialHeight);
  ssaoPass.kernelRadius = 10;
  ssaoPass.minDistance = 0.003;
  ssaoPass.maxDistance = 0.05;
  // 窄螢幕／低階裝置預設關掉 SSAO（`qualityTier`，PRD 效能要求），保留
  // bloom＋暈影（暈影是 CSS 疊層，不在這條 composer 鏈裡，見呼叫端的 DOM
  // class）——SSAO 是這條鏈裡最貴的 pass（每像素額外取樣深度/法線緩衝）。
  if (qualityTier.ssaoEnabled) composer.addPass(ssaoPass);
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // ---------------------------------------------------------------------
  // 拖曳旋轉／滾輪縮放的簡易軌道鏡頭——不是第一人稱，PRD §3.4：「拖曳旋轉、
  // 滾輪／雙指縮放、自動限制在群的範圍內」。
  // ---------------------------------------------------------------------
  let orbitRadius = 22;
  let orbitYaw = 0.5;
  let orbitPitch = 0.8727; // 俯角，0=水平 PI/2=正上方（≈50°）
  let orbitTarget = new THREE.Vector3(0, 0, 0);
  let minRadius = 10;
  let maxRadius = 60;

  function syncCamera() {
    const clampedPitch = Math.max(0.2, Math.min(1.4, orbitPitch));
    const clampedRadius = Math.max(minRadius, Math.min(maxRadius, orbitRadius));
    const horizontal = clampedRadius * Math.cos(clampedPitch);
    const y = clampedRadius * Math.sin(clampedPitch);
    camera.position.set(
      orbitTarget.x + horizontal * Math.sin(orbitYaw),
      orbitTarget.y + y,
      orbitTarget.z + horizontal * Math.cos(orbitYaw),
    );
    camera.lookAt(orbitTarget);
  }
  syncCamera();

  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  // team-lead 2026-10-31 八次訂正：headless 實測滑過四座島，canvas 游標
  // 一直是 `auto`——整個群島畫面從沒設定過任何 cursor 樣式。預設先給
  // `grab`（可拖曳旋轉的暗示），拖曳中換 `grabbing`，`onHoverMove`（下面）
  // 滑到島上會再蓋成 `pointer`。
  renderer.domElement.style.cursor = 'grab';
  const onPointerDown = (e: PointerEvent) => {
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    renderer.domElement.setPointerCapture(e.pointerId);
    renderer.domElement.style.cursor = 'grabbing';
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    orbitYaw -= (e.clientX - dragStartX) * 0.006;
    orbitPitch = Math.max(0.2, Math.min(1.4, orbitPitch - (e.clientY - dragStartY) * 0.004));
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    syncCamera();
  };
  const onPointerUp = () => {
    dragging = false;
    // 放開當下未必還在島上——下一個 `onHoverMove` 會立刻依實際游標位置
    // 覆寫成 `pointer`（如果還壓在島上）或維持 `grab`，這裡先退回預設值。
    renderer.domElement.style.cursor = 'grab';
  };
  const onWheel = (e: WheelEvent) => { e.preventDefault(); orbitRadius = Math.max(minRadius, Math.min(maxRadius, orbitRadius + e.deltaY * 0.03)); syncCamera(); };
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

  // ---------------------------------------------------------------------
  // 點擊選取（raycasting）——島跟門都是獨立物件，raycast 打
  // `pickableIslands`/`pickablePortals` 兩個陣列，靠 `userData.storySlug`/
  // `userData.portalKey` 往上找。
  // ---------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let pickableIslands: THREE.Object3D[] = [];
  let pickablePortals: THREE.Object3D[] = [];
  let islandPositions = new Map<string, THREE.Vector3>();
  // 名牌遮擋用的包圍盒快取（`isNameplateOccluded`）——每座島世界座標
  // bounding box，換群時重算一次，不是每幀重算。
  let occluderBoxes: OccluderBox[] = [];
  let downAt = { x: 0, y: 0 };

  function resolveIslandSlugFromPointer(clientX: number, clientY: number): string | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObjects(pickableIslands, true)[0];
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o && !o.userData.storySlug) o = o.parent;
    return (o?.userData.storySlug as string) ?? null;
  }

  // #3799 美術指導書 §8（2026-10-31）：觸控裝置沒有 hover——第一次點只做
  // 「上浮＋亮邊＋名牌強調」，第二次點（或點卡片「登島」按鈕）才真的導航。
  // 用 `matchMedia` 在裝置層級先判斷，不要用「使用者有沒有點過」這種運行期
  // 猜測（`threejs-camera-interaction-pitfalls` 坑 4）。
  const isCoarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(any-pointer: coarse)').matches;
  let touchArmedSlug: string | null = null;
  let hoveredSlug: string | null = null;

  const onClickDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
  const onClickUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return; // 拖曳不算點擊
    const islandSlug = resolveIslandSlugFromPointer(e.clientX, e.clientY);
    if (islandSlug) {
      if (isCoarsePointer && touchArmedSlug !== islandSlug) {
        // 第一次點：只「準備」這座島（上浮/亮邊由下面 hover 動畫段落統一
        // 處理，這裡只負責記住「準備好了」跟觸發名牌強調／onHoverIsland）。
        touchArmedSlug = islandSlug;
        hoveredSlug = islandSlug;
        events.onHoverIsland?.(islandSlug);
        return;
      }
      events.onSelectIsland(islandSlug);
      return;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    const portalHit = raycaster.intersectObjects(pickablePortals, true)[0];
    if (portalHit) {
      let o: THREE.Object3D | null = portalHit.object;
      while (o && !o.userData.portalKey) o = o.parent;
      if (o?.userData.portalKey) events.onSelectPortal(o.userData.portalKey as string);
    }
  };
  renderer.domElement.addEventListener('pointerdown', onClickDown);
  renderer.domElement.addEventListener('pointerup', onClickUp);

  const onHoverMove = (e: PointerEvent) => {
    if (isCoarsePointer) return; // 觸控裝置沒有 hover，狀態由點擊事件自己管
    const slug = resolveIslandSlugFromPointer(e.clientX, e.clientY);
    // team-lead 2026-10-31 八次訂正：根因是這裡原本整段被
    // `if (!events.onHoverIsland) return` 擋住——`StudentArchipelagoPage.tsx`
    // 從來沒有傳這個選填的回呼，於是連骨架**自己內部**的 `hoveredSlug`
    // 都從來沒被更新過，上浮／亮邊／名牌強調（都只讀這個閉包變數，不是讀
    // `events.onHoverIsland` 本身）整串跟著死掉。`onHoverIsland` 應該只是
    // 「額外通知呼叫端」的選填管道，不該變成「3D 場景自己的 hover 視覺
    // 回饋要不要生效」的開關——拆開：`hoveredSlug` 永遠更新（視覺回饋永遠
    // 生效），只有要不要呼叫外部回呼才需要 `events.onHoverIsland` 存在。
    if (dragging) {
      // 拖曳中不切換游標樣式（`onPointerDown` 已經鎖成 `grabbing`），但
      // `hoveredSlug` 還是要更新——不然放開滑鼠那一刻的視覺回饋會對不上
      // 游標實際停留的位置。
    } else {
      renderer.domElement.style.cursor = slug ? 'pointer' : 'grab';
    }
    if (slug !== hoveredSlug) {
      hoveredSlug = slug;
      events.onHoverIsland?.(slug);
    }
  };
  renderer.domElement.addEventListener('pointermove', onHoverMove);

  let clusterGroup: THREE.Group | null = null;
  // 每座島的「目前上浮高度」平滑趨近值（美術指導書 §8：
  // `t = 1 - exp(-rate*dt)` 跨幀率安全的指數平滑，不是固定 lerp 係數）。
  const hoverLift = new Map<string, number>();
  // 每座島的名牌（CSS2DObject）與它對應的 DOM 元素，換群時一併清掉。
  interface NameplateEntry { object: CSS2DObject; el: HTMLDivElement; worldPos: THREE.Vector3; status: IslandStatus; cardText: string; dotColor: string }
  const nameplates = new Map<string, NameplateEntry>();
  /** 名牌常駐顯示上限（PRD §3.2 2026-10-31 team-lead 訂正：「36 島大群全部
   *  常駐會擠成一團」）——已佔領／探索中一定常駐，其餘只有鏡頭焦點最近
   *  N 座才顯示課名，其餘退化成狀態色小圓點，hover／點一下才展開。 */
  const CLOSEST_NAMEPLATES_VISIBLE = 8;
  let nameplateFrameCounter = 0;

  /**
   * 骨架層統一打開陰影收發——美術指導書第 84 行只點名「陰影相機 frustum
   * 要對齊群的範圍」，但 frustum 調對之後仍量不到對比改善（見 git log
   * 2026-10-31 的訂正紀錄），一路查下去才發現每個主題的每一棟建築／每座
   * 島都沒有 `castShadow`/`receiveShadow`——只有 `hub` 的地基一個物件有設
   * （兩個主題各自在 `theme.hub()` 裡手動設了一次，島本身跟島上的地標完全
   * 沒有）。這不是某個主題個別漏設，是骨架從一開始就沒有統一打開——所以
   * 放在骨架這層一次打開，不要每個主題各自記得設一次。
   */
  /**
   * `receiveShadow` 幾乎零成本（只是主渲染通道裡多取樣一張陰影貼圖），但
   * `castShadow` 會讓那個物件多進一次陰影貼圖的繪製通道——每座島的草叢／
   * 石頭／踏腳石／吉祥物／hover 外框全部打開 `castShadow` 一次量了 390 寬
   * 的 fps：30.48 → 23.7（2026-10-31 實測，-22%），20 島的群一次多出上百個
   * 投影物件。骨架不該知道哪個物件是「草叢」哪個是「地標建築」（§3.2 契約
   * 測試①禁止骨架認得主題字眼），但骨架可以用**幾何本身的高度**當代理：
   * 地標建築／城牆岩層明顯比草叢／踏腳石／薄環高，用 bounding box 的
   * Y 範圍決定要不要投影，而不必知道那個物件實際是什麼。
   */
  const CAST_SHADOW_MIN_HEIGHT = 0.6; // 世界單位——蓋過地標/岩層，篩掉草叢/踏腳石/hover 外框
  function enableShadows(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      mesh.receiveShadow = true; // 幾乎零成本，全部打開
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox;
      const height = box ? (box.max.y - box.min.y) * mesh.scale.y : 0;
      mesh.castShadow = height >= CAST_SHADOW_MIN_HEIGHT;
    });
  }

  /**
   * 載入一群——換群時先釋放上一群（`disposeObjectTree`），位置由
   * `layoutArchipelago()`（純函式，已獨立測試）決定，這裡只負責把純座標轉成
   * 真的 three.js 物件，長相全部向 `theme` 要。
   *
   * `createSceneCtx()` 每次呼叫都重新建（不是模組層級共用常數）——理由
   * 跟拿掉 InstancedMesh 共用幾何/材質一樣：`disposeObjectTree`
   * 換群時會把上一群 `clusterGroup` 底下所有幾何/材質一起 dispose。
   */
  function loadCluster(islands: ArchipelagoWorldIsland[], portals: ArchipelagoWorldPortal[]): void {
    if (clusterGroup) {
      scene.remove(clusterGroup);
      disposeObjectTree(clusterGroup);
    }
    for (const { object } of nameplates.values()) object.element.remove();
    nameplates.clear();
    hoverLift.clear();
    pickableIslands = [];
    pickablePortals = [];
    islandPositions = new Map();
    occluderBoxes = [];

    const { ctx } = createSceneCtx(scene);
    const group = new THREE.Group();
    scene.add(group);

    // #3799 PRD §3.2 二次訂正：不規則群島佈局——位置／相鄰互通／連接材料
    // 全部由 layoutArchipelago() 決定。種子＝這一群的課程 id 依序接起來，
    // 保證「同一群每次打開長一樣」。
    const seed = islands.map((i) => i.storySlug).join(',');
    const layout = layoutArchipelago(islands.map((i) => i.storySlug), seed, HEX_SIZE);

    // team-lead 2026-10-31 退回重做：「平面外側交給天空球……海面或雲海平面
    // 的半徑縮成 4×maxRadius」——`theme.ground()` 要知道這一群有多大才能
    // 把平面縮到對的尺寸，所以 `boundingCircle`/`maxRadius` 要提前到
    // `theme.ground(ctx)` 呼叫之前算好（原本是在整座島都建完之後才算，
    // 這裡只需要 `layout.plaza.center`／`layout.islands[].center` 就夠，
    // 不需要等三維物件建完）。下面建島迴圈裡還會建一次一模一樣的
    // `positions` 陣列（純粹是歷史留下的寫法，兩邊算出來的點集合完全
    // 一致），之後鏡頭構圖那段直接重用這裡算好的 `boundingCircle`，不要
    // 重算第二次。
    const earlyPositions: { x: number; z: number }[] = [layout.plaza.center, ...layout.islands.map((b) => b.center)];
    const boundingCircle = computeClusterBoundingCircle(earlyPositions, layout.plaza.center);
    const groundObj = theme.ground(ctx, boundingCircle.radius);
    // 地面（天空穹頂＋海面/雲海）要跟著群的中心擺，不是永遠釘在世界原點
    // （team-lead 2026-10-31 退回重做「畫面上方還有一層白霧」查到的真正
    // 根因）——穹頂是半球，以它自己的局部原點為中心；鏡頭看的是
    // `boundingCircle.center`（廣場位置，常常偏離世界原點，前面
    // `computeClusterBoundingCircle` 的說明有實測過 `(-1,0)` 的例子），穹頂
    // 卻一直蓋在 (0,0,0)——群的中心離原點夠遠時，鏡頭往上看的方向會「看
    // 偏」穹頂，看到的其實是半球外、什麼都沒蓋到的 `scene.background`
    // 純色（純色沒有漸層，不管怎麼調穹頂/霧/暈影的顏色都量不出標準差，
    // 這解釋了為什麼先前三次嘗試——縮小海面、調深穹頂頂色、拿掉暈影——
    // 畫面上緣的像素標準差完全沒有變化：根本沒蓋到穹頂本身）。
    groundObj.position.set(boundingCircle.center.x, 0, boundingCircle.center.z);
    group.add(groundObj);

    function cellOffsetsForBlob(blob: IslandBlob): { x: number; z: number }[] {
      return blob.cells.map((cell) => {
        const world = axialToCartesian(cell, HEX_SIZE);
        return { x: world.x - blob.center.x, z: world.z - blob.center.z };
      });
    }

    const plazaPos = layout.plaza.center;
    const hub = theme.hub(ctx);
    hub.position.set(plazaPos.x, 0, plazaPos.z);
    enableShadows(hub);
    group.add(hub);

    const angleStep = (Math.PI * 2) / Math.max(1, portals.length);
    portals.forEach((portal, i) => {
      const angle = i * angleStep;
      const portalInfo = { key: portal.key, label: portal.label, occupiedCount: portal.occupiedCount, total: portal.total };
      const portalObj = theme.portal(ctx, portalInfo);
      const px = plazaPos.x + Math.cos(angle) * PORTAL_DISTANCE_FROM_HUB;
      const pz = plazaPos.z + Math.sin(angle) * PORTAL_DISTANCE_FROM_HUB;
      portalObj.position.set(px, 0, pz);
      portalObj.lookAt(plazaPos.x, 0, plazaPos.z);
      portalObj.userData.portalKey = portal.key;
      group.add(portalObj);
      pickablePortals.push(portalObj);
    });

    const idToPos = new Map<string, { x: number; z: number }>([['plaza', plazaPos]]);
    for (const blob of layout.islands) idToPos.set(blob.id, blob.center);

    const positions: { x: number; z: number }[] = [plazaPos];
    islands.forEach((island, i) => {
      const blob = layout.islands[i];
      const pos = blob.center;
      positions.push(pos);

      const cell: CellInfo = {
        storySlug: island.storySlug,
        title: island.title,
        category: island.category,
        status: island.status,
        stationsDone: island.stationsDone,
        stationsTotal: island.stationsTotal,
        position: pos,
        cellCount: blob.cells.length,
        cellOffsets: cellOffsetsForBlob(blob),
        cellRadius: HEX_SIZE,
        seed: island.storySlug,
      };
      const islandObj = theme.island(ctx, cell);
      theme.statusLook[island.status](islandObj, ctx);
      islandObj.position.set(pos.x, 0, pos.z);
      islandObj.userData.storySlug = island.storySlug;
      enableShadows(islandObj);
      group.add(islandObj);
      pickableIslands.push(islandObj);
      islandPositions.set(island.storySlug, new THREE.Vector3(pos.x, 0, pos.z));
      hoverLift.set(island.storySlug, 0);
      islandObj.updateMatrixWorld(true); // box 要世界座標，換群時算一次不是每幀
      const worldBox = new THREE.Box3().setFromObject(islandObj);
      occluderBoxes.push({ slug: island.storySlug, min: worldBox.min.clone(), max: worldBox.max.clone() });

      // 名牌（美術指導書 §7 + PRD §3.2 2026-10-31 team-lead 訂正）：已佔領／
      // 探索中／鏡頭焦點最近 8 座常駐顯示課名卡片，其餘退化成狀態色小圓點
      // （還是有東西看得到，不是「整群看不到名字」，只是不是每座都展開課
      // 名文字），hover／點一下展開——哪些島落在「最近 8 座」裡每幀都會變
      // （鏡頭會動），所以卡片/圓點的切換邏輯在 `animate()` 裡，這裡只建
      // 一次 DOM 元素、算好兩種模式各自要用的文字/顏色存起來。
      const el = document.createElement('div');
      const cardText = island.status === 'occupied'
        ? `✓ ${island.title}`
        : island.status === 'in_progress'
          ? `${island.title}（${island.stationsDone}/${island.stationsTotal}）`
          : island.title;
      const dotColor = island.status === 'occupied'
        ? theme.palette.occupied
        : island.status === 'in_progress'
          ? theme.palette.inProgress
          : theme.palette.unexplored;
      // 2026-10-31 四次訂正：opacity 不再是「隱藏/半隱藏」的手段（見下面
      // 名牌狀態機那段說明），固定是 1，拿掉 opacity 的 transition——留著
      // transform 的平滑移動，但不要讓一個永遠不變的屬性還掛著轉場設定
      // （沒有任何壞處，但會讓人誤以為 opacity 還在被動畫控制）。
      el.style.transition = 'transform 150ms';
      const labelObject = new CSS2DObject(el);
      // 名牌偏移改成「這座島實際蓋出來的最高點」動態算（team-lead 2026-10-31
      // 七次訂正截圖抓到「誤會」「美好的一天」——debug 追出來這兩座剛好都是
      // 樹群造型（寓言故事類），樹群是四種地標裡最矮的一種，原本整組島共用
      // 一個「取最高地標類別校準」的固定偏移（先是 1.6，後改 1.6×1.5=2.4）
      // ——對矮的樹群來說，CSS2DObject 預設置中錨點，固定偏移值離樹冠太
      // 近，卡片整張蓋住矮建築；對高的塔／廟頂又偏移過頭，名牌離建築本體
      // 遠得不自然。改成直接讀 `worldBox`（剛好在這上面幾行已經為了
      // occluder 算過，同一個島不用算第二次）的 `max.y` 再加一點緩衝——
      // 矮建築的名牌自動貼得近且穩穩在頂端之上，高建築的名牌也不會飄太遠，
      // 不用為每種地標類型各自校準一個魔術數字，以後新增地標類型也自動
      // 適用。
      //
      // 緩衝從 0.3 加大到 1.0：實測發現同一個世界座標緩衝量，畫面**前景**
      // （鏡頭近側、螢幕下半部）的島得到的螢幕空間淨空比**遠景**（螢幕上半
      // 部，貼近地平線）小很多——鏡頭俯仰角固定時，前景那段視線更接近垂直
      // 朝下，同樣的世界高度差只換到很少的螢幕像素位移；遠景視線趨近水平，
      // 同樣的高度差換到的螢幕位移大得多。「誤會」「美好的一天」剛好都在
      // 這次構圖的前景位置，0.3 不夠，加大到 1.0 讓前景島也有感的淨空（代價
      // 是遠景島的名牌會稍微浮高一點，不是問題——那邊本來淨空就綽綽有餘）。
      labelObject.position.set(0, worldBox.max.y + 2.0, 0);
      islandObj.add(labelObject);
      nameplates.set(island.storySlug, { object: labelObject, el, worldPos: new THREE.Vector3(), status: island.status, cardText, dotColor });

      // 連接物（PRD §3.2：相鄰互通，材料隨機）——下面統一跑 `layout.connections`
      // 建立，這裡不逐一連前一座，見下方迴圈。
    });

    for (const conn of layout.connections) {
      const a = idToPos.get(conn.a);
      const b = idToPos.get(conn.b);
      if (!a || !b) continue;
      const connector = theme.connector(ctx, a, b, conn.material);
      if (connector) group.add(connector);
    }

    clusterGroup = group;

    // 鏡頭自動縮放涵蓋整群範圍（§3.4「自動限制在群的範圍內」；team-lead
    // 2026-10-31 訂正：原本鏡頭永遠看著世界原點，但廣場質心常常不在原點
    // 上（見 `computeClusterBoundingCircle` 的說明），鏡頭看錯點、整群就
    // 會歪向畫面一角——改成看「廣場為圓心的外接圓」，不是寫死的原點）。
    //
    // **俯仰角/縮放倍率第五次訂正（2026-10-31）**：團隊長新驗收標準從
    // 「非海背景像素 ≥65%」提高到「島群佔畫面 ≥70%」，且明確指出「畫面上方
    // 大約 1/3 是空的海，島群擠在中段」——舊版 `orbitPitch=0.65 rad`
    // （≈37°）+ `orbitRadius=maxDist×2.9` 組合下，量「畫面垂直方向有內容
    // 的那段跨度」只有 46~62%，不管怎麼拉遠都卡在這附近（拉遠只改變「島
    // 填滿畫面的密度」，不會改變「俯仰角決定的地平線在畫面垂直位置上落在
    // 哪一行」，那才是「上方留白」的真正成因）。
    //
    // 改法：俯仰角直接調陡（0.65→1.05 rad≈60°，更接近正上方俯瞰），地平線
    // 在畫面上的位置本身就會往上移、留白自然變少；陡角度下「鏡頭太近只框
    // 到少數島」的副作用也比淺角度輕微（陡角度時島跟島之間的水道在畫面上
    // 的視覺占比本來就比斜視角小），所以同時可以把縮放倍率從 2.9 拉近到
    // 2.4。本機截圖實測（`scratchpad/qa-matrix/composition-pitch105-r24-*.png`，
    // 量法：逐行找「這一行有沒有非海背景色的像素」，算有內容的那段行數
    // 跨佔整個畫布高度的比例）：1280 寬 76.0%、390 寬 77.2%，兩種寬度都
    // 穩穩超過 70% 門檻。（海島主題數字；天空島因為整套色票本來就刻意貼近
    // 背景色，像素色彩分類器量不出有意義的數字——跟 contrast 那題是同一個
    // 已知限制，不是這次構圖沒套用到天空島。）
    //
    // `boundingCircle` 重用上面建 `theme.ground()` 之前算好的那份，不要
    // 重算第二次（`positions`/`plazaPos` 這裡跟那裡是同一組點、同一個圓心，
    // 算兩次只會浪費一次迴圈，數字不會不一樣）。
    const maxDist = boundingCircle.radius;
    orbitRadius = Math.max(14, maxDist * 2.4);
    minRadius = Math.max(8, maxDist * 0.5);
    maxRadius = maxDist * 3.2;
    orbitTarget = new THREE.Vector3(boundingCircle.center.x, 0, boundingCircle.center.z);
    orbitPitch = 0.8727; // 換群重設回預設俯角，不留著玩家上一群拖曳過的角度
    // 遠裁切面要跟著地面圓盤的安全半徑縮放（2026-10-31 二次退回重做）——
    // `theme.ground()` 現在用 `requiredGroundRadius()` 把地面圓盤做得比
    // 固定 300 的遠裁切面還大（大群時），地面會被遠裁切面本身切掉一截，
    // 切口一樣是一條硬邊，跟原本那條邊緣是同一種症狀換了個位置。遠裁切面
    // 固定留在地面半徑的 1.15 倍之外，地面本身才有機會完整顯示。
    camera.far = Math.max(300, requiredGroundRadius(maxDist) * 1.15);
    camera.updateProjectionMatrix();
    syncCamera();

    // 動態霧密度（美術指導書 §2.2：`density ≈ 2.2 / maxRadius`，群越大霧
    // 越淡，固定密度在小群太濃、大群幾乎看不見——這是量過的公式，不是
    // 改成「看起來還行」的數字）。
    // 動態霧密度（美術指導書 §2.2 白屏事故訂正，2026-10-31）——見
    // `archipelagoFogDensity()` 的說明：反推密度讓「鏡頭到最遠點」的霧化
    // 係數落在 0.35 附近，不是直接套一個固定公式產生出不受控的密度。
    // team-lead 2026-10-31 退回重做：霧化目標從 0.35 降到 0.2——0.35 在
    // 36 島這種大群（maxRadius 本身就大）會讓遠處島跟海面幾乎整片泛白，
    // 層次感被壓平；降到 0.2 讓遠處保留更多本身的顏色，只留淡淡的空氣感。
    (scene.fog as THREE.FogExp2).density = archipelagoFogDensity(maxDist, 0.2);

    // SSAO pass 的取樣範圍要對齊這次場景的尺度，不然小群太濃、大群太淡。
    ssaoPass.kernelRadius = Math.max(4, Math.min(16, maxDist * 0.3));

    // 陰影相機 frustum 要對齊這次群的範圍（美術指導書第 84 行：「固定 2048
    // 貼圖，未依群大小調整範圍……frustum 沒對齊場景範圍，陰影要嘛太鬆要嘛
    // 被裁掉」）。DirectionalLight 的陰影相機預設是 ±5 單位的正交投影框——
    // 一個 20 島群的 maxDist 常常是幾十個單位，等於絕大多數島落在這個框
    // 外面，連陰影都不會畫出來。這是 luminance.contrast 量測長期偏低（天空
    // 島 54-58，低於 visual-scorecard.md 門檻 60）的根因：沒有接觸陰影，
    // 畫面就沒有暗部，整片只剩下材質本色在壓光後的亮部，怎麼調材質顏色
    // 都補不回這段暗部。
    // 半徑抓 maxDist 的 1.3 倍（涵蓋整群半徑 + 島本身的實體範圍），不是只
    // 貼齊群的幾何中心點，否則邊緣島的島面本身仍可能被裁到框外。
    const shadowHalfExtent = maxDist * 1.3;
    sun.shadow.camera.left = -shadowHalfExtent;
    sun.shadow.camera.right = shadowHalfExtent;
    sun.shadow.camera.top = shadowHalfExtent;
    sun.shadow.camera.bottom = -shadowHalfExtent;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = shadowHalfExtent * 4; // 留足太陽方向上的深度範圍
    sun.shadow.camera.updateProjectionMatrix(); // 手動改 left/right/top/bottom 後必須呼叫，否則矩陣不會重算

    // 效能診斷（美術指導書 §10：「跑過 renderer 診斷，不是看起來還行」）——
    // 換群渲染一幀之後印出 draw call/三角面/幾何數，QA 時從瀏覽器 console
    // 讀，不是另外架一套量測工具。
    //
    // `renderer.info.autoReset` 預設 true 時每次 `render()` 呼叫**都會自動
    // 重置計數器**（`threejs-performance` skill 明寫的坑）——`composer.render()`
    // 內部是好幾個 pass 各自呼叫一次 `renderer.render()`（RenderPass 畫
    // 場景、Bloom 內部多個 pass、SSAO、最後 OutputPass 畫一個全螢幕四邊形），
    // 不關掉 autoReset 的話，讀到的數字只會是**最後一個 pass**（OutputPass，
    // 固定 1 個 draw call、2 個三角形）的數字，不是整個場景真正的渲染量，
    // 不管 island 多少、`triangles`／`drawCalls` 永遠接近 1——這正是第一版
    // 在真預覽站量到「1 個 draw call」這個明顯錯誤數字的根因。
    requestAnimationFrame(() => {
      renderer.info.autoReset = false;
      renderer.info.reset();
      composer.render();
      console.log('[archipelago perf]', {
        islands: islands.length,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      });
      renderer.info.autoReset = true;
    });
  }

  // ---------------------------------------------------------------------
  // resize + render loop
  // ---------------------------------------------------------------------
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  const clock = new THREE.Clock();
  let frameId = 0;
  function animate() {
    frameId = requestAnimationFrame(animate);
    const dt = Math.min(0.1, clock.getDelta());

    // Hover 上浮（美術指導書 §8）：指數平滑趨近目標高度，跨幀率安全，不是
    // 固定 lerp 係數（`t = 1 - exp(-rate*dt)`）。亮邊外殼（`userData.isHoverOutline`
    // 標記的子物件）的透明度用同一個進度值淡入淡出——皮膚只需要建一顆
    // 標記好的物件，骨架負責讓它「隨 hover 狀態改變」，皮膚不需要知道
    // hover 狀態存在。
    const rate = 18;
    const liftT = 1 - Math.exp(-rate * dt);
    for (const obj of pickableIslands) {
      const slug = obj.userData.storySlug as string;
      const isHovered = slug === hoveredSlug;
      const current = hoverLift.get(slug) ?? 0;
      const next = current + (isHovered ? 1 - current : 0 - current) * liftT;
      hoverLift.set(slug, next);
      obj.position.y = next * 0.08;
      obj.scale.setScalar(1 + next * 0.04);
      obj.traverse((child) => {
        if (child.userData.isHoverOutline && (child as THREE.Mesh).material) {
          const mat = (child as THREE.Mesh).material as THREE.Material & { opacity: number };
          mat.opacity = next * 0.6;
          mat.transparent = true;
        }
      });
    }

    // 旗子飄動／粒子自己動畫——用 three.js 的 `onBeforeRender` 自繪鉤子
    // （皮膚在建物件時掛上去，骨架完全不用知道「旗子」這個概念存在），
    // `composer.render()` 內部仍然會呼叫每個物件的 `onBeforeRender`。

    // 名牌：位置跟著 3D 物件（CSS2DRenderer 自動處理），遮擋跟重疊判斷都
    // 節流到每 3 幀一次（美術指導書 §7）。
    nameplateFrameCounter = (nameplateFrameCounter + 1) % NAMEPLATE_THROTTLE_FRAMES;
    if (nameplateFrameCounter === 0) {
      const rect = renderer.domElement.getBoundingClientRect();
      const halfW = rect.width / 2 || 1;
      const halfH = rect.height / 2 || 1;
      // 第一輪：算遮擋（被別棟建築擋住）＋順便投影出每個名牌的螢幕座標跟
      // 到鏡頭的距離，給第二輪的重疊判斷用，不用再重算一次世界座標。
      // 2026-10-31 訂正：遮擋判斷改呼叫 `isNameplateOccluded`（純函式，吃
      // 包圍盒不吃 Raycaster/Scene）——不再對每座島的完整三角網格做
      // raycast，換成對換群時就算好的 `occluderBoxes` 做 ray-vs-AABB，
      // 同時這支函式本身可以用合成資料直接測、不必在真實佈局裡碰運氣
      // 找一個剛好被擋住的角度（見 `isNameplateOccluded` 的 test）。
      const projected: { slug: string; x: number; y: number; distance: number; occluded: boolean }[] = [];
      for (const [slug, { object, worldPos }] of nameplates) {
        object.getWorldPosition(worldPos);
        const distToLabel = worldPos.distanceTo(camera.position);
        const occluded = isNameplateOccluded(camera.position, worldPos, slug, occluderBoxes);
        const ndc = worldPos.clone().project(camera);
        projected.push({ slug, x: ndc.x * halfW, y: -ndc.y * halfH, distance: distToLabel, occluded });
      }
      // PRD §3.2 2026-10-31 team-lead 訂正：「鏡頭焦點最近 8 座」會隨鏡頭
      // 移動每幀改變，所以每次都要重排——已佔領／探索中不受這個名額限制
      // （狀態本身就該一直看得到），其餘跟 hover 中的那座另外判斷。決定卡片
      // 或圓點模式要在算重疊（下面那輪）**之前**做，`getBoundingClientRect()`
      // 讀到的大小才會是這一幀真正要顯示的大小，不是上一幀殘留的。
      const closestSlugs = [...projected].sort((a, b) => a.distance - b.distance).slice(0, CLOSEST_NAMEPLATES_VISIBLE).map((p) => p.slug);
      const closestSet = new Set(closestSlugs);
      const applyCardStyle = (entry: NameplateEntry) => {
        entry.el.textContent = entry.cardText;
        entry.el.style.background = theme.nameplate.background;
        entry.el.style.border = `1px solid ${theme.nameplate.border}`;
        entry.el.style.color = theme.nameplate.text;
        entry.el.style.borderRadius = '10px';
        entry.el.style.padding = '4px 8px';
        entry.el.style.width = '';
        entry.el.style.height = '';
        entry.el.style.fontSize = '13px';
        entry.el.style.fontWeight = '600';
        entry.el.style.whiteSpace = 'nowrap';
        entry.el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
      };
      const applyDotStyle = (entry: NameplateEntry) => {
        // 狀態色小圓點——沒展開課名，但「每座島都看得到標記」（PRD §7
        // 訂正原文）仍然成立，不是真的什麼都沒有。
        entry.el.textContent = '';
        entry.el.style.background = entry.dotColor;
        entry.el.style.border = '1px solid rgba(255,255,255,0.6)';
        entry.el.style.color = 'transparent';
        entry.el.style.borderRadius = '50%';
        entry.el.style.padding = '0';
        entry.el.style.width = '10px';
        entry.el.style.height = '10px';
        entry.el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.25)';
      };
      const intendedFull = new Set<string>();
      for (const p of projected) {
        const entry = nameplates.get(p.slug)!;
        const showFull = shouldShowFullNameplate(entry.status, closestSet.has(p.slug), p.slug === hoveredSlug);
        if (showFull) { intendedFull.add(p.slug); applyCardStyle(entry); } else { applyDotStyle(entry); }
      }
      // 第二輪：重疊判斷——2026-10-31 team-lead 兩次訂正：①「較遠那個淡化
      // 到 35% 透明度」在名牌改成「密度上限＋圓點」之後語意衝突（半透明
      // 卡片還是佔用螢幕空間、還是會打架，不是真的解決擁擠），改成退化成
      // 圓點；②退回重做：原本逐對比較、比到的那一對裡「較遠」的退讓，
      // 在 3 張互相牽連（A-B 重疊、B-C 重疊、A-C 不重疊）時無法保證重疊數
      // 真的是 0。改呼叫 `resolveNameplateOverlaps`（貪婪演算法，數學上
      // 保證保留集合裡任兩張不重疊，見該函式註解），排序依據是
      // `nameplatePriorityScore`（hover > 已佔領 > 最近名額 > 其餘）。只把
      // 「原本該顯示卡片」的名牌送進去比——圓點本身很小，不需要牽扯進來。
      const rects = new Map<string, DOMRect>();
      for (const p of projected) rects.set(p.slug, nameplates.get(p.slug)!.el.getBoundingClientRect());
      const scoredCandidates: ScoredNameplateRect[] = [...intendedFull].map((slug) => {
        const entry = nameplates.get(slug)!;
        return { slug, rect: rects.get(slug)!, score: nameplatePriorityScore(entry.status, closestSet.has(slug), slug === hoveredSlug) };
      });
      const demotedToDot = resolveNameplateOverlaps(scoredCandidates);
      for (const slug of demotedToDot) applyDotStyle(nameplates.get(slug)!);
      // 2026-10-31 team-lead 審查新發現：名牌卡片會整張伸出畫布邊界，蓋到
      // 旁邊的 UI 面板（截圖 `silhouette-history3.png` 實測，36 島的大群
      // 尤其明顯）。跟遮擋用同一套「接近隱藏」處理——卡片本身超出畫布就
      // 不該佔用可見名額，不是「半透明蓋在 UI 上」這種更糟的視覺結果。
      // 降級成圓點的名牌不用再檢查這條——圓點比卡片小很多，原本會超出
      // 邊界的卡片縮成圓點後多半已經不超出了，重新量一次 rect 才準。
      const outOfBounds = new Set<string>();
      for (const p of projected) {
        if (demotedToDot.has(p.slug)) continue;
        const freshRect = nameplates.get(p.slug)!.el.getBoundingClientRect();
        if (isRectOutOfBounds(freshRect, rect)) outOfBounds.add(p.slug);
      }
      // team-lead 2026-10-31 四次訂正：「畫面上還有好幾張大約 30% 透明度
      // 的名牌…看起來很髒…不要用 0.35 或 0.05 這種中間值」——根因是前面
      // 兩輪（卡片/圓點選擇、重疊退讓）都處理完了名牌「該長什麼樣子」，
      // 卻在最後這一步又疊加一層獨立的 opacity 控制（1 或 0.05），兩套
      // 機制各自動、互不知道對方已經做了什麼決定。`style.transition =
      // 'opacity 150ms'`（上面名牌建立時設的）會讓每一幀 `opacity:
      // 1→0.05` 或 `0.05→1` 的切換在轉場中途被截到，螢幕上就會看到卡片
      // 卡在某個中間透明度——那不是算出來的目標值，是動畫被打斷的瞬間值。
      //
      // 改法：遮擋／超出畫布都不再用 opacity 當隱藏手段，而是跟「重疊退讓」
      // 共用同一套「卡片 vs 圓點 vs 完全隱藏」的狀態機——遮擋＝退化成圓點
      // （PRD §7：每座島都看得到標記，被擋住的也一樣要有個點）；超出畫布
      // ＝整個隱藏。opacity 固定是 1，沒有過渡用的中間值可以被截到。
      //
      // 隱藏用 `visibility:hidden` 不用 `display:none`——`display:none` 會把
      // 元素整個踢出排版，`getBoundingClientRect()` 之後讀到的是全零
      // `{0,0,0,0}`，而 `isRectOutOfBounds` 拿一個全零矩形去跟從 (0,0) 起算
      // 的畫布邊界比，剛好每個條件都不成立、判成「沒有超出」——下一幀會
      // 把它判回「該顯示」，造成每幀顯示/隱藏來回閃爍。`visibility:hidden`
      // 元素還留在排版裡，矩形仍然反映它真正的投影位置，隔一幀照樣讀得到
      // 正確的「還是超出畫布」。
      for (const p of projected) {
        const entry = nameplates.get(p.slug)!;
        entry.el.style.opacity = '1';
        if (p.occluded) {
          entry.el.style.visibility = 'visible';
          applyDotStyle(entry);
        } else if (outOfBounds.has(p.slug)) {
          entry.el.style.visibility = 'hidden';
        } else {
          entry.el.style.visibility = 'visible';
        }
      }
    }

    syncCamera();
    composer.render();
    labelRenderer.render(scene, camera);
  }
  animate();

  function dispose(): void {
    cancelAnimationFrame(frameId);
    resizeObserver.disconnect();
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    renderer.domElement.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    renderer.domElement.removeEventListener('wheel', onWheel);
    renderer.domElement.removeEventListener('pointerdown', onClickDown);
    renderer.domElement.removeEventListener('pointerup', onClickUp);
    renderer.domElement.removeEventListener('pointermove', onHoverMove);
    for (const { object } of nameplates.values()) object.element.remove();
    nameplates.clear();
    if (clusterGroup) {
      scene.remove(clusterGroup);
      disposeObjectTree(clusterGroup);
      clusterGroup = null;
    }
    disposeObjectTree(scene);
    composer.dispose();
    renderer.dispose();
    if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
    if (labelRenderer.domElement.parentElement === container) container.removeChild(labelRenderer.domElement);
  }

  return { loadCluster, dispose, focusOnIsland: (storySlug: string) => focusOnIsland(storySlug) };

  function focusOnIsland(storySlug: string): void {
    const position = islandPositions.get(storySlug);
    if (!position) return;
    orbitTarget = position;
    syncCamera();
  }
}

export interface ArchipelagoWorld {
  loadCluster: (islands: ArchipelagoWorldIsland[], portals: ArchipelagoWorldPortal[]) => void;
  dispose: () => void;
  focusOnIsland: (storySlug: string) => void;
}

/** 這群用哪種分群方式載入，純粹是個標記型別給呼叫端用，這支檔案本身不
 *  需要知道 mode 是什麼（已經是正規化好的 islands/portals 陣列）。 */
export type { ClusterMode };
