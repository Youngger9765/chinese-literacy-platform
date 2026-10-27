/**
 * #3780 P0-2：鎖住「出生點貼著燈塔、鏡頭穿進牆裡」這個 bug 不會再發生。
 *
 * 兩個獨立的不變量，分開鎖：
 * ① 碰撞——鏡頭最小距離必須大於建築地基半徑（原本 1.55 < 1.65，鏡頭會被
 *    放行到建築實體內部）
 * ② 構圖（team-lead 2026-10-26 真瀏覽器截圖抓到①修好之後仍然整片米色
 *    牆才發現的根因）——燈塔有 7 個單位高，出生距離單靠「不穿牆」完全
 *    不夠，要另外驗證「塔底到塔尖都落在垂直視野內」且「觸發半徑蓋得到
 *    出生距離」。這支測試用 `isHeightFullyInView`／`isBaseInLowerHalf`
 *    這兩個共用函式重新驗證，不是只信常數檔裡的註解。
 */
import { describe, it, expect } from 'vitest';
import {
  BUILDING_BASE_RADIUS,
  MIN_CAMERA_BUILDING_DISTANCE,
  NEAR_TRIGGER_RADIUS,
  LIGHTHOUSE_NEAR_TRIGGER_RADIUS,
  LIGHTHOUSE_TOWER_BASE_Y,
  LIGHTHOUSE_ROOF_TOP_Y,
  SPAWN_DISTANCE_FROM_LIGHTHOUSE,
  SPAWN_PITCH,
  computeSpawnFacingLighthouse,
  isHeightFullyInView,
  isBaseInLowerHalf,
  nearTriggerRadiusForStep,
} from '../spawnPoint';

describe('碰撞不變量（不穿牆）', () => {
  it('鏡頭最小距離必須大於建築地基半徑（原本的 bug：1.55 < 1.65）', () => {
    expect(MIN_CAMERA_BUILDING_DISTANCE).toBeGreaterThan(BUILDING_BASE_RADIUS);
  });
});

describe('構圖不變量（看得到整座燈塔，不是一面牆）', () => {
  it('出生距離／仰角底下，燈塔底到頂整個落在垂直視野內', () => {
    expect(isHeightFullyInView({
      distance: SPAWN_DISTANCE_FROM_LIGHTHOUSE,
      pitchRad: SPAWN_PITCH,
      topY: LIGHTHOUSE_ROOF_TOP_Y,
      baseY: LIGHTHOUSE_TOWER_BASE_Y,
    })).toBe(true);
  });

  it('塔底（入口代理）落在視野中心以下，不是先看到屋頂', () => {
    expect(isBaseInLowerHalf({
      distance: SPAWN_DISTANCE_FROM_LIGHTHOUSE,
      pitchRad: SPAWN_PITCH,
      baseY: LIGHTHOUSE_TOWER_BASE_Y,
    })).toBe(true);
  });

  it('出生距離要落在鏡頭最小距離（不穿牆）跟燈塔自己的觸發半徑中間，兩邊都留餘裕', () => {
    expect(SPAWN_DISTANCE_FROM_LIGHTHOUSE).toBeGreaterThan(MIN_CAMERA_BUILDING_DISTANCE);
    expect(SPAWN_DISTANCE_FROM_LIGHTHOUSE).toBeLessThan(LIGHTHOUSE_NEAR_TRIGGER_RADIUS);
  });

  it('燈塔的觸發半徑比一般建築大很多（它本來就比一般建築高很多）', () => {
    expect(LIGHTHOUSE_NEAR_TRIGGER_RADIUS).toBeGreaterThan(NEAR_TRIGGER_RADIUS);
  });
});

describe('nearTriggerRadiusForStep — 依建築分級，不是全島共用一個數字', () => {
  it('lesson-intro（燈塔）用專屬的較大半徑', () => {
    expect(nearTriggerRadiusForStep('lesson-intro')).toBe(LIGHTHOUSE_NEAR_TRIGGER_RADIUS);
  });

  it('帶 #slug 的 step id 也查得到（多篇課文）', () => {
    expect(nearTriggerRadiusForStep('lesson-intro#anything')).toBe(LIGHTHOUSE_NEAR_TRIGGER_RADIUS);
  });

  it('其他建築維持原本共用的 NEAR_TRIGGER_RADIUS，沒有被這次改動動到', () => {
    for (const step of ['full-text-annotate', 'key-passage-reading', 'vocab-definition', 'report', 'comprehension']) {
      expect(nearTriggerRadiusForStep(step), `${step} 的觸發半徑不該變`).toBe(NEAR_TRIGGER_RADIUS);
    }
  });
});

