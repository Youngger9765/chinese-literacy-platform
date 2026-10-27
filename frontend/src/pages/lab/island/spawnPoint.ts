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
 * 出生點：面向港口燈塔（lesson-intro 站），從正南方接近（跟 20011 原本
 * 出生點 `{x:-2,z:16.5}` 相對燈塔 `{x:-3,z:11}` 的方向大致一致，原本就
 * 幾乎是正南，這裡取整成剛好正南，算式比較乾淨：x 跟燈塔相同，一上岸
 * `yaw=0` 的 forward 方向就剛好指向燈塔，不用再額外轉向）。對範本引擎
 * 生成的任何一課都成立，因為只依賴傳進來的燈塔座標，不依賴地形細節。
 *
 * `pitch` 固定回傳 `SPAWN_PITCH`——燈塔的視覺尺寸對全平台每一課都一樣
 * （同一套程序化建築造型），不是每課各自算一次。
 */
export function computeSpawnFacingLighthouse(
  lighthouse: { x: number; z: number },
  distance: number = SPAWN_DISTANCE_FROM_LIGHTHOUSE,
): { x: number; z: number; yaw: number; pitch: number } {
  const x = lighthouse.x;
  const z = lighthouse.z + distance;
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
