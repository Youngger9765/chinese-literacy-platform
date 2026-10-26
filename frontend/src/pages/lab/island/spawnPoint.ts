/**
 * #3780 P0-2（playtest 回饋，2026-10-26）：「出生點貼著燈塔，卻沒有
 * 「進入」；往前走會撞進燈塔，鏡頭穿進牆裡，整個畫面變米色」。
 *
 * 根因：createIslandWorld.ts 每一棟建築共用的地基圓柱半徑是 1.65
 * （`cylinder(root, 1.65, 1.8, 0.2, sand, 0, 0.06)`），但玩家/鏡頭的移動
 * 碰撞距離原本寫死 1.55——比地基半徑還小。玩家因此可以被放行到「距離
 * 1.55~1.65 之間」這個其實已經在建築實體內部的區間，第一人稱鏡頭的近
 * 平面貼著建築材質，整片畫面變成建築的顏色。觸發「發現新去處」的半徑
 * 也是另一個寫死的 3.25，跟建築大小沒有關聯。
 *
 * 這支把三個數字收斂成「以建築地基半徑為底、各自留固定緩衝」，不再是
 * 三個各自為政、互不相干的常數；也提供「面向燈塔、落在觸發範圍內」的
 * 出生點計算，讓玩家一上岸就能直接按「進入」，不用先走幾步也不會卡進
 * 建築裡。
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
 */
export const MIN_CAMERA_BUILDING_DISTANCE = BUILDING_BASE_RADIUS + 0.2;

/**
 * 「發現新去處」觸發半徑：建築地基半徑 + 緩衝，換了地基大小兩者會一起
 * 變，不會再變成兩個互不相干的數字。
 */
export const NEAR_TRIGGER_RADIUS = BUILDING_BASE_RADIUS + 1.6;

/**
 * 出生點與燈塔的距離：落在 NEAR_TRIGGER_RADIUS 以內（一上岸直接觸發進入
 * 卡），同時在 MIN_CAMERA_BUILDING_DISTANCE 以外（鏡頭不會一開局就卡進
 * 建築裡）。兩個邊界中間留一點餘裕，不卡在臨界值上。
 */
export const SPAWN_DISTANCE_FROM_LIGHTHOUSE = NEAR_TRIGGER_RADIUS - 0.5;

/**
 * 出生點：面向港口燈塔（lesson-intro 站），從正南方接近（跟 20011 原本
 * 出生點 `{x:-2,z:16.5}` 相對燈塔 `{x:-3,z:11}` 的方向大致一致，原本就
 * 幾乎是正南，這裡取整成剛好正南，算式比較乾淨：x 跟燈塔相同，一上岸
 * `yaw=0` 的 forward 方向就剛好指向燈塔，不用再額外轉向）。對範本引擎
 * 生成的任何一課都成立，因為只依賴傳進來的燈塔座標，不依賴地形細節。
 */
export function computeSpawnFacingLighthouse(
  lighthouse: { x: number; z: number },
  distance: number = SPAWN_DISTANCE_FROM_LIGHTHOUSE,
): { x: number; z: number; yaw: number } {
  const x = lighthouse.x;
  const z = lighthouse.z + distance;
  const toLighthouseX = lighthouse.x - x;
  const toLighthouseZ = lighthouse.z - z;
  const yaw = Math.atan2(-toLighthouseX, -toLighthouseZ);
  return { x, z, yaw };
}
