/**
 * #3780 P0-2（playtest 回饋，2026-10-26）：「出生點貼著燈塔，卻沒有
 * 「進入」；往前走會撞進燈塔，鏡頭穿進牆裡，整個畫面變米色」。
 *
 * 根因①（碰撞距離，已修好不用再動）：createIslandWorld.ts 每一棟建築
 * 共用的地基圓柱半徑是 1.65，但玩家/鏡頭的移動碰撞距離原本寫死 1.55——
 * 比地基半徑還小，玩家因此可以被放行到建築實體內部。
 *
 * 根因②（真正造成「整片米色牆」的原因，team-lead 2026-10-26 真瀏覽器
 * 截圖抓到，第一版只修了①沒修②）：燈塔是全島最高的地標建築（地面到
 * 屋頂尖端將近 7.3 個單位，比其他任何一站都高很多），出生距離只有
 * 2.75——不管碰撞距離抓多準，站在離一座 7 公尺高的塔只有 2.75 公尺的
 * 地方，鏡頭往前一看，塔身本來就會填滿大半個畫面。這不是碰撞問題，是
 * 「距離跟建築高度不成比例」的構圖問題，必須分開修：
 *   - 出生距離要拉開到讓塔「底到頂」都能進垂直視野（見
 *     `isLighthouseFullyInView`／`minDistanceForLighthouseInView`）
 *   - 但出生距離不能拉到跟「一上岸就觸發進入卡」衝突——`NEAR_TRIGGER_RADIUS`
 *     是全島共用的一個數字，拉大它會連帶讓其他（矮很多的）建築也要離
 *     很遠才會觸發，手感會跑掉。解法是觸發半徑改成「依建築類型」分級
 *     （跟 `islandCelebration.ts` 的分級資料表同一個做法）：燈塔自己
 *     一個較大的值，其他站維持原本的 `NEAR_TRIGGER_RADIUS`。
 *   - 加上初始仰角（pitch）：鏡頭出生時往上仰一點，用剩下的垂直視野
 *     「分配」給塔的上半部，不用把出生距離拉到完全不仰頭也能看到塔尖
 *     那麼遠（那樣會太遠，觸發卡跳出的時候塔反而显得很小）。
 */

/** 建築共用的地基圓柱半徑，跟 createIslandWorld.ts 的地基圓柱同一個值。 */
export const BUILDING_BASE_RADIUS = 1.65;

/**
 * 玩家／鏡頭跟建築之間允許的最近距離。必須大於地基半徑，確保鏡頭永遠停
 * 在建築輪廓外面——這正是原本的 bug：1.55 < 1.65，鏡頭會被放行到建築
 * 實體內部。
 *
 * #3780 P0-2 退件 Q3（審查員 2026-10-26）：第一版用 +0.35（算出 2.0）造成
 * 回歸——全平台 179 課裡有 133 課，同一區至少有一對建築的間距小於
 * 2×2.0=4.0（最窄的一對「工匠作坊」/「地圖塔」只有 3.963），玩家的碰撞圈
 * 直接重疊，那條路完全走不過去。改成 +0.2（算出 1.85）：仍然大於地基半徑
 * （鏡頭不會穿牆），且 2×1.85=3.7 小於目前量到最窄的 3.963，179 課全部
 * 保持可走——這個緩衝量是從全平台實際資料反推出來的，不是猜的，見
 * `__tests__/spawnPoint.allLessons.test.ts`（用全部 179 課的真實
 * step_sequence 當回歸鎖，多篇課文站數變多後也會繼續守住這條）。
 *
 * ⚠️ 這條只管「碰撞／不穿牆」，不管「看不看得到整座建築」——後者是下面
 * 一整組新常數在處理，兩組邊界完全獨立，不要混在一起改。
 */
export const MIN_CAMERA_BUILDING_DISTANCE = BUILDING_BASE_RADIUS + 0.2;

/**
 * 「發現新去處」觸發半徑（一般建築，非燈塔）：建築地基半徑 + 緩衝。
 * 燈塔不用這個值，見 `LIGHTHOUSE_NEAR_TRIGGER_RADIUS`——兩者分開是因為
 * 燈塔的出生距離（看得到整座塔需要的距離）遠大於其他矮建築需要的觸發
 * 距離，共用一個數字會讓其他建築也要站很遠才觸發，手感跑掉。
 */
export const NEAR_TRIGGER_RADIUS = BUILDING_BASE_RADIUS + 1.6;

