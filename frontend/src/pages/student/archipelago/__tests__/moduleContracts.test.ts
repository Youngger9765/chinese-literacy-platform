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
import { describe, it, expect } from 'vitest';
import { THEMES } from '../themes';
import { createSceneCtx } from '../core/sceneCtx';
import { GROUPINGS } from '../core/groupings';
import type { CellInfo, ClusterInfo } from '../themes/types';

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
const SAMPLE_PORTAL_TARGET: ClusterInfo = { key: 'genre-說明文', label: '說明文群島', occupiedCount: 2, total: 10 };
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
    });
  }

  it('THEMES 至少含 ocean（預設）與 sky（PRD §8.5 本輪交付的兩個主題）', () => {
    expect(Object.keys(THEMES).sort()).toEqual(['ocean', 'sky']);
  });
});

describe('② 每個主題能在假 SceneCtx 上建出一個群，dispose 後幾何/材質數回到 0', () => {
  for (const [id, theme] of Object.entries(THEMES)) {
    it(`${id}（${theme.name}）`, () => {
      const scene = new THREE.Scene();
      const { ctx, disposeAll, geometryCount, materialCount } = createSceneCtx(scene);

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

      // 先確認真的有東西被登記過，不然 dispose 後是 0 可能只是「從來沒建過」
      expect(geometryCount()).toBeGreaterThan(0);
      expect(materialCount()).toBeGreaterThan(0);

      disposeAll();
      expect(geometryCount()).toBe(0);
      expect(materialCount()).toBe(0);
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
