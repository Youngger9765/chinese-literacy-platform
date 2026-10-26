/**
 * #3780 P0-2：鎖住「出生點貼著燈塔、鏡頭穿進牆裡」這個 bug 不會再發生。
 * 真正的 bug 是兩個不變量被打破：① 鏡頭最小距離必須大於建築地基半徑
 * （原本 1.55 < 1.65，鏡頭會被放行到建築實體內部）② 觸發半徑必須大於
 * 鏡頭最小距離（否則玩家還沒被推開就已經觸發不了進入卡，或反過來卡住）。
 * 這支測試直接鎖這兩個不變量，而不是鎖死某個字面數字——換了地基大小、
 * 緩衝量，只要這兩個關係還成立就還是對的。
 */
import { describe, it, expect } from 'vitest';
import {
  BUILDING_BASE_RADIUS,
  MIN_CAMERA_BUILDING_DISTANCE,
  NEAR_TRIGGER_RADIUS,
  SPAWN_DISTANCE_FROM_LIGHTHOUSE,
  computeSpawnFacingLighthouse,
} from '../spawnPoint';

describe('建築碰撞/觸發半徑的不變量', () => {
  it('鏡頭最小距離必須大於建築地基半徑（原本的 bug：1.55 < 1.65）', () => {
    expect(MIN_CAMERA_BUILDING_DISTANCE).toBeGreaterThan(BUILDING_BASE_RADIUS);
  });

  it('觸發半徑必須大於鏡頭最小距離（不然會先卡進建築才觸發，或觸發了卻進不去）', () => {
    expect(NEAR_TRIGGER_RADIUS).toBeGreaterThan(MIN_CAMERA_BUILDING_DISTANCE);
  });

  it('出生點到燈塔的距離要落在「鏡頭最小距離」與「觸發半徑」中間，兩邊都留餘裕', () => {
    expect(SPAWN_DISTANCE_FROM_LIGHTHOUSE).toBeGreaterThan(MIN_CAMERA_BUILDING_DISTANCE);
    expect(SPAWN_DISTANCE_FROM_LIGHTHOUSE).toBeLessThan(NEAR_TRIGGER_RADIUS);
  });
});

describe('computeSpawnFacingLighthouse', () => {
  it('20011 的燈塔座標 {x:-3,z:11} → 出生點落在觸發半徑內、鏡頭最小距離外', () => {
    const lighthouse = { x: -3, z: 11 };
    const spawn = computeSpawnFacingLighthouse(lighthouse);
    const dist = Math.hypot(spawn.x - lighthouse.x, spawn.z - lighthouse.z);
    expect(dist).toBeGreaterThan(MIN_CAMERA_BUILDING_DISTANCE);
    expect(dist).toBeLessThan(NEAR_TRIGGER_RADIUS);
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