// ---------------------------------------------------------------------------
// 燈塔視野幾何：根因②的真值，全部從 createIslandWorld.ts 的真實建築常數
// 算出來，不是猜的。改建築幾何時要一起改這裡。
// ---------------------------------------------------------------------------

/** 跟 createIslandWorld.ts 的 `new THREE.PerspectiveCamera(57, ...)` 同值
 * ——three.js 的 fov 參數定義是「垂直視野角」，不隨畫面寬高比變，所以這
 * 個常數在桌機/手機任何寬度都適用。 */
export const CAMERA_VERTICAL_FOV_DEG = 57;

/** 玩家眼睛高度，跟 createIslandWorld.ts 的
 * `new THREE.Vector3(player.position.x, 1.75 + jumping + ..., player.position.z)`
 * 同值（不含跳躍/呼吸微幅擺動，那些是暫態，不影響出生那一刻的構圖）。 */
export const EYE_HEIGHT = 1.75;

/**
 * 燈塔塔身底部／屋頂尖端的世界座標 Y。算法：每棟建築的 root 群組在世界
 * 座標 y=0.42（`root.position.set(stop.x, 0.42, stop.z)`），其餘都是
 * local Y——塔身 `cylinder(root, 0.72, 1.16, 4.9, cream, 0, 2.55)` 底部
 * local y=2.55-4.9/2=0.1；屋頂 `cone(root, 1.18, 1.05, slate, 0, 6.7)`
 * 尖端 local y=6.7+1.05/2=7.225。世界座標 = local + 0.42。
 * ⚠️ 底部刻意取「塔身本體」的底（0.52），不取地基平台（sand，到 -0.04+0.42
 * =0.38）——平台只是裝飾用的地面墊，不是「這是一座燈塔」這個輪廓的
 * 一部分，用塔身本體的底當「入口」的視覺代理比較準。
 */
export const LIGHTHOUSE_TOWER_BASE_Y = 0.52;
export const LIGHTHOUSE_ROOF_TOP_Y = 7.225 + 0.42;

/** 塔身本體最寬處（底部）的水平半徑——不是地基平台（1.8，裝飾用地面墊，
 * 各站共用，不是燈塔特有的輪廓），是塔「這個形狀」本身的寬度。 */
export const LIGHTHOUSE_TOWER_RADIUS = 1.16;

/**
 * 給定「相機到建築中心的水平距離」與「仰角」，判斷建築的「底到頂」是否
 * 整個落在相機的垂直視野內。不是鎖死某個距離數字，是鎖「這個幾何關係」
 * ——改建築高度或相機 FOV，呼叫端量出來的合格距離/仰角會自動跟著變，
 * 不用回來改一堆寫死的角度。
 */
export function isHeightFullyInView(params: {
  distance: number;
  pitchRad: number;
  topY: number;
  baseY: number;
  eyeHeight?: number;
  vFovDeg?: number;
}): boolean {
  const eyeHeight = params.eyeHeight ?? EYE_HEIGHT;
  const halfFovRad = (params.vFovDeg ?? CAMERA_VERTICAL_FOV_DEG) / 2 * (Math.PI / 180);
  const angleToTop = Math.atan2(params.topY - eyeHeight, params.distance) - params.pitchRad;
  const angleToBase = Math.atan2(params.baseY - eyeHeight, params.distance) - params.pitchRad;
  return angleToTop <= halfFovRad && angleToBase >= -halfFovRad;
}

/**
 * 「入口」（用塔身底部當代理）是不是落在視野中心以下——玩家一上岸要
 * 先看到「門在哪」，不是先看到一半埋在畫面上緣的屋頂。
 */
export function isBaseInLowerHalf(params: {
  distance: number;
  pitchRad: number;
  baseY: number;
  eyeHeight?: number;
}): boolean {
  const eyeHeight = params.eyeHeight ?? EYE_HEIGHT;
  const angleToBase = Math.atan2(params.baseY - eyeHeight, params.distance) - params.pitchRad;
  return angleToBase < 0;
}

/**
 * 出生距離／仰角：7 個單位、仰角 15°。算出來的依據（可重算驗證，不是
 * 湊出來的）——
 *   span(D) = 從眼睛看塔頂的角度 − 看塔底的角度，這個值只取決於距離，
 *   跟仰角無關；D=7 時 span≈50.1°，在 57° 的垂直視野裡留了近 7° 餘裕
 *   （team-lead 要求目標落在 5–7 之間，取上限換取餘裕，而不是卡在剛好
 *   夠用的臨界值）。
 *   這個距離／仰角底下，允許的仰角區間是 [11.6°, 18.5°]（兩端都要留
 *   出一點餘裕，不能卡在邊界），15° 落在中段，兩邊各留 3°+ 餘裕。
 * `__tests__/spawnPoint.allLessons.test.ts` 用 `isHeightFullyInView`／
 * `isBaseInLowerHalf` 這兩個函式、對全部 179 課重新驗證這兩個數字，
 * 不是只信這段註解。
 */
