/**
 * #3780 P0-2 退件 Q3（審查員 2026-10-26）：第一版 `MIN_CAMERA_BUILDING_DISTANCE`
 * 只驗過 20011 一課，上線後才會發現「有些課的建築剛好擠在一起，玩家過不去」
 * ——審查員拿全平台 179 課的真實 step_sequence 實際算過，抓到 133 課至少
 * 有一對建築間距 < 2×2.0=4.0（最窄的一對「工匠作坊」/「地圖塔」只有
 * 3.963），直接退件。
 *
 * #3780 P0-2 真瀏覽器退件二輪（team-lead 2026-10-26 headless 截圖）：① 修好之後
 * 真瀏覽器截圖還是整片米色牆——根因是燈塔將近 7 個單位高，出生距離 2.75
 * 不管碰撞距離抓多準，站那麼近看一座那麼高的塔本來就會被塔身填滿畫面。
 * 改成出生距離 7 + 初始仰角 15°（見 spawnPoint.ts 的推導），並把「發現新
 * 去處」的觸發半徑改成依建築類型分級（燈塔自己一個較大值，其他站不變）。
 *
 * #3780 P0-2 退件三輪（審查員 2026-10-26）：分級之後用「距離 ÷ 自己的
 * 半徑」比例值選最近站，燈塔半徑比其他站大超過兩倍時，玩家站在旁邊小站
 * 的門口（對那一站已經近到不能再近）仍然可能被判成「燈塔比較近」——
 * 179 課裡 1,658 組燈塔—其他站配對，有 164 組（9.9%）會被搶走。改成
 * `selectNearestStation()`（見 spawnPoint.ts）：先用各站自己的半徑獨立
 * 判斷有沒有進範圍，有進範圍的候選裡才比真正的距離。
 *
 * 這支測試用同一份 179 課的真實資料（`fixtures/all-lessons-step-sequence.json`，
 * 來源見該檔 `_meta`）當回歸鎖，鎖五件事：
 * ① 每一課的出生點都可行走、不出島、不卡進任何建築或山丘的碰撞圈
 * ② 每一課出生時，燈塔的塔底到塔尖都落在垂直視野內（不是一面牆）
 * ③ 每一課一上岸就落在燈塔自己的觸發半徑內，直接跳出進入卡——用
 *    `nearTriggerRadiusForStep(lighthouse.step)` 現場算，不是對著一個
 *    寫死的常數比，不然這個函式本身被改壞了這條測試也抓不到
 * ④ 每一課的其他（非燈塔）站，觸發半徑維持原本的 NEAR_TRIGGER_RADIUS，
 *    而且確實比燈塔小（不會互搶）
 * ⑤ 每一課每一組「燈塔—其他站」配對，玩家站在其他站的門口（碰撞邊界、
 *    朝燈塔那一側，對那一站而言已經近到不能再近）時，`selectNearestStation`
 *    選到的必須是那個其他站，不是燈塔——這條直接重現退件三輪的真實 bug
 * ⑥ 正向對照（審查員 2026-10-26 四輪覆核發現的缺口）：玩家站在燈塔自己
 *    的出生點，選到的要是燈塔本身——沒有這條，一個「把 lesson-intro 排除
 *    在候選外」的假想 bug 會讓上面所有測試全綠，卻沒有任何測試真的在
 *    「玩家站在燈塔門口」這個案例呼叫過 `selectNearestStation`
 * ⑦ 全區解鎖（late game）時，跨區的燈塔—其他站配對也不會互搶——⑤只測
 *    同區（出生當下 unlockedZone=0，跨區站本來就不是候選），這條把範圍
 *    延伸到遊戲後期全區域都解鎖的情況
 *
 * 多篇課文那批（#3780 另一批工作）會讓站數變多、建築變密，這支測試會是
 * 那批真正的守門員——到時候一定會跑到。
 */
import { describe, expect, it } from 'vitest';
import { buildStopsFromSequence } from '../islandTemplate';
import {
  computeSpawnFacingLighthouse,
  isHeightFullyInView,
  isBaseInLowerHalf,
  nearTriggerRadiusForStep,
  selectNearestStation,
  LIGHTHOUSE_ROOF_TOP_Y,
  LIGHTHOUSE_TOWER_BASE_Y,
  MIN_CAMERA_BUILDING_DISTANCE,
  NEAR_TRIGGER_RADIUS,
} from '../spawnPoint';
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

