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

// #3794 二次訂正：`walkAlongPathPosition`／`projectOntoPath`（檔案最後面）
// 要沿既有石板路走，座標來自這裡——跟 createIslandWorld.ts 渲染石板用的
// 是同一份常數（見 `islandTemplate.ts` 該常數旁的說明），三.js-free 這點
// 跟本檔一致，不是另開一份複製。
import { ZONE_PATHS } from './islandTemplate';

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
 * 預設寬高比——刻意取一個比任何真實裝置都寬的值，純粹是為了讓沒有傳
 * 真實寬高比的舊呼叫端（含既有測試）維持原本固定 `SPAWN_DISTANCE_FROM_LIGHTHOUSE`
 * 的行為不變。呼叫端要吃到下面的直式螢幕補償，必須傳真實的
 * `container.clientWidth / container.clientHeight`。
 */
const DEFAULT_SPAWN_ASPECT = 4;

/**
 * 燈塔專屬的「發現新去處」觸發半徑——出生距離本身就要落在這個半徑內
 * （留一點餘裕，不卡在臨界值），一上岸直接觸發進入卡。其他（矮很多的）
 * 建築不受影響，繼續用共用的 `NEAR_TRIGGER_RADIUS`。
 *
 * 這是桌機基準寬高比（`DEFAULT_SPAWN_ASPECT`）算出來的值，只給不傳
 * `aspect` 的舊呼叫端當常數引用——真正會被用到的半徑一律走下面
 * `nearTriggerRadiusForStep(step, aspect)`，不要在別處重新硬寫這個數字。
 */
export const LIGHTHOUSE_NEAR_TRIGGER_RADIUS = SPAWN_DISTANCE_FROM_LIGHTHOUSE + 0.5;

/**
 * 依建築類型決定「發現新去處」的觸發半徑——資料表驅動（跟
 * `islandCelebration.ts` 的 `celebrationProfileForStep()` 同一個做法），
 * 不要在呼叫端寫 `step === 'lesson-intro' ? A : B` 這種判斷式，新增建築
 * 類型時容易漏改。
 *
 * #3780 P0-3 十度審查真實複審發現：加了塔尖安全邊之後，直式手機的出生
 * 距離可以拉到 10.13（遠超過原本寫死的 `LIGHTHOUSE_NEAR_TRIGGER_RADIUS`
 * =7.5），兩者沒有連動的話，直式手機一上岸會落在觸發半徑外，「進入」卡
 * 不會自動跳出來——必須走近才會觸發，跟桌機版的體驗不一致。所以燈塔的
 * 觸發半徑現在用跟 `computeSpawnFacingLighthouse` 同一套「有效距離」公式
 * 現場算（傳同一個 `aspect`），永遠保證「出生距離 < 觸發半徑」，不會脫鉤
 * ——不傳 `aspect` 時用 `DEFAULT_SPAWN_ASPECT`，算出來剛好等於原本的
 * `LIGHTHOUSE_NEAR_TRIGGER_RADIUS`，既有呼叫端行為不變。
 */
export function nearTriggerRadiusForStep(step: string, aspect: number = DEFAULT_SPAWN_ASPECT): number {
  if (step.split('#')[0] !== 'lesson-intro') return NEAR_TRIGGER_RADIUS;
  return effectiveLighthouseSpawnDistance(aspect) + 0.5;
}

/**
 * 燈塔塔身寬度（直徑）不能超過畫面寬度的這個比例——#3780 P0-3 十度審查
 * 訂正：手機直式（寬高比 <1）畫面很窄，three.js 的垂直 FOV 固定不隨寬高比
 * 變（見 `CAMERA_VERTICAL_FOV_DEG` 的註解），但水平 FOV 會隨著寬高比變窄
 * （`hFov = 2·atan(tan(vFov/2)·aspect)`）——同樣的出生距離，畫面越窄，
 * 塔身佔掉的畫面比例就越高。390×844（aspect≈0.462）在原本固定的距離 7
 * 底下算出來塔身會佔約 66% 的畫面寬度，超過這裡定的上限。原本定 0.6，
 * team-lead 真機截圖量到仍偏緊（目測「60% 多」），收到 0.55 多留一點餘裕。
 */