export const SPAWN_DISTANCE_FROM_LIGHTHOUSE = 7;
export const SPAWN_PITCH = (15 * Math.PI) / 180;

/**
 * 燈塔專屬的「發現新去處」觸發半徑——出生距離本身就要落在這個半徑內
 * （留一點餘裕，不卡在臨界值），一上岸直接觸發進入卡。其他（矮很多的）
 * 建築不受影響，繼續用共用的 `NEAR_TRIGGER_RADIUS`。
 */
export const LIGHTHOUSE_NEAR_TRIGGER_RADIUS = SPAWN_DISTANCE_FROM_LIGHTHOUSE + 0.5;

/**
 * 依建築類型決定「發現新去處」的觸發半徑——資料表驅動（跟
 * `islandCelebration.ts` 的 `celebrationProfileForStep()` 同一個做法），
 * 不要在呼叫端寫 `step === 'lesson-intro' ? A : B` 這種判斷式，新增建築
 * 類型時容易漏改。
 */
export function nearTriggerRadiusForStep(step: string): number {
  return step.split('#')[0] === 'lesson-intro' ? LIGHTHOUSE_NEAR_TRIGGER_RADIUS : NEAR_TRIGGER_RADIUS;
}

/**
 * 預設寬高比——刻意取一個比任何真實裝置都寬的值，純粹是為了讓沒有傳
 * 真實寬高比的舊呼叫端（含既有測試）維持原本固定 `SPAWN_DISTANCE_FROM_LIGHTHOUSE`
 * 的行為不變。呼叫端要吃到下面的直式螢幕補償，必須傳真實的
 * `container.clientWidth / container.clientHeight`。
 */
const DEFAULT_SPAWN_ASPECT = 4;

/**
 * 燈塔塔身寬度（直徑）不能超過畫面寬度的這個比例——#3780 P0-3 九度審查
 * 訂正：手機直式（寬高比 <1）畫面很窄，three.js 的垂直 FOV 固定不隨寬高比
 * 變（見 `CAMERA_VERTICAL_FOV_DEG` 的註解），但水平 FOV 會隨著寬高比變窄
 * （`hFov = 2·atan(tan(vFov/2)·aspect)`）——同樣的出生距離，畫面越窄，
 * 塔身佔掉的畫面比例就越高。390×844（aspect≈0.462）在原本固定的距離 7
 * 底下算出來塔身會佔約 66% 的畫面寬度，超過這裡定的上限。
 */
export const MAX_TOWER_WIDTH_FRACTION = 0.6;

/**
 * 給定寬高比，要讓燈塔塔身的視覺寬度不超過 `maxWidthFraction`，出生距離
 * 至少要多遠。不是鎖死某個距離數字，是鎖「這個幾何關係」——改塔身半徑或
 * 相機 FOV，呼叫端量出來的合格距離會自動跟著變，跟 `isHeightFullyInView`
 * 同一個設計精神。
 */
export function requiredDistanceForTowerWidthInView(
  aspect: number,
  maxWidthFraction: number = MAX_TOWER_WIDTH_FRACTION,
  towerRadius: number = LIGHTHOUSE_TOWER_RADIUS,
  vFovDeg: number = CAMERA_VERTICAL_FOV_DEG,
): number {
  const vFovRad = (vFovDeg * Math.PI) / 180;
  const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);
  return towerRadius / (maxWidthFraction * Math.tan(hFovRad / 2));
}

/**
 * 出生點：面向港口燈塔（lesson-intro 站），從正南方接近（跟 20011 原本
 * 出生點 `{x:-2,z:16.5}` 相對燈塔 `{x:-3,z:11}` 的方向大致一致，原本就
 * 幾乎是正南，這裡取整成剛好正南，算式比較乾淨：x 跟燈塔相同，一上岸
 * `yaw=0` 的 forward 方向就剛好指向燈塔，不用再額外轉向）。對範本引擎
 * 生成的任何一課都成立，因為只依賴傳進來的燈塔座標，不依賴地形細節。
 *
 * `pitch` 固定回傳 `SPAWN_PITCH`——燈塔的視覺尺寸對全平台每一課都一樣
 * （同一套程序化建築造型），不是每課各自算一次。
 *
 * `distance` 現在是「下限」不是精確值——九度審查訂正加了 `aspect` 參數，
 * 寬高比窄到需要更遠的距離才能讓塔身寬度不超過六成時，會自動取較大的
 * 那個值（見 `requiredDistanceForTowerWidthInView`）。拉遠距離只會讓垂直
 * 方向的夾角更小（`isHeightFullyInView`／`isBaseInLowerHalf` 兩個既有
 * 約束只會更寬裕，不會變緊），兩組約束之間沒有衝突。
 */