describe('spawnPoint — 全平台 179 課回歸鎖（#3780 P0-2）', () => {
  it('fixture 真的涵蓋 179 課，不是空的或漏抓的', () => {
    expect(lessons.length).toBe(179);
  });

  describe.each(lessons.map((l) => [l.id, l.title, l.step_sequence] as const))(
    '第 %i 課「%s」',
    (id, title, stepSequence) => {
      const stops = buildStopsFromSequence(stepSequence);

      it('① 出生點可行走、不出島、不卡進任何建築或山丘碰撞圈', () => {
        expect(stops.length, `第 ${id} 課「${title}」至少要有一個站`).toBeGreaterThan(0);
        const lighthouse = stops.find((s) => s.step === 'lesson-intro') ?? stops[0];
        const spawn = computeSpawnFacingLighthouse(lighthouse);

        expect(isWalkableAtSpawn(spawn.x, spawn.z), '出生點要在可行走範圍內').toBe(true);

        for (const stop of stops) {
          const d = Math.hypot(spawn.x - stop.x, spawn.z - stop.z);
          expect(d, `出生點不能卡進「${stop.name}」的碰撞圈`).toBeGreaterThanOrEqual(MIN_CAMERA_BUILDING_DISTANCE);
        }

        expect(isInsideAnyHill(spawn.x, spawn.z), '出生點不能卡進任何山丘的碰撞圈').toBe(false);
      });

      it('② 出生時燈塔塔底到塔尖都落在垂直視野內（不是一面牆）', () => {
        const lighthouse = stops.find((s) => s.step === 'lesson-intro') ?? stops[0];
        const spawn = computeSpawnFacingLighthouse(lighthouse);
        const distance = Math.hypot(spawn.x - lighthouse.x, spawn.z - lighthouse.z);
        expect(isHeightFullyInView({
          distance,
          pitchRad: spawn.pitch,
          topY: LIGHTHOUSE_ROOF_TOP_Y,
          baseY: LIGHTHOUSE_TOWER_BASE_Y,
        }), '塔底到塔尖要整個落在視野內').toBe(true);
        expect(isBaseInLowerHalf({
          distance,
          pitchRad: spawn.pitch,
          baseY: LIGHTHOUSE_TOWER_BASE_Y,
        }), '塔底（入口代理）要落在視野中心以下').toBe(true);
      });

      it('③ 一上岸就落在燈塔自己的觸發半徑內，直接跳出進入卡', () => {
        const lighthouse = stops.find((s) => s.step === 'lesson-intro') ?? stops[0];
        const spawn = computeSpawnFacingLighthouse(lighthouse);
        const distToLighthouse = Math.hypot(spawn.x - lighthouse.x, spawn.z - lighthouse.z);
        // #3780 退件三輪：原本對著 `LIGHTHOUSE_NEAR_TRIGGER_RADIUS` 這個常數比，
        // 如果 `nearTriggerRadiusForStep` 本身被改壞（例如永遠回 3.25），
        // 這條測試完全不會發現，因為它根本沒呼叫到那個函式。改成直接呼叫
        // 真正會在引擎裡用到的那支函式。
        expect(distToLighthouse, '出生點要落在燈塔專屬觸發半徑內').toBeLessThan(nearTriggerRadiusForStep(lighthouse.step));
      });

      it('④ 其他（非燈塔）站的觸發半徑維持 NEAR_TRIGGER_RADIUS，而且確實比燈塔小（不會互搶）', () => {
        const lighthouse = stops.find((s) => s.step === 'lesson-intro') ?? stops[0];
        const lighthouseRadius = nearTriggerRadiusForStep(lighthouse.step);
        const others = stops.filter((s) => s.step !== 'lesson-intro');
        for (const stop of others) {
          const otherRadius = nearTriggerRadiusForStep(stop.step);
          expect(otherRadius, `「${stop.name}」的觸發半徑不該變`).toBe(NEAR_TRIGGER_RADIUS);
          expect(otherRadius, `「${stop.name}」的觸發半徑要比燈塔小，否則會互搶`).toBeLessThan(lighthouseRadius);
        }
      });

      it('⑤ 玩家站在其他站的門口（朝燈塔那一側）時，選到的是那一站，不是燈塔（#3780 退件三輪真實 bug）', () => {
        const lighthouseIndex = stops.findIndex((s) => s.step === 'lesson-intro');
        if (lighthouseIndex < 0) return; // 理論上不會發生，buildStopsFromSequence 保證有
        const lighthouse = stops[lighthouseIndex];
        stops.forEach((other, otherIndex) => {
          if (otherIndex === lighthouseIndex) return;
          if (other.zone !== lighthouse.zone) return; // 遊戲一開始只解鎖 zone 0，不同區不會同時候選
          // 門口＝朝燈塔那一側的碰撞邊界：對「other」而言已經近到不能再近，
          // 同時盡量靠近燈塔（對燈塔最有利的方向），這是最容易暴露 bug 的位置。
          const dx = lighthouse.x - other.x;
          const dz = lighthouse.z - other.z;
          const dist = Math.hypot(dx, dz) || 1;
          const player = {
            x: other.x + (dx / dist) * MIN_CAMERA_BUILDING_DISTANCE,
            z: other.z + (dz / dist) * MIN_CAMERA_BUILDING_DISTANCE,
          };
          const selected = selectNearestStation(stops, player, lighthouse.zone);
          expect(selected, `第 ${id} 課「${title}」：站在「${other.name}」門口卻選到別的站（index ${selected}，應為 ${otherIndex}「${other.name}」）`).toBe(otherIndex);
        });
      });

      it('⑥ 正向對照：玩家站在燈塔自己的出生點，選到的是燈塔本身（防止「把 lesson-intro 排除在候選外」這種 bug 也全綠）', () => {
        const lighthouseIndex = stops.findIndex((s) => s.step === 'lesson-intro');
        if (lighthouseIndex < 0) return;
        const lighthouse = stops[lighthouseIndex];
        const spawn = computeSpawnFacingLighthouse(lighthouse);
        const selected = selectNearestStation(stops, spawn, lighthouse.zone);
        expect(selected, `第 ${id} 課「${title}」：站在燈塔自己的出生點卻沒選到燈塔（index ${selected}）`).toBe(lighthouseIndex);
      });

      // ⚠️ 誠實標記（team-lead/Young 2026-10-27 review）：這條是「前瞻覆蓋」
      // 不是回歸鎖——把 `selectNearestStation` 退回退件三輪的舊比例邏輯
      // （`距離 / 各自半徑` 直接比較）重跑這支，179 課跨區配對測過 0 筆會
      // 紅，因為跨區的站彼此距離夠遠，舊比例邏輯的誤差在這個尺度下不會
      // 被觸發（同區的情況才會，那是 ⑤ 在鎖）。保留它是因為它確實擴大了
      // 「跨區不會互搶」這個情境的測試覆蓋，只是現在還沒有一個已知的真實
      // bug 會被它抓到——不要把它當成跟 ⑤ 一樣的回歸鎖來引用。
      it('⑦ 全區解鎖時，跨區的燈塔—其他站配對也不會互搶（審查員 2026-10-26 實測 1,326 組全部 0 搶）', () => {
        const lighthouseIndex = stops.findIndex((s) => s.step === 'lesson-intro');
        if (lighthouseIndex < 0) return;
        const lighthouse = stops[lighthouseIndex];
        const fullyUnlockedZone = Math.max(...stops.map((s) => s.zone));
        stops.forEach((other, otherIndex) => {
          if (otherIndex === lighthouseIndex) return;
          if (other.zone === lighthouse.zone) return; // 同區的情況由 ⑤ 鎖，這裡只測跨區
          const dx = lighthouse.x - other.x;
          const dz = lighthouse.z - other.z;
          const dist = Math.hypot(dx, dz) || 1;
          const player = {
            x: other.x + (dx / dist) * MIN_CAMERA_BUILDING_DISTANCE,
            z: other.z + (dz / dist) * MIN_CAMERA_BUILDING_DISTANCE,
          };
          const selected = selectNearestStation(stops, player, fullyUnlockedZone);
          expect(selected, `第 ${id} 課「${title}」：全區解鎖時站在跨區的「${other.name}」門口卻選到別的站（index ${selected}，應為 ${otherIndex}「${other.name}」）`).toBe(otherIndex);
        });
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