describe('isHeightFullyInView / isBaseInLowerHalf — 純函式本身的邊界行為', () => {
  it('距離太近時（例如原本的 bug，2.75）塔底到頂塞不進視野', () => {
    expect(isHeightFullyInView({
      distance: 2.75,
      pitchRad: 0,
      topY: LIGHTHOUSE_ROOF_TOP_Y,
      baseY: LIGHTHOUSE_TOWER_BASE_Y,
    })).toBe(false);
  });

  it('距離夠遠、不仰頭（pitch=0）也裝得下的話，底部當然也在視野中心以下', () => {
    expect(isBaseInLowerHalf({ distance: 30, pitchRad: 0, baseY: LIGHTHOUSE_TOWER_BASE_Y })).toBe(true);
  });

  it('同樣是出生距離 7，不加仰角（pitch=0）塔尖還是塞不進視野——證明「仰角」這個修法本身有必要，不是順手加的', () => {
    expect(isHeightFullyInView({
      distance: SPAWN_DISTANCE_FROM_LIGHTHOUSE,
      pitchRad: 0,
      topY: LIGHTHOUSE_ROOF_TOP_Y,
      baseY: LIGHTHOUSE_TOWER_BASE_Y,
    })).toBe(false);
  });
});

describe('computeSpawnFacingLighthouse', () => {
  it('20011 的燈塔座標 {x:-3,z:11} → 出生點落在燈塔觸發半徑內、鏡頭最小距離外', () => {
    const lighthouse = { x: -3, z: 11 };
    const spawn = computeSpawnFacingLighthouse(lighthouse);
    const dist = Math.hypot(spawn.x - lighthouse.x, spawn.z - lighthouse.z);
    expect(dist).toBeGreaterThan(MIN_CAMERA_BUILDING_DISTANCE);
    expect(dist).toBeLessThan(LIGHTHOUSE_NEAR_TRIGGER_RADIUS);
  });

  it('回傳的 pitch 就是 SPAWN_PITCH，不是 0', () => {
    const spawn = computeSpawnFacingLighthouse({ x: -3, z: 11 });
    expect(spawn.pitch).toBe(SPAWN_PITCH);
  });

  it('不是寫死 20011 的座標——換一個燈塔位置，距離關係一樣成立', () => {
    const lighthouse = { x: 40, z: -17 };
    const spawn = computeSpawnFacingLighthouse(lighthouse);
    const dist = Math.hypot(spawn.x - lighthouse.x, spawn.z - lighthouse.z);
    expect(dist).toBeCloseTo(SPAWN_DISTANCE_FROM_LIGHTHOUSE, 5);
  });

  it('yaw=0 的 forward 方向（-sin(yaw), -cos(yaw)）要真的指向燈塔，不是隨便一個角度', () => {
    const lighthouse = { x: 5, z: 2 };
    const spawn = computeSpawnFacingLighthouse(lighthouse);
    const forward = { x: -Math.sin(spawn.yaw), z: -Math.cos(spawn.yaw) };
    const toLighthouse = { x: lighthouse.x - spawn.x, z: lighthouse.z - spawn.z };
    const toLighthouseLen = Math.hypot(toLighthouse.x, toLighthouse.z);
    // forward 跟「指向燈塔」的單位向量應該幾乎重合（點積接近 1）
    const dot = (forward.x * toLighthouse.x + forward.z * toLighthouse.z) / toLighthouseLen;
    expect(dot).toBeCloseTo(1, 5);
  });

  it('可以傳自訂距離（供測試/未來調整用），不是只認預設值', () => {
    const lighthouse = { x: 0, z: 0 };
    const spawn = computeSpawnFacingLighthouse(lighthouse, 10);
    expect(Math.hypot(spawn.x - lighthouse.x, spawn.z - lighthouse.z)).toBeCloseTo(10, 5);
  });
});
