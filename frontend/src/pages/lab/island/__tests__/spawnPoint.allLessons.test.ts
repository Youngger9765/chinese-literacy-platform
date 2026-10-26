/**
 * #3780 P0-2 退件 Q3（審查員 2026-10-26）：第一版 `MIN_CAMERA_BUILDING_DISTANCE`
 * 只驗過 20011 一課，上線後才會發現「有些課的建築剛好擠在一起，玩家過不去」
 * ——審查員拿全平台 179 課的真實 step_sequence 實際算過，抓到 133 課至少
 * 有一對建築間距 < 2×2.0=4.0（最窄的一對「工匠作坊」/「地圖塔」只有
 * 3.963），直接退件。
 *
 * 這支測試用同一份 179 課的真實資料（`fixtures/all-lessons-step-sequence.json`，
 * 來源見該檔 `_meta`）當回歸鎖，鎖兩件事：
 * ① 每一課的出生點都可行走、落在觸發範圍內、在鏡頭最小距離外、不卡進任何
 *    建築或山丘的碰撞圈
 * ② 每一課裡，同一區任兩棟建築的間距都 ≥ 2×MIN_CAMERA_BUILDING_DISTANCE
 *    ——這是「玩家走得過去」的充分條件：兩個碰撞圓不重疊，中間一定留得出
 *    一條路
 *
 * 多篇課文那批（#3780 另一批工作）會讓站數變多、建築變密，這支測試會是
 * 那批真正的守門員——到時候一定會跑到。
 */
import { describe, expect, it } from 'vitest';
import { buildStopsFromSequence } from '../islandTemplate';
import { computeSpawnFacingLighthouse, MIN_CAMERA_BUILDING_DISTANCE, NEAR_TRIGGER_RADIUS } from '../spawnPoint';
import { hillPositions, zoneCenters } from '../createIslandWorld';
import fixture from './fixtures/all-lessons-step-sequence.json';

interface LessonFixture {
  id: number;
  title: string;
  step_sequence: string[];
}

const lessons = (fixture as { lessons: LessonFixture[] }).lessons;

/** `createIslandWorld.ts` 的 `walkable()` 在出生當下的等價算法：
 * unlockedZone 固定是 0（遊戲一開始只解鎖第一區），邏輯原樣照抄，不重寫。*/
function isWalkableAtSpawn(x: number, z: number): boolean {
  const unlockedZone = 0;
  const inUnlockedZone = zoneCenters.some(
    (zone, index) => index <= unlockedZone && Math.hypot(x - zone.x, z - zone.z) < zone.radius - 1,
  );
  const inLockedZone = zoneCenters.some(
    (zone, index) => index > unlockedZone && Math.hypot(x - zone.x, z - zone.z) < zone.radius,
  );
  return inUnlockedZone && !inLockedZone;
}

function isInsideAnyHill(x: number, z: number): boolean {
  return hillPositions.some(([hx, hz, r]) => Math.hypot(x - hx, z - hz) < r * 0.7);
}

describe('spawnPoint — 全平台 179 課回歸鎖（#3780 P0-2 退件 Q3）', () => {
  it('fixture 真的涵蓋 179 課，不是空的或漏抓的', () => {
    expect(lessons.length).toBe(179);
  });

  describe.each(lessons.map((l) => [l.id, l.title, l.step_sequence] as const))(
    '第 %i 課「%s」',
    (id, title, stepSequence) => {
      const stops = buildStopsFromSequence(stepSequence);

      it('出生點可行走、落在觸發範圍內、在鏡頭最小距離外、不卡進任何建築或山丘', () => {
        expect(stops.length, `第 ${id} 課「${title}」至少要有一個站`).toBeGreaterThan(0);
        const lighthouse = stops.find((s) => s.step === 'lesson-intro') ?? stops[0];
        const spawn = computeSpawnFacingLighthouse(lighthouse);

        expect(isWalkableAtSpawn(spawn.x, spawn.z), '出生點要在可行走範圍內').toBe(true);

        const distToLighthouse = Math.hypot(spawn.x - lighthouse.x, spawn.z - lighthouse.z);
        expect(distToLighthouse, '出生點要落在觸發半徑內，才會一上岸就觸發進入卡').toBeLessThan(NEAR_TRIGGER_RADIUS);

        for (const stop of stops) {
          const d = Math.hypot(spawn.x - stop.x, spawn.z - stop.z);
          expect(d, `出生點不能卡進「${stop.name}」的碰撞圈`).toBeGreaterThanOrEqual(MIN_CAMERA_BUILDING_DISTANCE);
        }

        expect(isInsideAnyHill(spawn.x, spawn.z), '出生點不能卡進任何山丘的碰撞圈').toBe(false);
      });

      it('同一區任兩棟建築的間距都 ≥ 2×鏡頭最小距離（玩家走得過去，不會被兩個碰撞圈夾死）', () => {
        const minGap = MIN_CAMERA_BUILDING_DISTANCE * 2;
        const byZone = new Map<number, typeof stops>();
        for (const stop of stops) {
          if (!byZone.has(stop.zone)) byZone.set(stop.zone, []);
          byZone.get(stop.zone)!.push(stop);
        }
        for (const [zone, zoneStops] of byZone) {
          for (let i = 0; i < zoneStops.length; i++) {
            for (let j = i + 1; j < zoneStops.length; j++) {
              const a = zoneStops[i];
              const b = zoneStops[j];
              const d = Math.hypot(a.x - b.x, a.z - b.z);
              expect(d, `第 ${zone} 區「${a.name}」跟「${b.name}」間距要走得過去`).toBeGreaterThanOrEqual(minGap);
            }
          }
        }
      });
    },
  );
});
