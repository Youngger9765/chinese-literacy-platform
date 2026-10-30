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
  };
}