export function computeSpawnFacingLighthouse(
  lighthouse: { x: number; z: number },
  distance: number = SPAWN_DISTANCE_FROM_LIGHTHOUSE,
  aspect: number = DEFAULT_SPAWN_ASPECT,
): { x: number; z: number; yaw: number; pitch: number } {
  const effectiveDistance = Math.max(distance, requiredDistanceForTowerWidthInView(aspect));
  const x = lighthouse.x;
  const z = lighthouse.z + effectiveDistance;
  const toLighthouseX = lighthouse.x - x;
  const toLighthouseZ = lighthouse.z - z;
  const yaw = Math.atan2(-toLighthouseX, -toLighthouseZ);
  return { x, z, yaw, pitch: SPAWN_PITCH };
}

/** `selectNearestStation()` 要知道每一站的座標／區域／類型，不需要完整的
 * `IslandStop`（含 name/line），用這個子集型別讓呼叫端不用補那些欄位。 */
export interface NearStationCandidate {
  x: number;
  z: number;
  zone: number;
  step: string;
}

/**
 * 「發現新去處」該選哪一站——#3780 P0-2 審查員 2026-10-26 真瀏覽器+全平台
 * 179 課實算抓到的 bug：原本用「距離 ÷ 自己的觸發半徑」這個比例值比大小，
 * 燈塔的半徑（7.5）比其他站（3.25）大超過兩倍，玩家站在旁邊小站的門口
 * （對那一站而言已經近到不能再近）時，比例值卻可能是「燈塔比較近」
 * ——因為燈塔的半徑大，同樣的實際距離换算成比例反而比較小。179 課裡
 * 1,658 組燈塔—其他站配對，有 164 組（9.9%）會被這樣搶走。
 *
 * 正確做法分兩階段，不能用同一個數字直接比：
 *   ① 每一站先用「自己的」觸發半徑獨立判斷「玩家有沒有進到它的範圍」
 *      （`d < threshold`，這是一個二元的門檻測試，不是用來排序的）
 *   ② 在「有進範圍」的候選裡，比較真正的距離（原始 `d`，不除以任何東西）
 *      ——這才是「相對而言誰真的比較近」該問的問題。
 *
 * 跟 `createIslandWorld.ts` 的 three.js 轉頭/鏡頭邏輯分開一個純函式，是
 * 因為「選中哪一站」這件事本身不依賴三維渲染，可以直接用全平台 179 課的
 * 真實資料跑回歸測試（見 `spawnPoint.allLessons.test.ts`）——如果這個選站
 * 邏輯改壞了，鏡頭行為對不對反而是次要症狀，先把「選中正確的站」鎖住。
 */
export function selectNearestStation<T extends NearStationCandidate>(
  stops: readonly T[],
  player: { x: number; z: number },
  unlockedZone: number,
): number | null {
  let closest: number | null = null;
  let bestDist = Infinity;
  stops.forEach((stop, index) => {
    if (stop.zone > unlockedZone) return;
    const threshold = nearTriggerRadiusForStep(stop.step);
    const d = Math.hypot(player.x - stop.x, player.z - stop.z);
    if (d < threshold && d < bestDist) {
      bestDist = d;
      closest = index;
    }
  });
  return closest;
}

