/**
 * core/groundRadius.ts — 地面圓盤「不露邊緣」所需的最小半徑（team-lead
 * 2026-10-31 退回重做：方形平面換圓形之後，上緣仍看得到一條弧形邊緣——
 * 用 `scene.traverse` 查過整棵場景樹，地面只有一顆 `CircleGeometry`，沒有
 * 殘留的方形平面、沒有重複的地面、CSS 漸層背景與 renderer 清除色也都正確，
 * 真正的根因是**那顆圓盤的半徑不夠大**）。
 *
 * 推導：鏡頭俯仰角固定（`ORBIT_PITCH`），垂直 FOV 固定
 * （`CAMERA_FOV_DEGREES`），鏡頭到目標的水平/垂直距離都隨
 * `orbitRadius =  Math.max(ORBIT_RADIUS_FLOOR, maxRadius * ORBIT_RADIUS_MULTIPLIER)`
 * （跟 `createArchipelagoWorld.ts` 鏡頭構圖那段同一個算法）線性縮放。
 * 畫面最上緣那條視線角度 = 俯仰角 − 半 FOV；只要這個角度還是朝下（在
 * 目前的俯仰角/FOV 組合下恆成立），這條視線終究會打到地面平面
 * （y=`GROUND_PLANE_Y`），但交點離地面圓心的距離可能遠遠超出圓盤半徑——
 * 算出那個交點離圓心多遠，就是圓盤「不會在畫面最上緣露出邊緣」所需的
 * 最小半徑。
 *
 * **舊版 `6×maxRadius` 剛好卡在這個理論門檻上**（實測兩個真實群：28 島群
 * 理論需要 199.8、舊版用了 199.53，少了 0.27；36 島群理論需要 323.1、
 * 舊版用了 327.4，只多了 4.3——兩者都在 0~2% 的誤差範圍內，等於沒有安全
 * 邊際），所以邊緣在畫面最上緣若隱若現。這支函式回傳的半徑內建
 * `safetyMargin`（預設 1.5 倍），不是再挑一個「看起來比較大」的倍數。
 *
 * 骨架（算 `camera.far`）跟皮膚（算地面圓盤半徑）都要用同一個數字，所以
 * 放在 `core/`（兩邊都能 import，不違反「骨架常數只能透過函式參數流向
 * 皮膚」或「皮膚不 import 骨架檔案」——`createArchipelagoWorld.ts`／
 * `themes/ocean.ts`／`themes/sky.ts` 全部只單向 import 這支共用工具，
 * 彼此之間沒有新增依賴）。
 */
import * as THREE from 'three';

/** 同 `createArchipelagoWorld.ts` 鏡頭構圖段 `orbitRadius = Math.max(14,
 *  maxDist * 2.4)`——這裡刻意不 import 那個檔案的常數（會讓皮膚間接依賴
 *  骨架檔案），改成兩邊都標註「這個數字要對齊」的獨立常數。2026-10-31
 *  五次訂正：倍率隨鏡頭構圖從 2.9 調整到 2.4（配合俯仰角調陡衝「島群佔
 *  畫面 ≥70%」），這裡要同步改，否則地面圓盤的安全邊際會算在一個已經不是
 *  實際運作的倍率上。 */
const ORBIT_RADIUS_MULTIPLIER = 2.4;
const ORBIT_RADIUS_FLOOR = 14;
/** 同 `createArchipelagoWorld.ts` 的 `orbitPitch = 0.8727`（換群重設回的
 *  預設俯角，≈50°）。2026-10-31 七次訂正：俯仰角從 1.05（60°）降到
 *  0.8727（50°）讓建築露出側面（見 `createArchipelagoWorld.ts` 鏡頭構圖
 *  段的完整說明），兩邊要同步。 */
const ORBIT_PITCH = 0.8727;
/** 同 `createArchipelagoWorld.ts` 相機建構時的垂直 FOV（度）。 */
const CAMERA_FOV_DEGREES = 50;
/** 同 `ocean.ts`/`sky.ts` 的 `sea.position.y`/`cloudSea.position.y`。 */
const GROUND_PLANE_Y = -1.6;
/** 任何群都不低於的下限（原本 `Math.max(60, …)` 的那個 60，小群用這個
 *  數字量感上就夠，不必再算一次公式）。 */
const MIN_RADIUS = 60;

/** `requiredGroundRadius()`／`groundFadeStartFraction()` 共用的預設安全
 *  邊際——兩支函式的「倍率」要是同一個數字，`groundFadeStartFraction()`
 *  才是真的在描述「這顆被放大過的圓盤上，最上緣視線落在哪裡」。 */
const DEFAULT_SAFETY_MARGIN = 1.5;

