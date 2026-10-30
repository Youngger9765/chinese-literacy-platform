/**
 * themes/landmarkBuildings.ts — 群島地標改用單課島真正的 15 種建築造型
 * （team-lead 2026-10-31 明令：「改成直接用單課島的 15 種建築造型
 * （islandBuildingShapes），不要再用『柱子＋小物件』的簡化版」）。
 *
 * `buildStationGroup()`（`lab/island/islandBuildingShapes.ts`）是單課島
 * 走動場景用的——它自己 `new THREE.XxxGeometry`/`new THREE.MeshStandardMaterial`，
 * 完全不知道群島這邊的 `SceneCtx` 登記機制存在（兩個場景本來就是分開的
 * 模組，互不知道對方）。直接把它的 `.root` 插進群島的物件樹會違反契約
 * 測試②（「主題建出來的每一個 geometry/material 都要登記在 ctx 裡」）——
 * 不是重寫那 15 種造型，是**事後補登記**：`ctx.geometry(key, factory)`
 * 本來就是「這把 key 沒快取過才呼叫 factory」的惰性快取，餵一個
 * `() => 已經蓋好的既有物件` 當 factory，一樣能把既有物件納入 ctx 的
 * 追蹤清單，不必碰 `buildStationGroup` 內部一行。
 */
import * as THREE from 'three';
import { buildStationGroup } from '../../../lab/island/islandBuildingShapes';
import type { SceneCtx } from '../core/sceneCtx';

/** `buildStationGroup` 共用的地基圓柱半徑是 1.65~1.8（15 種造型開頭那行
 *  `cylinder(root, 1.65, 1.8, 0.2, sandBase, 0, 0.06)`，不分哪一種都一樣
 *  ——用這個算「原生底座寬度」，不用每次都重新量 bounding box。 */
const NATIVE_BASE_RADIUS = 1.725;

let landmarkInstanceCounter = 0;

/**
 * 蓋一棟地標建築，縮放到底座寬度約等於 `targetBaseWidth`（team-lead：
 * 「縮放到建築底座寬度約等於島半徑的 0.9」，呼叫端自己算 `targetBaseWidth
 * = approxRadius * 0.9` 再傳進來，這支不重複判斷島半徑是什麼）。
 *
 * `heightBoost`（預設 1.4，只放大 Y 軸，不動底座寬度）：團隊長另一條驗收
 * 標準是「1280 開場畫面裡每個地標至少 40px 高」，但開場鏡頭為了衝
 * 「非海背景像素 ≥65%」已經拉遠到 maxDist×2.9（見
 * `createArchipelagoWorld.ts` 鏡頭構圖的註解），兩個數字互相拉扯：純靠
 * 寬度縮放（uniform scale）量到的高度只有 ≈34px，差一截。鏡頭不能為了
 * 這一條再拉近（會把 65% 那條擠破），所以改用只加高、不加寬的做法——
 * 遠距離遊戲地標本來就常見「垂直誇張」手法換取輪廓辨識度，不是隨便喬，
 * 底座寬度仍然精準落在 `targetBaseWidth`，只有高度單獨再乘一次。
 *
 * @param stepType `ALL_STATION_STEP_TYPES` 其中一種（15 選 1）
 * @param keyPrefix 註冊到 ctx 的 key 前綴（通常用主題 id，如 'ocean'/'sky'）
 */
export function buildLandmarkFromStationShape(
  ctx: SceneCtx,
  stepType: string,
  targetBaseWidth: number,
  keyPrefix: string,
  heightBoost = 1.4,
): THREE.Group {
  const sandBase = new THREE.MeshStandardMaterial({ color: 0xd9c397, roughness: 0.85 });
  const built = buildStationGroup({ name: '', step: stepType }, sandBase);
  const nativeBaseWidth = NATIVE_BASE_RADIUS * 2;
  const scale = targetBaseWidth / nativeBaseWidth;
  built.root.scale.set(scale, scale * heightBoost, scale);

  const instanceId = landmarkInstanceCounter++;
  built.root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const registeredMats = mats.map((mat, mIdx) =>
      ctx.material(`${keyPrefix}-landmark-${stepType}-${instanceId}-mat-${mIdx}-${mat.uuid}`, () => mat),
    );
    obj.material = Array.isArray(obj.material) ? registeredMats : registeredMats[0];
    ctx.geometry(`${keyPrefix}-landmark-${stepType}-${instanceId}-geo-${obj.geometry.uuid}`, () => obj.geometry);
  });

  return built.root;
}