/**
 * 慶祝期間找一個「看得清楚剛完成的建築、又不會穿進別的東西」的觀景點
 * ——#3780 P0-3 三度審查訂正（2026-10-27）。
 *
 * 第一版直接沿「玩家位置→建築」這條直線把鏡頭往前推到固定觀景距離
 * （`celebrationEyeOffset`，已移除），這個做法的前提是「玩家跟建築之間
 * 是空的」——但玩家可能是用清單模式從島的任何一個角落直接開站，完全沒
 * 有真的走過去，那條直線完全可能穿過其他建築或山丘。真瀏覽器截圖審查
 * 抓到：179 課全量掃過，17.5% 的「觀景位置」落在別的建築碰撞圈裡、9.4%
 * 落在山丘碰撞圈裡——這正是 P0-2 修過的「整片米色牆」同一類問題，只是
 * 這次是慶祝鏡頭自己造成的，不是出生點。
 *
 * 正解：不要假設玩家和建築之間是空的，改成在建築**周圍**找一個合法的
 * 立足點。在建築四周一圈取候選角度（預設每 30°、共 12 個），每個候選
 * 都用固定的 `viewDistance` 從建築中心往外推，依照「跟玩家所在方向的
 * 夾角」排序（優先選玩家那一側，轉頭幅度小、比較不違和），取第一個同
 * 時滿足以下三件事的候選：① 沒有落在任何其他建築的碰撞圈內 ② 沒有落
 * 在任何山丘的碰撞圈內 ③ 還在這一區島嶼的範圍內（沒有超出海岸線）。
 * 另外還要檢查「這個觀景點看向建築的視線」中間有沒有被第三棟建築擋到
 * ——用點到線段距離，候選點到建築的連線跟任何其他建築的距離都要
 * ≥ `minBuildingDistance` 才算過。
 *
 * 找不到任何合法候選時回傳 `null`——呼叫端的規則是「只轉頭，不移動
 * 鏡頭」，不要退回去用那條有風險的直線（見 `createIslandWorld.ts` 的
 * `setProgress`）。
 */
export const CELEBRATION_VIEW_DISTANCE = 5.5;
export const CELEBRATION_EXTRA_HEIGHT = 1.6;

export interface CelebrationViewpoint {
  readonly x: number;
  readonly z: number;
  readonly extraHeight: number;
}

export interface FindCelebrationViewpointInput {
  readonly target: { readonly x: number; readonly z: number };
  readonly player: { readonly x: number; readonly z: number };
  /** 除了正在慶祝的那棟之外，島上其他所有建築的位置——呼叫端自己排除目標本身。 */
  readonly otherBuildings: ReadonlyArray<{ readonly x: number; readonly z: number }>;
  readonly hills: ReadonlyArray<readonly [number, number, number]>;
  readonly zoneCenter: { readonly x: number; readonly z: number; readonly radius: number };
  readonly minBuildingDistance?: number;
  readonly viewDistance?: number;
  readonly angleStepDeg?: number;
}

function normalizeAngleDiff(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** 點到線段（a→b）的最短距離——平面幾何，跟 three.js 無關。 */
function distancePointToSegment(
  p: { x: number; z: number },
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lenSq = abx * abx + abz * abz;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.z - a.z);
  let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * abx), p.z - (a.z + t * abz));
}

export function findCelebrationViewpoint(input: FindCelebrationViewpointInput): CelebrationViewpoint | null {
  const {
    target,
    player,
    otherBuildings,
    hills,
    zoneCenter,
    minBuildingDistance = MIN_CAMERA_BUILDING_DISTANCE,
    viewDistance = CELEBRATION_VIEW_DISTANCE,
    angleStepDeg = 30,
  } = input;

  const playerAngle = Math.atan2(player.x - target.x, player.z - target.z);
  const steps = Math.max(1, Math.round(360 / angleStepDeg));
  const angles: number[] = [];
  for (let i = 0; i < steps; i++) angles.push((i * angleStepDeg * Math.PI) / 180);
  angles.sort((a, b) => Math.abs(normalizeAngleDiff(a - playerAngle)) - Math.abs(normalizeAngleDiff(b - playerAngle)));

  for (const angle of angles) {
    const candidate = { x: target.x + Math.sin(angle) * viewDistance, z: target.z + Math.cos(angle) * viewDistance };

    const withinIsland = Math.hypot(candidate.x - zoneCenter.x, candidate.z - zoneCenter.z) < zoneCenter.radius - 1;
    if (!withinIsland) continue;

    const hitsBuilding = otherBuildings.some((b) => Math.hypot(candidate.x - b.x, candidate.z - b.z) < minBuildingDistance);
    if (hitsBuilding) continue;

    const hitsHill = hills.some(([hx, hz, hr]) => Math.hypot(candidate.x - hx, candidate.z - hz) < hr * 0.7);
    if (hitsHill) continue;

    const sightBlocked = otherBuildings.some((b) => distancePointToSegment(b, candidate, target) < minBuildingDistance);
    if (sightBlocked) continue;

    return { x: candidate.x, z: candidate.z, extraHeight: CELEBRATION_EXTRA_HEIGHT };
  }
  return null;
}

