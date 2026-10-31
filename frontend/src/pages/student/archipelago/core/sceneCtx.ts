/**
 * core/sceneCtx.ts — 場景資源快取（骨架概念，皮膚層的 `SceneCtx` 型別就是
 * 這支提供的）。`.claude/skills/archipelago-module/SKILL.md` §2.1：
 * 「函式拿到的 ctx 帶共用的幾何、材質快取與 dispose 登記器」。
 *
 * 鍵控快取：同一把 key 在同一次群載入期間回傳同一個物件，不同 key 才新建。
 * 這樣主題的工廠函式（`ArchipelagoTheme.island()` 這類會被呼叫幾十次的）
 * 可以放心每次都呼叫 `ctx.material('science-roof', () => ...)`，不用自己
 * 在模組層級手動管理「這個材質有沒有建過」；換群時呼叫一次
 * `disposeAll()` 整批釋放，不用逐一追蹤。
 */
import * as THREE from 'three';

export interface SceneCtx {
  scene: THREE.Scene;
  geometry: <G extends THREE.BufferGeometry>(key: string, factory: () => G) => G;
  material: <M extends THREE.Material>(key: string, factory: () => M) => M;
}

export interface SceneCtxHandle {
  ctx: SceneCtx;
  disposeAll: () => void;
  geometryCount: () => number;
  materialCount: () => number;
  /** 測試用（`__tests__/moduleContracts.test.ts` 的走訪檢查）：目前登記過
   *  的全部幾何/材質實例，拿來跟真的建出來的物件樹逐一比對，確認主題
   *  沒有繞過 `ctx.geometry`/`ctx.material` 另外 `new` 出沒登記的資源——
   *  只數「登記過幾個、dispose 呼叫了幾次」測不出「有沒有東西根本沒
   *  登記」，那種資源從頭到尾不在任何計數裡。 */
  registeredGeometries: () => Set<THREE.BufferGeometry>;
  registeredMaterials: () => Set<THREE.Material>;
}

export function createSceneCtx(scene: THREE.Scene): SceneCtxHandle {
  const geometries = new Map<string, THREE.BufferGeometry>();
  const materials = new Map<string, THREE.Material>();

  const ctx: SceneCtx = {
    scene,
    geometry: (key, factory) => {
      if (!geometries.has(key)) geometries.set(key, factory());
      return geometries.get(key) as ReturnType<typeof factory>;
    },
    material: (key, factory) => {
      if (!materials.has(key)) materials.set(key, factory());
      return materials.get(key) as ReturnType<typeof factory>;
    },
  };

  return {
    ctx,
    disposeAll: () => {
      for (const g of geometries.values()) g.dispose();
      for (const m of materials.values()) m.dispose();
      geometries.clear();
      materials.clear();
    },
    geometryCount: () => geometries.size,
    materialCount: () => materials.size,
    registeredGeometries: () => new Set(geometries.values()),
    registeredMaterials: () => new Set(materials.values()),
  };
}
