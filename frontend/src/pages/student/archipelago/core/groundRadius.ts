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
/** 同 `createArchipelagoWorld.ts` 的 `orbitPitch = 1.05`（換群重設回的
 *  預設俯角）。2026-10-31 五次訂正：俯仰角從 0.65 調陡到 1.05（見
 *  `createArchipelagoWorld.ts` 鏡頭構圖段的完整說明），兩邊要同步——陡角度
 *  下「畫面最上緣視線」打到地面平面的距離本來就比較短，這裡沿用舊常數
 *  不會算錯方向（只會多留一點不必要的安全邊際），但為了跟實際運作的鏡頭
 *  參數對齊，還是同步更新。 */
const ORBIT_PITCH = 1.05;
/** 同 `createArchipelagoWorld.ts` 相機建構時的垂直 FOV（度）。 */
const CAMERA_FOV_DEGREES = 50;
/** 同 `ocean.ts`/`sky.ts` 的 `sea.position.y`/`cloudSea.position.y`。 */
const GROUND_PLANE_Y = -1.6;
/** 任何群都不低於的下限（原本 `Math.max(60, …)` 的那個 60，小群用這個
 *  數字量感上就夠，不必再算一次公式）。 */
const MIN_RADIUS = 60;

/**
 * @param maxRadius 這一群的外接圓半徑（`boundingCircle.radius`）
 * @param safetyMargin 理論最小半徑之上再留的安全邊際倍率——理論值剛好是
 *   門檻，鏡頭角度／長寬比／三角函式近似值的任何一點點落差都會讓邊緣露出
 *   來（這正是這次退回重做的根因）。
 */
export function requiredGroundRadius(maxRadius: number, safetyMargin = 1.5): number {
  const orbitRadius = Math.max(ORBIT_RADIUS_FLOOR, maxRadius * ORBIT_RADIUS_MULTIPLIER);
  const halfVFov = THREE.MathUtils.degToRad(CAMERA_FOV_DEGREES / 2);
  const topRayAngle = ORBIT_PITCH - halfVFov; // 畫面最上緣那條視線，相對水平面再往下多少角度
  const cameraHeightAbovePlane = orbitRadius * Math.sin(ORBIT_PITCH) + Math.abs(GROUND_PLANE_Y);
  const horizontalDistCameraToTarget = orbitRadius * Math.cos(ORBIT_PITCH);
  if (topRayAngle <= 0) {
    // 理論上在目前的俯仰角/FOV 組合下恆不會發生（pitch 比半 FOV 大，
    // 1.05 rad > 0.4363 rad）——防呆：真的變成「最上緣視線本身朝上」就
    // 代表地面平面物理上不可能把整個視野填滿，退回一個保守但有限的值，
    // 不要除以零或產生負值。
    return (horizontalDistCameraToTarget + cameraHeightAbovePlane) * safetyMargin * 10;
  }
  const topRayHorizontalReach = cameraHeightAbovePlane / Math.tan(topRayAngle);
  const needed = topRayHorizontalReach - horizontalDistCameraToTarget;
  return Math.max(MIN_RADIUS, needed * safetyMargin);
}