/**
 * `travelTo()`（清單模式／點擊建築直接「走過去」）的終點——#3780 P0-3
 * 五度審查訂正（2026-10-27，team-lead 用合法的 `travelTo()` API 走回已
 * 完成站驗收截圖時抓到）：原本 `createIslandWorld.ts` 裡這段邏輯是「沿玩家
 * 目前位置→建築中心這條直線走，`dist < 2.9` 就停」，完全沒有檢查路徑或
 * 終點有沒有撞進別的建築／山丘——跟 P0-3 三度審查訂正修過的「慶祝鏡頭沿
 * 直線推」是同一類 bug（假設玩家跟建築之間是空的），只是這次換了個入口
 * （`travelTo` 而不是慶祝鏡頭）。真瀏覽器截圖抓到：用清單模式從島上別處
 * 直接「前往」一個已完成的站，鏡頭最後卡在建築的柱子之間，屋頂/捲軸懸在
 * 頭頂——不是「撞進建築」就是「撞進途中的山丘後停在那附近」。
 *
 * 正解（終點）：終點改用跟出生點／慶祝觀景點同一套檢查
 * （`findCelebrationViewpoint`——在建築四周找一個不撞進別的建築、不撞進
 * 山丘、不出島的合法立足點），不要另外發明一套。這支是薄包裝，不重複
 * 邏輯，只是把回傳值從 `CelebrationViewpoint`（多一個 `extraHeight`，是
 * 「站在地面上、墊高取景」的固定值，跟下面「飛行途中」的高度曲線是兩回
 * 事）降成 `travelTo` 真正需要的 `{x, z}`。找不到合法點時回傳 `null`，
 * 呼叫端的規則是退回原始建築座標當 fallback（終點驗證失敗的殘留風險，
 * 好過完全不讓玩家移動；路線本身仍然走下面的拱形飛行，不會因為終點沒
 * 驗證過就連路線的安全都放棄）。
 *
 * 二度退件（team-lead 2026-10-27）：終點合法，但沿地面走過去的路徑完全
 * 沒檢查——真瀏覽器截圖+ 179 課 fixture 實算：33.8% 的「前往」路徑中途會
 * 穿過別的建築、36.6% 會穿過山丘；而且終點是繞著目標建築找的，抵達時
 * 鏡頭朝向沒有特別處理，跟「終點→建築」的夾角平均差 32°、10.5% 甚至背對
 * 超過 90°。「沿地面走」這個移動方式本身就無法同時保證路徑安全——地面上
 * 任何兩點之間的直線都可能穿過中間的建築/山丘，除非也去檢查路徑。
 *
 * 正解（路徑＋朝向，三度訂正）：不要在地面上走，改成「飛」。第一版拱形
 * 飛行（斜線爬升／斜線下降，中段才到全高）被退回——爬升/下降那兩段是
 * 「邊橫移邊爬升／邊橫移邊下降」，真實幾何量過 41 處：終點旁邊剛好站著
 * 第三棟建築時，下降那一小段還是會貼著它的輪廓擦過去（跟「合法終點只
 * 保證離其他建築 ≥`MIN_CAMERA_BUILDING_DISTANCE`」這個較鬆的保證衝突）。
 *
 * 改成「三段直角」：① 在起點原地垂直升到 `ARC_FLIGHT_PEAK_HEIGHT`
 * ② 在這個高度水平移動到終點正上方 ③ 在終點原地垂直降落。起點（玩家
 * 目前位置）跟終點（`findTravelToDestination` 驗證過的合法立足點）兩個
 * 都已經是「地面上合法」的座標，**垂直**升降的水平座標完全不變、就釘在
 * 那個已驗證的點上——不管那個點旁邊貼著哪棟建築，垂直移動不可能撞進
 * 任何東西（撞進去的前提是水平座標同時變化，掃過別的東西的輪廓）。
 * 只有「水平巡航」那一段會改變水平座標，而那一段全程都在
 * `ARC_FLIGHT_PEAK_HEIGHT`，比全島最高建築還高，不會撞進任何東西。這樣
 * 一來測試完全不需要「終點旁邊的建築先排除」這種例外——起點/終點本身
 * 合法就夠了，不用再管它們旁邊貼著什麼。
 *
 * 落地時的朝向直接設成面向目標建築（跟 `computeSpawnFacingLighthouse`
 * 的 yaw 算法同一條公式），不是沿著飛行方向推算出來的角度——那兩個經常
 * 不一樣，因為終點是繞著建築找的合法立足點，不一定剛好落在「玩家出發
 * 點→建築」那條線上。
 */