export const MAX_TOWER_WIDTH_FRACTION = 0.55;

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
 * 塔尖跟畫面頂端要留的安全邊——#3780 P0-3 十度審查訂正：真瀏覽器 390×844
 * 實測（headless + swiftshader，走真實登入/進島流程，不是用猜的）——
 * container 尺寸本身跟 390×844 完全吻合（排除了「headless 視窗寬高比跟
 * container 不一致」這個假設），問題出在別處：垂直框架本身用純數學驗過是
 * 過關的（`isHeightFullyInView` 回 true），但 HUD 標題卡在手機版是正常文件
 * 流（`relative`，不像桌機版 `md:absolute` 那樣脫離文件流、固定在角落），
 * 量到實際佔掉畫面頂端 17.18%（`header.getBoundingClientRect()` 量出
 * bottom=145px / 844px），而按原本的距離/仰角算出來塔尖落在畫面頂端僅
 * 12.1% 的位置——塔尖技術上「在視野內」，但視覺上被蓋在標題卡底下。
 * 這個安全邊預留 25%（比實測卡片佔比 17.18% 多出約 8 個百分點的緩衝），
 * 只在手機版的版面行為（`aspect < 1`，標題卡在正常文件流）才需要，桌機
 * 版標題卡本來就固定在角落不會擋到塔尖，不需要這個額外距離。
 */
export const TOWER_TOP_SAFE_MARGIN_FRACTION = 0.25;

/**
 * 要讓塔尖落在畫面頂端往下至少 `marginFraction` 的位置（不是技術上「還在
 * 視野內」就好，是要真的留出視覺安全邊），出生距離至少要多遠。螢幕座標
 * 跟角度的轉換用標準透視投影：畫面頂端往下的比例 = (1 - tan(夾角)/tan(半
 * FOV)) / 2，照這個反推允許的最大夾角，再用跟 `isHeightFullyInView` 一樣
 * 的 `atan2` 關係反推距離。
 */