/**
 * @param maxRadius 這一群的外接圓半徑（`boundingCircle.radius`）
 * @param safetyMargin 理論最小半徑之上再留的安全邊際倍率——理論值剛好是
 *   門檻，鏡頭角度／長寬比／三角函式近似值的任何一點點落差都會讓邊緣露出
 *   來（這正是這次退回重做的根因）。
 */
export function requiredGroundRadius(maxRadius: number, safetyMargin = DEFAULT_SAFETY_MARGIN): number {
  const orbitRadius = Math.max(ORBIT_RADIUS_FLOOR, maxRadius * ORBIT_RADIUS_MULTIPLIER);
  const halfVFov = THREE.MathUtils.degToRad(CAMERA_FOV_DEGREES / 2);
  const topRayAngle = ORBIT_PITCH - halfVFov; // 畫面最上緣那條視線，相對水平面再往下多少角度
  const cameraHeightAbovePlane = orbitRadius * Math.sin(ORBIT_PITCH) + Math.abs(GROUND_PLANE_Y);
  const horizontalDistCameraToTarget = orbitRadius * Math.cos(ORBIT_PITCH);
  if (topRayAngle <= 0) {
    // 理論上在目前的俯仰角/FOV 組合下恆不會發生（pitch 比半 FOV 大，
    // 0.8727 rad > 0.4363 rad）——防呆：真的變成「最上緣視線本身朝上」就
    // 代表地面平面物理上不可能把整個視野填滿，退回一個保守但有限的值，
    // 不要除以零或產生負值。
    return (horizontalDistCameraToTarget + cameraHeightAbovePlane) * safetyMargin * 10;
  }
  const topRayHorizontalReach = cameraHeightAbovePlane / Math.tan(topRayAngle);
  const needed = topRayHorizontalReach - horizontalDistCameraToTarget;
  return Math.max(MIN_RADIUS, needed * safetyMargin);
}

/**
 * 海面/雲海徑向透明淡出的起點（team-lead 2026-10-31 六次訂正：「不要寫死
 * 0.75，用相機幾何算出『畫面最上緣視線落在半徑的幾%』，淡出起點設為那個
 * 值再加 0.05，寫成純函式」）——上一輪把淡出起點從 0.7 手動調到 0.55，
 * 結果構圖那輪把俯仰角／縮放倍率都改了，畫面最上緣視線落點的比例也跟著
 * 變，0.55 立刻變成「淡出帶跟可見範圍重疊」(落點變亮、像一圈光圈)。手動
 * 數字每次構圖再訂正一次就要跟著手動調一次，容易忘記同步；改成純函式，
 * 以後構圖再怎麼調，這裡都會自動算出正確的起點。
 *
 * 推導：`requiredGroundRadius(maxRadius, 1)` 是「不留安全邊際」的理論最小
 * 半徑，也就是畫面最上緣視線打到地面平面的真實距離；
 * `requiredGroundRadius(maxRadius, safetyMargin)` 是圓盤實際蓋出來的半徑
 * （比理論值大 `safetyMargin` 倍）。兩者的比值，就是「畫面最上緣視線」
 * 落在這顆實際圓盤的半徑幾 %——淡出起點要落在這個比例**之外**（半徑更大
 * 的地方），最上緣視線才會落在淡出開始之前的全不透明區，不會被淡出帶的
 * 透明度稀釋而偏亮。额外加 `marginBuffer`（預設 0.05）留一點緩衝，不要
 * 剛好卡在理論邊界上（跟 `requiredGroundRadius()` 本身要留安全邊際是
 * 同一個理由）。
 *
 * 不直接用 `1/safetyMargin` 這個代數捷徑，而是真的呼叫兩次
 * `requiredGroundRadius()` 取比值——這樣當 `maxRadius` 小到讓 `MIN_RADIUS`
 * 下限在任一次呼叫生效時（極小群），比值仍然反映函式實際回傳的半徑，不會
 * 因為走了捷徑而跟實際圓盤大小脫勾。
 */
export function groundFadeStartFraction(
  maxRadius: number,
  safetyMargin = DEFAULT_SAFETY_MARGIN,
  marginBuffer = 0.05,
): number {
  const topRayLandingRadius = requiredGroundRadius(maxRadius, 1);
  const actualRadius = requiredGroundRadius(maxRadius, safetyMargin);
  const rawFraction = topRayLandingRadius / actualRadius;
  // 防呆上限：fraction 逼近或超過 1 會讓淡出帶寬度變 0 或負值（整圈瞬間
  // 全透明，等於邊緣消失變成另一種硬邊）——理論上 `safetyMargin > 1` 時
  // 恆不會發生，但不要讓一個未來的極端輸入悄悄產生壞資料。
  return Math.min(0.95, rawFraction + marginBuffer);
}