export function findTravelToDestination(input: FindCelebrationViewpointInput): { x: number; z: number } | null {
  const viewpoint = findCelebrationViewpoint(input);
  return viewpoint ? { x: viewpoint.x, z: viewpoint.z } : null;
}

/** 飛行時的巡航高度——比全島最高建築（燈塔塔尖）再高 1.5，整段水平巡航
 * 的實際高度都遠遠超過任何建築／山丘的頂端（燈塔 7.64／其餘建築
 * 2.55–6.37／山丘最高 3.4，全部用 `buildStationGroup` 的真實幾何量出來，
 * 不是猜的，見 `__tests__/spawnPoint.allLessons.test.ts`）。 */
export const ARC_FLIGHT_PEAK_HEIGHT = LIGHTHOUSE_ROOF_TOP_Y + 1.5;

/** 垂直升降各佔整段飛行時間的比例——起點/終點本身已經是地面合法的點，
 * 垂直移動的那一小段時間不需要很長，大部分時間留給水平巡航。 */
const ARC_FLIGHT_ASCEND_FRACTION = 0.2;
const ARC_FLIGHT_DESCEND_FRACTION = 0.2;

export type ArcFlightPhase = 'ascend' | 'cruise' | 'descend';

export interface ArcFlightPosition {
  readonly x: number;
  readonly z: number;
  readonly extraHeight: number;
  readonly phase: ArcFlightPhase;
}

function smoothstep(t: number): number {
  const p = Math.max(0, Math.min(1, t));
  return p * p * (3 - 2 * p);
}

/**
 * 三段式飛行在任一進度 0..1 的位置——① 升段（`phase: 'ascend'`）水平座標
 * 完全等於 `start`，只有 `extraHeight` 從 0 平滑升到 `peakHeight`
 * ② 巡航段（`phase: 'cruise'`）`extraHeight` 恆等於 `peakHeight`，水平
 * 座標從 `start` 內插到 `end` ③ 降段（`phase: 'descend'`）水平座標完全
 * 等於 `end`，`extraHeight` 從 `peakHeight` 平滑降到 0。三段之間用
 * smoothstep 銜接速度，不是瞬間切換（避免看起來像卡格），但**水平座標**
 * 在升/降兩段是硬性釘死在端點，不摻雜任何水平內插——這是跟第一版拱形
 * 飛行唯一的本質差異，也是這版不需要排除終點旁邊建築的原因。
 */
export function arcFlightPosition(
  start: { x: number; z: number },
  end: { x: number; z: number },
  progress: number,
  peakHeight: number = ARC_FLIGHT_PEAK_HEIGHT,
): ArcFlightPosition {
  const p = Math.max(0, Math.min(1, progress));
  const ascendEnd = ARC_FLIGHT_ASCEND_FRACTION;
  const cruiseEnd = 1 - ARC_FLIGHT_DESCEND_FRACTION;

  if (p <= ascendEnd) {
    const local = ascendEnd > 0 ? p / ascendEnd : 1;
    return { x: start.x, z: start.z, extraHeight: smoothstep(local) * peakHeight, phase: 'ascend' };
  }
  if (p >= cruiseEnd) {
    const local = ARC_FLIGHT_DESCEND_FRACTION > 0 ? (1 - p) / ARC_FLIGHT_DESCEND_FRACTION : 0;
    return { x: end.x, z: end.z, extraHeight: smoothstep(local) * peakHeight, phase: 'descend' };
  }
  const cruiseSpan = cruiseEnd - ascendEnd;
  const local = cruiseSpan > 0 ? (p - ascendEnd) / cruiseSpan : 1;
  return {
    x: start.x + (end.x - start.x) * local,
    z: start.z + (end.z - start.z) * local,
    extraHeight: peakHeight,
    phase: 'cruise',
  };
}

/**
 * 抵達時該面向哪裡——直接面向目標建築，不是沿著飛行方向延伸出去的角度。
 * 這兩個經常不一樣：飛行路線是「玩家出發點→驗證過的合法立足點」這條
 * 直線，但合法立足點是繞著建築一圈找出來的（見 `findCelebrationViewpoint`
 * 的 12 個候選角度），不一定剛好落在那條直線的延伸方向上——二度退件就是
 * 栽在這裡：原本沒有算這個，抵達時鏡頭朝向跟「終點→建築」平均差了 32°。
 * 跟 `computeSpawnFacingLighthouse` 的 yaw 算法同一條公式。
 */