export function requiredDistanceForTowerTopMargin(
  pitchRad: number = SPAWN_PITCH,
  marginFraction: number = TOWER_TOP_SAFE_MARGIN_FRACTION,
  topY: number = LIGHTHOUSE_ROOF_TOP_Y,
  eyeHeight: number = EYE_HEIGHT,
  vFovDeg: number = CAMERA_VERTICAL_FOV_DEG,
): number {
  const halfFovRad = (vFovDeg * Math.PI) / 180 / 2;
  const maxTanAngle = (1 - 2 * marginFraction) * Math.tan(halfFovRad);
  const maxAngleToTop = Math.atan(maxTanAngle);
  return (topY - eyeHeight) / Math.tan(maxAngleToTop + pitchRad);
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
 * `distance` 現在是「下限」不是精確值——九度/十度審查訂正加了 `aspect`
 * 參數：寬高比窄到需要更遠的距離才能讓塔身寬度不超過上限時，或寬高比
 * 窄到手機版 HUD 標題卡的版面行為會蓋住塔尖時，會自動取三者中最大的那個
 * 值。塔尖安全邊只在 `aspect < 1`（手機直式比例）才納入計算——桌機版
 * 標題卡固定在角落，不會擋到塔尖，不需要為了這個把桌機的距離也拉遠。
 * 拉遠距離只會讓垂直方向的夾角更小（`isHeightFullyInView`／
 * `isBaseInLowerHalf` 兩個既有約束只會更寬裕，不會變緊），三組約束之間
 * 沒有衝突。
 */
/**
 * 「有效出生距離」的單一算式來源——`computeSpawnFacingLighthouse`（出生點
 * 座標用）跟 `nearTriggerRadiusForStep`（燈塔觸發半徑用）都呼叫這支，
 * 不要各自複製一份候選值邏輯，否則兩邊會慢慢長出不一致（#3780 P0-3 十度
 * 審查就是這樣炸的：出生距離拉開了，觸發半徑沒跟著拉，兩者脫鉤）。
 */
function effectiveLighthouseSpawnDistance(
  aspect: number,
  baselineDistance: number = SPAWN_DISTANCE_FROM_LIGHTHOUSE,
): number {
  const candidates = [baselineDistance, requiredDistanceForTowerWidthInView(aspect)];
  if (aspect < 1) candidates.push(requiredDistanceForTowerTopMargin(SPAWN_PITCH));
  return Math.max(...candidates);
}

export function computeSpawnFacingLighthouse(
  lighthouse: { x: number; z: number },
  distance: number = SPAWN_DISTANCE_FROM_LIGHTHOUSE,
  aspect: number = DEFAULT_SPAWN_ASPECT,
): { x: number; z: number; yaw: number; pitch: number } {
  const effectiveDistance = effectiveLighthouseSpawnDistance(aspect, distance);
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
  aspect: number = DEFAULT_SPAWN_ASPECT,
): number | null {
  let closest: number | null = null;
  let bestDist = Infinity;
  stops.forEach((stop, index) => {
    if (stop.zone > unlockedZone) return;
    const threshold = nearTriggerRadiusForStep(stop.step, aspect);
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
 * #3794（PRD 2026-10-30-island-v2-rpg-pets-story-prd.md §2，Young 硬規定）：
 * 「不做跟學習無關的操作」——上帝視角是唯一模式，WASD／空白鍵／Shift
 * 不准移動角色、不准跳躍、不准旋轉鏡頭。角色只能靠點建築自動走過去。
 *
 * `createIslandWorld.ts` 裡三個會被 WASD/空白鍵/拖曳觸碰到的地方
 * （鍵盤移動、空白鍵跳躍、拖曳旋轉視角）都呼叫這一支共用的判斷，不是
 * 各自寫一遍 `mode === 'first'`——這樣任何一處手滑漏改都會跟其他兩處
 * 用同一支測過的函式，不會悄悄分岔出不一致的行為。
 *
 * 抽成純函式單獨測的理由跟 `isMovementLocked` 一樣：`createIslandWorld.ts`
 * 本身要真的建立 `THREE.WebGLRenderer` 才能跑（在 jsdom 下會直接拋錯，
 * 無法直接對整支引擎下斷言），這支鎖的是實際接進引擎的同一條判斷式。
 */
export function isManualControlEnabled(mode: 'first' | 'god'): boolean {
  return mode === 'first';
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

/**
 * #3794 二次訂正（team-lead 2026-10-30 退件）：`arcFlightPosition`（上面）
 * 是第一人稱時代「鏡頭飛過去」的做法——水平座標直接內插、墊高到比全島
 * 最高建築還高，刻意繞過碰撞檢查。上帝視角要的是反過來的東西：Young 的
 * 規格（PRD §2）寫「看得到人在移動」「沿著路徑從一棟建築走到另一棟」，
 * 畫面上要有角色、沿既有石板路走，鏡頭不准飛、只能固定俯角/高度小幅
 * 平移跟著走（鏡頭那段已經是對的，見 createIslandWorld.ts 的上帝視角
 * 分支——問題只在驅動 `player.position` 的這段邏輯）。
 *
 * 把三段 `ZONE_PATHS` 接成一條連續路網：後一段的第一個點等於前一段的
 * 最後一個點（三個區域的路本來就首尾相連，見 `islandTemplate.ts` 的座標），
 * 去重後變成一條可以用「沿路走了多遠（弧長）」當座標系統的折線。
 */
function concatenatedPath(): ReadonlyArray<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [...ZONE_PATHS[0]];
  for (let i = 1; i < ZONE_PATHS.length; i++) out.push(...ZONE_PATHS[i].slice(1));
  return out;
}

/** 整座島的連續路網（三段 ZONE_PATHS 接起來，去重）。 */
export const FULL_ISLAND_PATH: ReadonlyArray<readonly [number, number]> = concatenatedPath();

function cumulativePathLengths(path: ReadonlyArray<readonly [number, number]>): number[] {
  const lens = [0];
  for (let i = 1; i < path.length; i++) {
    const [x0, z0] = path[i - 1];
    const [x1, z1] = path[i];
    lens.push(lens[i - 1] + Math.hypot(x1 - x0, z1 - z0));
  }
  return lens;
}

export interface PathProjection {
  /** 沿整條路網走的距離（世界單位的弧長，不是 0..1 比例）。 */
  readonly distance: number;
  readonly x: number;
  readonly z: number;
}

/**
 * 把任意世界座標投影到路網上最近的一點——逐段找「這個點垂直投影落在這段
 * 線段上的哪裡」，取全部線段裡距離最近的一個。建築站點是從路徑旁側偏移
 * 擺放的（`islandTemplate.ts` 的 `buildStopsFromSequence`），不會剛好落在
 * 路網上，這支就是在回答「這棟建築離路網最近的那個點，沿路走了多遠」。
 */
export function projectOntoPath(
  point: { x: number; z: number },
  path: ReadonlyArray<readonly [number, number]> = FULL_ISLAND_PATH,
): PathProjection {
  const lens = cumulativePathLengths(path);
  let best: PathProjection = { distance: 0, x: path[0][0], z: path[0][1] };
  let bestDistSq = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const [x0, z0] = path[i];
    const [x1, z1] = path[i + 1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const segLenSq = dx * dx + dz * dz || 1;
    let t = ((point.x - x0) * dx + (point.z - z0) * dz) / segLenSq;
    t = Math.max(0, Math.min(1, t));
    const px = x0 + dx * t;
    const pz = z0 + dz * t;
    const distSq = (point.x - px) ** 2 + (point.z - pz) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = { distance: lens[i] + Math.hypot(dx, dz) * t, x: px, z: pz };
    }
  }
  return best;
}

/** `projectOntoPath` 的反函式：給一個沿路網走的弧長，回傳世界座標。 */
export function pointAtPathDistance(
  distance: number,
  path: ReadonlyArray<readonly [number, number]> = FULL_ISLAND_PATH,
): { x: number; z: number } {
  const lens = cumulativePathLengths(path);
  const total = lens[lens.length - 1];
  const d = Math.max(0, Math.min(total, distance));
  for (let i = 0; i < path.length - 1; i++) {
    if (d <= lens[i + 1] || i === path.length - 2) {
      const segLen = lens[i + 1] - lens[i] || 1;
      const local = (d - lens[i]) / segLen;
      const [x0, z0] = path[i];
      const [x1, z1] = path[i + 1];
      return { x: x0 + (x1 - x0) * local, z: z0 + (z1 - z0) * local };
    }
  }
  const [x, z] = path[path.length - 1];
  return { x, z };
}

export type PathWalkPhase = 'onto-path' | 'along-path' | 'to-door';

export interface PathWalkPosition {
  readonly x: number;
  readonly z: number;
  readonly phase: PathWalkPhase;
}

/**
 * 三段式走路（跟上面 `arcFlightPosition` 的三段式飛行同一個精神，差別是
 * 這裡沒有垂直墊高，三段全部貼地）：① 從目前位置走到路網上最近的點
 * （`onto-path`——通常是離開剛才那棟建築門口）② 沿路網走到目標建築最近
 * 路網點（`along-path`——這段才是畫面上「看得到人沿著石板路走」的主體）
 * ③ 從路網點走到目標建築門口（`to-door`）。三段依各自實際弧長比例分配
 * `progress`（不是三等分），路程短的站不會因為固定三等分而走得忽快忽慢。
 */
export function walkAlongPathPosition(
  start: { x: number; z: number },
  end: { x: number; z: number },
  progress: number,
  path: ReadonlyArray<readonly [number, number]> = FULL_ISLAND_PATH,
): PathWalkPosition {
  const p = Math.max(0, Math.min(1, progress));
  const startProj = projectOntoPath(start, path);
  const endProj = projectOntoPath(end, path);
  const legOn = Math.hypot(start.x - startProj.x, start.z - startProj.z);
  const legAlong = Math.abs(endProj.distance - startProj.distance);
  const legOff = Math.hypot(end.x - endProj.x, end.z - endProj.z);
  const total = legOn + legAlong + legOff || 1;
  const travelled = p * total;

  if (travelled <= legOn) {
    const local = legOn > 0 ? travelled / legOn : 1;
    return { x: start.x + (startProj.x - start.x) * local, z: start.z + (startProj.z - start.z) * local, phase: 'onto-path' };
  }
  if (travelled <= legOn + legAlong) {
    const dir = endProj.distance >= startProj.distance ? 1 : -1;
    const pt = pointAtPathDistance(startProj.distance + dir * (travelled - legOn), path);
    return { x: pt.x, z: pt.z, phase: 'along-path' };
  }
  const local = legOff > 0 ? (travelled - legOn - legAlong) / legOff : 1;
  return { x: endProj.x + (end.x - endProj.x) * local, z: endProj.z + (end.z - endProj.z) * local, phase: 'to-door' };
}

/**
 * 走完這段路大概要幾秒——跟既有 WASD 行走同一個速度常數（`createIslandWorld.ts`
 * 手動移動那段的 `dt * 5.2`），這樣「用走的」跟「點了自動走過去」感覺起來
 * 速度一致，不會一個很快一個很慢。
 */
const WALK_SPEED_UNITS_PER_SECOND = 5.2;
const MIN_WALK_DURATION_SECONDS = 0.9;

export function walkDurationSeconds(
  start: { x: number; z: number },
  end: { x: number; z: number },
  path: ReadonlyArray<readonly [number, number]> = FULL_ISLAND_PATH,
): number {
  const startProj = projectOntoPath(start, path);
  const endProj = projectOntoPath(end, path);
  const legOn = Math.hypot(start.x - startProj.x, start.z - startProj.z);
  const legAlong = Math.abs(endProj.distance - startProj.distance);
  const legOff = Math.hypot(end.x - endProj.x, end.z - endProj.z);
  return Math.max(MIN_WALK_DURATION_SECONDS, (legOn + legAlong + legOff) / WALK_SPEED_UNITS_PER_SECOND);
}

/**
 * #3794 二次訂正（team-lead 2026-10-30，PRD §2「鏡頭角度固定，不能自由
 * 旋轉翻轉」）：上帝視角鏡頭斜俯視、帶一點透視，角度跟距離是常數、永遠
 * 不讀 `yaw`/`pitch` 這類會被拖曳改動的輸入，只跟著玩家的 x/z 水平位移
 * ——這支抽成純函式而不是留在 createIslandWorld.ts 的 per-frame 迴圈裡，
 * 是為了能直接鎖住「角色在路上移動時，鏡頭的俯角與高度都不會變」這個
 * 不變量：同樣常數、不同的 `playerPos`，回傳的 y 分量必須恆等，x/z 分量
 * 必須恰好跟著 `playerPos` 平移同樣的量，不能有任何別的因素（例如飛行中
 * 的墊高）混進來。FOV 查證依據見 `.claude/skills/archipelago-module/
 * SKILL.md` §6.5-A（窄 FOV 透視、俯角 30–40°，比舊版自己估的 55°/
 * 沿用第一人稱 57° FOV 更接近查到的依據）。
 */
export const GOD_CAMERA_FOV_DEG = 30;
// #3794 四次訂正（team-lead 2026-10-30，第三輪退件「鏡頭太近，只看得到燈塔一角」）：
// 島的站點散佈約 32×48 世界單位（islandTemplate.ts ZONE_PATHS），距離 30＋窄 FOV
// 只框得到約 16 單位寬，等於第三人稱近景。拉到 55、俯角 45°（仍在 §6.5-A 查到的
// 斜俯視區間上緣），畫面高度約 29 單位，角色（約 1.8 單位高）佔畫面約 1/16，
// 像微縮模型裡的小人，一次看得到好幾棟建築。鎖在 `godFrameHeightAtTarget` 的測試裡。
export const GOD_CAMERA_PITCH = (45 * Math.PI) / 180;
export const GOD_CAMERA_DISTANCE = 55;
export const GOD_CAMERA_YAW = Math.PI / 4; // 固定觀看方向，呼應設計文件「對角線構圖」建議

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * 上帝視角鏡頭該在哪——純粹跟著玩家水平位移，y 分量恆等於同一個常數
 * （`GOD_CAMERA_DISTANCE * sin(GOD_CAMERA_PITCH)`），不受任何移動狀態
 * （行走／自動走路／慶祝）影響。呼叫端（`createIslandWorld.ts`）仍然要自己
 * 對這個「目標位置」做 `camera.position.lerp(desired, ...)`——平滑跟隨的
 * lerp 本身需要 `camera` 現在的位置，這支只負責算「現在應該往哪裡趨近」。
 */
/**
 * #3794 三次訂正補充（自己用真機截圖抓到，team-lead 還沒看過）：直式手機
 * （390×844，寬高比≈0.46）用固定 `GOD_CAMERA_DISTANCE=30` 截圖時，連
 * 出生點旁邊的港口燈塔都被切到畫面外——跟 `spawnPoint.ts` 檔頭那組燈塔
 * 出生距離常數同一個根因：three.js 的 `fov` 是垂直視野角，不隨寬高比變
 * （見 `CAMERA_VERTICAL_FOV_DEG` 的註解），但水平視野角會隨寬高比變窄
 * （`hFov = 2·atan(tan(vFov/2)·aspect)`），窄螢幕同樣的距離看得到的世界
 * 寬度小很多。跟 `requiredDistanceForTowerWidthInView`（出生鏡頭）同一個
 * 設計精神：不鎖死某個距離數字，鎖「這個幾何關係」——給一個「想看到的世界
 * 半徑」（涵蓋 zone 0 幾棟建築＋一點邊界），算出在這個寬高比下要讓這個
 * 半徑落在畫面寬度內，至少要多遠；桌機寬螢幕算出來的最小距離小於 30，
 * `Math.max` 會讓它維持原本已經用真瀏覽器截圖驗過沒問題的 30，不會因為
 * 加了這個補償而意外改變桌機的構圖。
 */
const GOD_VIEW_TARGET_WORLD_RADIUS = 14; // 世界單位：直式手機也至少框得到出生區幾棟建築（#3794 四次訂正，原 9 太近）

/**
 * #3799 批次 2 構圖訂正（team-lead 2026-10-30 真機截圖抓到：390 寬「下方
 * 留了一大片海」）：純用水平視野補償距離，在極窄寬高比下會把距離拉到
 * 100+（390/844 算出來逼近 113），垂直方向（FOV 固定 30°，不像水平會
 * 變窄）因此框進遠超過需要的世界範圍——島只佔畫面一小塊，下面一大截變成
 * 鏡頭跟島之間的外海。這個上限不是另一個鎖死的數字：它是「垂直視野最多
 * 比桌機已經驗過的構圖多拉開幾倍」這個幾何關係換算回來的距離上限，水平
 * 補償在這個上限之內才生效，超過的話寧可犧牲一點水平範圍，換取垂直構圖
 * 不要有過多留白。
 */
const MAX_VERTICAL_STRETCH = 1.6;

export function godCameraDistanceForAspect(aspect: number): number {
  const vFovRad = (GOD_CAMERA_FOV_DEG * Math.PI) / 180;
  const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);
  const minDistanceForWidth = GOD_VIEW_TARGET_WORLD_RADIUS / Math.tan(hFovRad / 2);
  const maxDistanceForVerticalCap = GOD_CAMERA_DISTANCE * MAX_VERTICAL_STRETCH;
  return Math.max(GOD_CAMERA_DISTANCE, Math.min(minDistanceForWidth, maxDistanceForVerticalCap));
}

/**
 * #3799 批次 2（team-lead 2026-10-30：「角色和建築名牌太小，小朋友不好點」）：
 * 名牌（3D 精靈貼圖）跟玩家角色的世界座標縮放是寫死的常數，螢幕上的視覺
 * 大小會隨著鏡頭距離縮放（這是透視投影的本質，不是貼圖解析度問題）——
 * 窄螢幕為了塞下同樣的水平範圍被迫把鏡頭拉遠（見 `godCameraDistanceForAspect`），
 * 同樣的世界縮放因此在螢幕上看起來更小，這才是「名牌太小看不清楚」的
 * 真正根因。這個倍率跟距離同步放大，讓視覺大小維持跟桌機已驗證過的構圖
 * 一致——桌機距離不變，倍率就是 1，不會意外改變已經截圖驗過的桌機畫面。
 */
export function spriteScaleForAspect(aspect: number): number {
  return godCameraDistanceForAspect(aspect) / GOD_CAMERA_DISTANCE;
}

/** 上帝視角鏡頭在「看的那一點」所框到的畫面高度（世界單位）。用來鎖「鏡頭不能
 *  近到變成第三人稱近景」：畫面高度越大，角色佔畫面比例越小。 */
export function godFrameHeightAtTarget(aspect: number): number {
  const d = godCameraDistanceForAspect(aspect);
  return 2 * d * Math.tan(((GOD_CAMERA_FOV_DEG * Math.PI) / 180) / 2);
}

/** 上帝視角的霧要比第一人稱淡——鏡頭拉遠之後，同樣的霧密度會把遠處建築洗白。 */
export const GOD_VIEW_FOG_DENSITY = 0.005;

export function godCameraDesiredPosition(playerPos: { x: number; z: number }, aspect: number): Vec3Like {
  const distance = godCameraDistanceForAspect(aspect);
  return {
    x: playerPos.x + Math.sin(GOD_CAMERA_YAW) * distance * Math.cos(GOD_CAMERA_PITCH),
    y: distance * Math.sin(GOD_CAMERA_PITCH),
    z: playerPos.z + Math.cos(GOD_CAMERA_YAW) * distance * Math.cos(GOD_CAMERA_PITCH),
  };
}

/**
 * #3799 批次 2（team-lead 2026-10-30：「鏡頭看的點要往島的中心偏一點（但
 * 仍跟著角色）」）：鏡頭的位置（`godCameraDesiredPosition`）跟鏡頭看的點
 * 是兩件事——鏡頭固定從「玩家 + 鏡頭方向那一側」拉遠的位置看過去，直接
 * 看著玩家腳下時，鏡頭跟玩家之間那段距離（在窄螢幕拉得特別遠）大部分是
 * 外海，恰好落在畫面下緣，就是「下方一大片海」的來源。把看的點沿著
 * 「鏡頭→玩家」方向再往前推一點（往島內部，遠離鏡頭的方向），讓構圖的
 * 焦點落在玩家前方更深入島內的地方，畫面下緣的外海留白會跟著縮小。只在
 * 窄螢幕（aspect < 1）套用——寬螢幕的構圖已經用真瀏覽器截圖驗過沒有這個
 * 問題，不要因為加了這個補償意外改變桌機構圖。仍然「跟著角色」：補償量
 * 是相對玩家目前位置的固定位移，角色走到哪，看的點就跟著位移到哪。
 *
 * #3799 批次 2 二次訂正（team-lead 2026-10-30 真機截圖抓到：第一版 bias=6
 * 量出來島的下緣只到畫面 66.2%，目標 ≥85%，「明顯收斂」的說法不成立，
 * 兩張截圖像素級一致，是我錯判）。用真實出生點座標（20013 的港口燈塔
 * zone，中心 (-2,5) 半徑 14）手算透視投影校正：bias=6 時「島朝鏡頭最近
 * 的邊緣」落在畫面 64.3%（跟真實量測 66.2% 接近，驗證模型方向正確）；
 * 把 bias 加大到 20 附近，同一個邊緣落在畫面 81~85% 區間，這就是這裡改成
 * 20 的來源——不是憑感覺，是算過的，但承認：這個手算用簡化的圓形 zone
 * 近似真實地形，最終數字要再用真瀏覽器截圖驗證，不只信算出來的。
 */
const GOD_LOOK_AHEAD_BIAS = 20; // 世界單位，經驗證校正值（見上方說明），原為 6

export function godCameraLookTarget(playerPos: { x: number; z: number }, aspect: number): Vec3Like {
  const bias = aspect < 1 ? GOD_LOOK_AHEAD_BIAS : 0;
  return {
    x: playerPos.x - Math.sin(GOD_CAMERA_YAW) * bias,
    y: 0.6,
    z: playerPos.z - Math.cos(GOD_CAMERA_YAW) * bias,
  };
}

/**
 * #3799 批次 2（team-lead 2026-10-30：「390 寬把建築的可點範圍加大」）：
 * 建築的可點範圍（NDC 容許誤差）——小朋友的手指比滑鼠游標粗很多，窄螢幕
 * （手機）給更寬的容許誤差；寬螢幕（桌機，滑鼠精準度高）維持接近原本的
 * 精準 raycast，不要意外讓桌機點擊誤觸旁邊的建築。
 */
const TAP_TOLERANCE_NDC_WIDE = 0.03;
const TAP_TOLERANCE_NDC_NARROW = 0.12;

export function tapToleranceForAspect(aspect: number): number {
  return aspect < 1 ? TAP_TOLERANCE_NDC_NARROW : TAP_TOLERANCE_NDC_WIDE;
}


/**
 * #3794 四次訂正：說明卡要顯示哪一站。上帝視角只認「點建築、走到門口」
 * （walkArrival），不靠靠近自動跳卡；第一人稱（已無入口，保留給既有分支）
 * 維持原本的靠近判定（nearest）。
 */
export function cardStationFor(mode: 'first' | 'god', walkArrival: number | null, nearest: number | null): number | null {
  return mode === 'god' ? walkArrival : nearest;
}
