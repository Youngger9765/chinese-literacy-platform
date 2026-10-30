/**
 * archipelago/__tests__/moduleContracts.test.ts — 群島模組契約測試
 * （`.claude/skills/archipelago-module/SKILL.md` §3，四條）。
 *
 * 新增主題／新增分群方式時這支必須全線通過——四條各自驗哪一層壞了會被
 * 攔下來，不是一條大雜燴斷言。TDD：先寫這支，`core/`、`themes/` 還沒搬完
 * 的中間狀態這支應該紅（import 失敗或斷言不符），搬完建完才變綠。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
import { describe, it, expect, vi } from 'vitest';
import { THEMES } from '../themes';
import { createSceneCtx } from '../core/sceneCtx';
import { GROUPINGS } from '../core/groupings';
import type { CellInfo, PortalTargetInfo } from '../themes/types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(path.resolve(HERE, '../core/__tests__/fixtures/all-stories.json'), 'utf-8'));
const stories = fixture.stories ?? fixture;
const TOTAL = fixture.total ?? stories.length;

const SAMPLE_CELL: CellInfo = {
  storySlug: '20011',
  title: '範例課',
  category: '自然科學',
  status: 'not_started',
  stationsDone: 0,
  stationsTotal: 9,
  position: { x: 0, z: 0 },
};
const SAMPLE_PORTAL_TARGET: PortalTargetInfo = { key: 'genre-說明文', label: '說明文群島', occupiedCount: 2, total: 10 };
const CATEGORIES = ['自然科學', '寓言故事', '歷史人文', '生活', '其他'];
const STATUSES = ['occupied', 'in_progress', 'not_started'] as const;

describe('① 每個主題：§2.1 每一項都提供、statusLook 三態齊全、landmarks.default 存在', () => {
  for (const [id, theme] of Object.entries(THEMES)) {
    it(`${id}（${theme.name}）`, () => {
      expect(theme.id).toBe(id);
      expect(theme.name).toBeTruthy();
      for (const key of ['background', 'fog', 'accent', 'occupied', 'inProgress', 'unexplored'] as const) {
        expect(theme.palette[key], `palette.${key}`).toBeTruthy();
      }
      expect(typeof theme.lighting.sunIntensity).toBe('number');
      expect(typeof theme.lighting.ambient).toBe('number');
      expect(theme.lighting.hemisphereSky).toBeTruthy();
      expect(theme.lighting.hemisphereGround).toBeTruthy();
      expect(theme.lighting.sunDirection).toHaveLength(3);
      expect(typeof theme.ground).toBe('function');
      expect(typeof theme.island).toBe('function');
      expect(typeof theme.hub).toBe('function');
      expect(typeof theme.portal).toBe('function');
      expect(typeof theme.connector).toBe('function');
      expect(typeof theme.transition.durationMs).toBe('number');
      expect(theme.transition.color).toBeTruthy();

      for (const state of STATUSES) {
        expect(typeof theme.statusLook[state], `statusLook.${state}`).toBe('function');
      }
      expect(typeof theme.landmarks.default, 'landmarks.default').toBe('function');

      // code review 2026-10-30 非 blocker：原本只驗 `landmarks.default`
      // 存在，沒驗「三個有名字的類別真的各自有自己的地標」——少打一個類別
      // 的話它會悄悄落到 `landmarks.default` 的 fallback，產出的畫面看起來
      // 一樣，但測試完全不會紅。這裡額外驗這三個類別：① 真的在
      // `landmarks` 裡掛了一個函式 ② 那個函式**不是** `landmarks.default`
      // 本身（證明是刻意分開寫的對應，不是巧合指到同一個函式）。
      for (const named of ['自然科學', '寓言故事', '歷史人文']) {
        expect(typeof theme.landmarks[named], `landmarks.${named}`).toBe('function');
        expect(theme.landmarks[named], `landmarks.${named} 不該跟 landmarks.default 是同一個函式`).not.toBe(theme.landmarks.default);
      }
    });
  }

  it('THEMES 至少含 ocean（預設）與 sky（PRD §8.5 本輪交付的兩個主題）', () => {
    expect(Object.keys(THEMES).sort()).toEqual(['ocean', 'sky']);
  });
});

/** 蓋一整群的測試夾具：ground/hub/portal/connector/每個類別×每個狀態的
 *  島（含 statusLook 疊加）——check②兩條測試共用同一棵樹，不要各自蓋一棵
 *  長得不一樣的，不然「樹裡有沒有繞過 ctx」驗的範圍會對不齊。 */
function buildFullClusterTree(theme: (typeof THEMES)[string], ctx: ReturnType<typeof createSceneCtx>['ctx']): THREE.Group {
  const group = new THREE.Group();
  group.add(theme.ground(ctx));
  group.add(theme.hub(ctx));
  group.add(theme.portal(ctx, SAMPLE_PORTAL_TARGET));
  for (const category of CATEGORIES) {
    for (const status of STATUSES) {
      const cell: CellInfo = { ...SAMPLE_CELL, category, status };
      const islandObj = theme.island(ctx, cell);
      theme.statusLook[status](islandObj, ctx);
      group.add(islandObj);
    }
  }
  const connector = theme.connector(ctx, { x: 0, z: 0 }, { x: 3, z: 3 });
  if (connector) group.add(connector);
  return group;
}