export function arcFlightArrivalYaw(end: { x: number; z: number }, target: { x: number; z: number }): number {
  return Math.atan2(-(target.x - end.x), -(target.z - end.z));
}

/**
 * 飛行途中要不要鎖住 WASD／搖桿輸入——#3780 P0-3 七度審查訂正：真瀏覽器
 * +179 課實算抓到，原本只有「玩家手動移動時打斷飛行」這條規則，代表按
 * 下方向鍵的那一幀，`createIslandWorld.ts` 會把當幀算出來的墊高值整個
 * 蓋掉、直接把飛行狀態清掉——高度瞬間歸零，鏡頭掉在飛到一半的半空中，
 * 約三成會落在建築或山丘裡。跟開場鏡頭播放中鎖住移動是同一個精神：
 * 飛行中輸入完全不生效，必須飛完才交還控制，不是「移動會打斷飛行」。
 *
 * 抽成這支純函式單獨測，是因為 `createIslandWorld.ts` 本身要真的建立
 * `THREE.WebGLRenderer` 才能跑，沒辦法直接測它的 per-frame 迴圈；這支
 * 鎖的是實際接進那個迴圈的同一條判斷式（`let length = isMovementLocked(...)
 * ? 0 : Math.hypot(dx, dz)`），不是另外發明一套。
 */
export function isMovementLocked(introPlaying: boolean, flying: boolean): boolean {
  return introPlaying || flying;
}

/**
 * 「遮擋這塊名牌的那棟建築」——`BuildingMaterialSlot`／`BuildingMaterialSlot[]`
 * 跟三.js 無關，純粹是幾何描述。半徑統一用 `BUILDING_BASE_RADIUS`（建築
 * 共用的地基圓柱半徑）當近似——不是每棟建築的真實水平輪廓都剛好是這個
 * 數字（例如挑戰擂台的圓形高台比較寬），但這是刻意的簡化：遮擋判斷寧可
 * 偏保守一點用小一點的半徑（少擋到幾種極端案例），也不要用一個誇大的
 * 半徑把一堆明明看得到名牌的情況也判成被擋住——真正的高度（`topY`）才是
 * 這次退件的主因，半徑先用現成的共用常數，不在這批另外量一份新的。
 */
export interface LabelOcclusionObstacle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly baseY: number;
  readonly topY: number;
}

/**
 * 鏡頭→名牌這條視線，有沒有被某棟建築的實體擋住——#3780 P0-3 八度審查
 * 訂正：3D 站牌材質是 `depthTest: false`（永遠畫在最上層，不管真實深度
 * 關係），所以即使物理上被別棟建築擋住，畫面上仍然看得到字牌穿模浮在
 * 前景建築上（team-lead 2026-10-27 截圖抓到：「回音劇場」浮在港口燈塔
 * 前面）。把視線投影到水平面算「障礙物離這條線最近的距離」跟「視線走到
 * 那個最近點時的內插比例」，再用那個比例內插鏡頭／名牌的高度差，算出
 * 視線經過障礙物正上方那一刻的實際高度——這個高度有沒有落在障礙物的
 * `[baseY, topY]` 之間，才是真正決定「擋住了沒」的關鍵（純水平距離夠近
 * 但視線其實是從障礙物上空飛過去，不該判定被擋）。
 *
 * 只對建築實體呼叫這支（`obstacles` 不含光暈環／燈塔光束——那兩個是
 * `MeshBasicMaterial` 的視覺特效，見 `islandBuildingShapes.ts` 的
 * `buildingTopY` 篩選材質類型用的同一條規則）。
 */
export function isLabelOccluded(
  camera: { x: number; y: number; z: number },
  label: { x: number; y: number; z: number },
  obstacles: readonly LabelOcclusionObstacle[],
): boolean {
  const abx = label.x - camera.x;
  const abz = label.z - camera.z;
  const lenSq = abx * abx + abz * abz;
  for (const obstacle of obstacles) {
    let t = lenSq === 0 ? 0 : ((obstacle.x - camera.x) * abx + (obstacle.z - camera.z) * abz) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const closestX = camera.x + abx * t;
    const closestZ = camera.z + abz * t;
    const horizDist = Math.hypot(obstacle.x - closestX, obstacle.z - closestZ);
    if (horizDist >= obstacle.radius) continue;
    const heightAtClosest = camera.y + (label.y - camera.y) * t;
    if (heightAtClosest >= obstacle.baseY && heightAtClosest <= obstacle.topY) return true;
  }
  return false;
}