describe('② 主題建出來的每一個 geometry/material 都要登記在 ctx 裡，不准繞過', () => {
  for (const [id, theme] of Object.entries(THEMES)) {
    it(`${id}（${theme.name}）：整棵物件樹裡沒有任何未登記的幾何/材質`, () => {
      // code review 2026-10-30：舊版只 spy `dispose()` 呼叫次數，等於只驗
      // 「登記過的東西有沒有被釋放」——完全驗不到「有沒有東西從一開始就
      // 沒登記」，因為沒登記的資源本來就不在任何計數裡（sky.ts 的
      // `portal()`／`statusLook.occupied`／`statusLook.not_started` 繞過
      // ctx 直接 `new THREE.XxxGeometry/Material`，舊版測試完全抓不到，
      // 是 team-lead 自己讀 diff 才看出來的）。改成走訪整棵建出來的物件
      // 樹，逐一比對每個 mesh 的 geometry／material 是不是真的在 ctx 的
      // 登記清單裡——繞過 ctx 的資源不會出現在清單裡，一定會被抓到。
      const scene = new THREE.Scene();
      const { ctx, registeredGeometries, registeredMaterials } = createSceneCtx(scene);
      const group = buildFullClusterTree(theme, ctx);

      const geomSet = registeredGeometries();
      const matSet = registeredMaterials();
      const unregisteredGeometries: string[] = [];
      const unregisteredMaterials: string[] = [];

      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry && !geomSet.has(mesh.geometry)) {
          unregisteredGeometries.push(`${mesh.type}(uuid=${mesh.geometry.uuid.slice(0, 8)})`);
        }
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            if (!matSet.has(m)) unregisteredMaterials.push(`${mesh.type}(uuid=${m.uuid.slice(0, 8)})`);
          }
        }
      });

      expect(unregisteredGeometries, `未登記的 geometry：${unregisteredGeometries.join(', ')}`).toHaveLength(0);
      expect(unregisteredMaterials, `未登記的 material：${unregisteredMaterials.join(', ')}`).toHaveLength(0);
    });
  }
});

describe('②b 每個主題能在假 SceneCtx 上建出一個群，dispose 後幾何/材質數回到 0', () => {
  for (const [id, theme] of Object.entries(THEMES)) {
    it(`${id}（${theme.name}）`, () => {
      const scene = new THREE.Scene();
      const { ctx, disposeAll, geometryCount, materialCount } = createSceneCtx(scene);
      buildFullClusterTree(theme, ctx);

      // 先確認真的有東西被登記過，不然 dispose 後是 0 可能只是「從來沒建過」
      const geoCountBefore = geometryCount();
      const matCountBefore = materialCount();
      expect(geoCountBefore).toBeGreaterThan(0);
      expect(matCountBefore).toBeGreaterThan(0);

      // code review 2026-10-30 非 blocker：原本只斷言
      // `geometryCount()`/`materialCount()` dispose 後回到 0——但那是
      // `disposeAll()` 自己 `.clear()` 兩個 Map 的直接結果，跟它有沒有真的
      // 呼叫每個資源的 `.dispose()` 完全無關，就算 `disposeAll()` 被改成
      // 空函式加兩行 `.clear()`，這條斷言照樣綠（同義反覆，不是真的測
      // disposal）。改成直接 spy `THREE.BufferGeometry.prototype.dispose`／
      // `THREE.Material.prototype.dispose`，驗證呼叫次數真的等於登記過的
      // 資源數——這樣故意把 `disposeAll()` 改成只清 Map 不呼叫 dispose，
      // 這條測試會紅。
      const geoDisposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
      const matDisposeSpy = vi.spyOn(THREE.Material.prototype, 'dispose');
      disposeAll();

      expect(geoDisposeSpy).toHaveBeenCalledTimes(geoCountBefore);
      expect(matDisposeSpy).toHaveBeenCalledTimes(matCountBefore);
      expect(geometryCount()).toBe(0);
      expect(materialCount()).toBe(0);

      geoDisposeSpy.mockRestore();
      matDisposeSpy.mockRestore();
    });
  }
});

describe('③ 每個 GROUPINGS 分群方式：群加總 = 課程總數，每課剛好一群', () => {
  for (const [id, strategy] of Object.entries(GROUPINGS)) {
    it(`${id}（${strategy.label}）`, () => {
      const clusters = strategy.clusters(stories);
      const sum = clusters.reduce((acc, c) => acc + c.storyCount, 0);
      expect(sum).toBe(TOTAL);

      const seenKeys = new Set<string>();
      for (const story of stories) seenKeys.add(strategy.clusterOf(story));
      expect(seenKeys).toEqual(new Set(clusters.map((c) => c.key)));
    });
  }

  it('三種分群策略都存在（grade/genre/category）', () => {
    expect(Object.keys(GROUPINGS).sort()).toEqual(['category', 'genre', 'grade']);
  });
});

describe('④ 場景程式原始碼裡不准出現主題字眼', () => {
  it('createArchipelagoWorld.ts 不含 ocean|sea|cloud|coral|0x[0-9a-f]{6}', () => {
    const source = readFileSync(path.resolve(HERE, '../createArchipelagoWorld.ts'), 'utf-8');
    const match = source.match(/ocean|sea|cloud|coral|0x[0-9a-f]{6}/i);
    expect(match === null, match ? `命中：「${match[0]}」` : '').toBe(true);
  });
});
