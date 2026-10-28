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
  findCelebrationViewpoint,
  findTravelToDestination,
  arcFlightPosition,
  arcFlightArrivalYaw,
  ARC_FLIGHT_PEAK_HEIGHT,
  CAMERA_VERTICAL_FOV_DEG,
  LIGHTHOUSE_ROOF_TOP_Y,
  LIGHTHOUSE_TOWER_BASE_Y,
  LIGHTHOUSE_TOWER_RADIUS,
  MAX_TOWER_WIDTH_FRACTION,
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

/** 山丘最高的那一座頂點世界座標 Y——跟 `createIslandWorld.ts` 蓋山丘那段
 * 同一個公式（`ConeGeometry(r, 2.3 + i%3, 10)` 擺在 local y=1.25，頂點 =
 * 1.25 + 高度/2），從真實 `hillPositions` 陣列算出來，不是猜的；遠比
 * `LIGHTHOUSE_ROOF_TOP_Y`（全島最高建築）矮，⑩ 檢查「飛行途中經過山丘
 * 上方」時用這個當門檻，不能沿用建築的門檻——那樣會在飛行還沒爬升到
 * 「比最高建築還高」、但其實早就高過山丘的那段路程裡製造假警報。 */
const MAX_HILL_APEX_Y = Math.max(...hillPositions.map((_, i) => 1.25 + (2.3 + (i % 3)) / 2));

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

      it('②-2 直式手機螢幕（390×844）出生時：塔底到塔尖仍落在垂直視野內、塔身寬度不超過畫面六成、出生點仍然合法——#3780 P0-3 九度審查訂正', () => {
        const PORTRAIT_ASPECT = 390 / 844;
        const lighthouse = stops.find((s) => s.step === 'lesson-intro') ?? stops[0];
        const spawn = computeSpawnFacingLighthouse(lighthouse, undefined, PORTRAIT_ASPECT);
        const distance = Math.hypot(spawn.x - lighthouse.x, spawn.z - lighthouse.z);

        // 垂直框架：寬高比窄不影響垂直 FOV，這條理論上本來就該過，這裡
        // 用真的算式重新驗證，不是只信理論。
        expect(isHeightFullyInView({
          distance,
          pitchRad: spawn.pitch,
          topY: LIGHTHOUSE_ROOF_TOP_Y,
          baseY: LIGHTHOUSE_TOWER_BASE_Y,
        }), '直式螢幕下塔底到塔尖仍要整個落在視野內').toBe(true);
        expect(isBaseInLowerHalf({
          distance,
          pitchRad: spawn.pitch,
          baseY: LIGHTHOUSE_TOWER_BASE_Y,
        }), '直式螢幕下塔底仍要落在視野中心以下').toBe(true);

        // 水平框架：這才是這批真正修的東西——獨立重新算一次水平 FOV 跟塔身
        // 佔比，不直接引用 `requiredDistanceForTowerWidthInView`（否則等於
        // 拿同一條算式驗自己，測不出東西）。
        const vFovRad = (CAMERA_VERTICAL_FOV_DEG * Math.PI) / 180;
        const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * PORTRAIT_ASPECT);
        const frameHalfWidthAtDistance = distance * Math.tan(hFovRad / 2);
        const towerWidthFraction = (LIGHTHOUSE_TOWER_RADIUS * 2) / (frameHalfWidthAtDistance * 2);
        expect(towerWidthFraction, `第 ${id} 課「${title}」：直式螢幕下塔身寬度佔畫面 ${(towerWidthFraction * 100).toFixed(1)}%，超過六成上限`).toBeLessThanOrEqual(MAX_TOWER_WIDTH_FRACTION);

        // 拉遠距離改變了出生點座標，碰撞/可行走這幾件事要在新座標上重驗
        // 一次，不能只信「原本的距離 7 驗過了」。
        expect(isWalkableAtSpawn(spawn.x, spawn.z), '直式螢幕下出生點仍要在可行走範圍內').toBe(true);
        for (const stop of stops) {
          const d = Math.hypot(spawn.x - stop.x, spawn.z - stop.z);
          expect(d, `直式螢幕下出生點不能卡進「${stop.name}」的碰撞圈`).toBeGreaterThanOrEqual(MIN_CAMERA_BUILDING_DISTANCE);
        }
        expect(isInsideAnyHill(spawn.x, spawn.z), '直式螢幕下出生點不能卡進任何山丘的碰撞圈').toBe(false);
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

      it('⑧ 慶祝時每一站都找得到一個合法觀景點（不穿進任何其他建築/山丘/出界，視線也沒被第三棟建築擋住）——#3780 三度審查訂正，鎖住「沿玩家→建築直線推」那個真實 bug（17.5% 穿牆／9.4% 穿山丘）', () => {
        // 玩家位置用出生點代表「從島上某處用清單模式直接開站、沒有真的走
        // 過去」這個真實觸發場景——原本的 bug 正是在這種「玩家離建築很遠」
        // 的情況下才會讓直線穿過別的東西。
        const lighthouseForSpawn = stops.find((s) => s.step === 'lesson-intro') ?? stops[0];
        const player = computeSpawnFacingLighthouse(lighthouseForSpawn);
        stops.forEach((target, targetIndex) => {
          const otherBuildings = stops.filter((_, i) => i !== targetIndex).map((s) => ({ x: s.x, z: s.z }));
          const zoneCenter = zoneCenters[target.zone];
          const viewpoint = findCelebrationViewpoint({
            target: { x: target.x, z: target.z },
            player: { x: player.x, z: player.z },
            otherBuildings,
            hills: hillPositions,
            zoneCenter,
          });
          expect(viewpoint, `第 ${id} 課「${title}」：「${target.name}」找不到任何合法觀景點`).not.toBeNull();
          if (!viewpoint) return;

          for (const other of otherBuildings) {
            const d = Math.hypot(viewpoint.x - other.x, viewpoint.z - other.z);
            expect(d, `第 ${id} 課「${title}」：「${target.name}」的觀景點穿進了別的建築`).toBeGreaterThanOrEqual(MIN_CAMERA_BUILDING_DISTANCE);
          }
          expect(isInsideAnyHill(viewpoint.x, viewpoint.z), `第 ${id} 課「${title}」：「${target.name}」的觀景點穿進了山丘碰撞圈`).toBe(false);
          const withinIsland = Math.hypot(viewpoint.x - zoneCenter.x, viewpoint.z - zoneCenter.z) < zoneCenter.radius - 1;
          expect(withinIsland, `第 ${id} 課「${title}」：「${target.name}」的觀景點超出島嶼範圍`).toBe(true);
        });
      });

      it('⑨ travelTo（清單模式／點擊建築直接前往）每一組「從某站出發、前往另一站」都找得到合法終點——#3780 P0-3 五度審查訂正，鎖住「沿玩家目前位置→建築直線走、固定距離停」那個真實 bug（真瀏覽器截圖抓到鏡頭卡進柱子之間、屋頂懸在頭頂）', () => {
        // 跟 ⑧ 不同：⑧ 只測「玩家在出生點」這一個情境；這裡要測的是
        // travelTo 的真實使用情境——玩家可能人在島上任何一站，因為點了別
        // 的建築或切清單模式「前往」才觸發，所以用「每一站當出發點」×
        // 「每一站當目標」做完整 N×N 掃描，不是只測一個固定的玩家位置。
        stops.forEach((playerStop, playerIndex) => {
          stops.forEach((target, targetIndex) => {
            if (playerIndex === targetIndex) return;
            const otherBuildings = stops.filter((_, i) => i !== targetIndex).map((s) => ({ x: s.x, z: s.z }));
            const zoneCenter = zoneCenters[target.zone];
            const destination = findTravelToDestination({
              target: { x: target.x, z: target.z },
              player: { x: playerStop.x, z: playerStop.z },
              otherBuildings,
              hills: hillPositions,
              zoneCenter,
            });
            expect(destination, `第 ${id} 課「${title}」：從「${playerStop.name}」前往「${target.name}」找不到合法終點`).not.toBeNull();
            if (!destination) return;

            for (const other of otherBuildings) {
              const d = Math.hypot(destination.x - other.x, destination.z - other.z);
              expect(d, `第 ${id} 課「${title}」：前往「${target.name}」的終點撞進了別的建築`).toBeGreaterThanOrEqual(MIN_CAMERA_BUILDING_DISTANCE);
            }
            expect(isInsideAnyHill(destination.x, destination.z), `第 ${id} 課「${title}」：前往「${target.name}」的終點撞進了山丘碰撞圈`).toBe(false);
            const withinIsland = Math.hypot(destination.x - zoneCenter.x, destination.z - zoneCenter.z) < zoneCenter.radius - 1;
            expect(withinIsland, `第 ${id} 課「${title}」：前往「${target.name}」的終點超出島嶼範圍`).toBe(true);
          });
        });
      });

      it('⑩ 三段式飛行——垂直升/降段水平座標完全釘在合法端點，水平巡航段全程在峰值高度——#3780 P0-3 七度審查訂正，取代「斜線爬升/下降」那版（真實幾何量到 41 處終點旁第三棟建築被擦到）', () => {
        // 跟 ⑨ 不同：⑨ 只驗終點合不合法，這裡要驗「飛過去的沿途」每一刻
        // 的位置到底對不對。跟上一版（斜線拱形）不同的地方：不用再排除
        // 「終點旁邊的建築」——升/降段水平座標完全不變（釘死在 start／
        // destination，兩個都已經由 ⑨ 證明過地面合法），不可能撞進任何
        // 東西；巡航段全程在 `ARC_FLIGHT_PEAK_HEIGHT`（比全島最高建築還高，
        // 見下面的一次性斷言），不用逐點對照建築/山丘座標。
        stops.forEach((playerStop, playerIndex) => {
          stops.forEach((target, targetIndex) => {
            if (playerIndex === targetIndex) return;
            const otherBuildings = stops.filter((_, i) => i !== targetIndex).map((s) => ({ x: s.x, z: s.z }));
            const zoneCenter = zoneCenters[target.zone];
            const destination = findTravelToDestination({
              target: { x: target.x, z: target.z },
              player: { x: playerStop.x, z: playerStop.z },
              otherBuildings,
              hills: hillPositions,
              zoneCenter,
            });
            if (!destination) return; // ⑨ 已經鎖過「找不到終點」這件事本身，這裡只關心找得到時的路徑

            const start = { x: playerStop.x, z: playerStop.z };
            for (let s = 0; s <= 20; s++) {
              const progress = s / 20;
              const pos = arcFlightPosition(start, destination, progress);
              const label = `第 ${id} 課「${title}」：從「${playerStop.name}」飛往「${target.name}」，進度 ${progress.toFixed(2)}（${pos.phase}）`;

              if (pos.phase === 'ascend') {
                expect(pos.x, `${label}：升段水平座標 x 應該釘在出發點`).toBe(start.x);
                expect(pos.z, `${label}：升段水平座標 z 應該釘在出發點`).toBe(start.z);
              } else if (pos.phase === 'descend') {
                expect(pos.x, `${label}：降段水平座標 x 應該釘在終點`).toBe(destination.x);
                expect(pos.z, `${label}：降段水平座標 z 應該釘在終點`).toBe(destination.z);
              } else {
                expect(pos.extraHeight, `${label}：巡航段應該全程在峰值高度`).toBe(ARC_FLIGHT_PEAK_HEIGHT);
              }
            }
          });
        });
      });

      it('⑩-2 巡航高度本身確實高於全島最高建築／最高山丘（一次性斷言，不是每課都要重算這個常數關係）', () => {
        expect(ARC_FLIGHT_PEAK_HEIGHT, '巡航高度應該高於全島最高建築（燈塔塔尖）').toBeGreaterThan(LIGHTHOUSE_ROOF_TOP_Y);
        expect(ARC_FLIGHT_PEAK_HEIGHT, '巡航高度應該高於全島最高山丘').toBeGreaterThan(MAX_HILL_APEX_Y);
      });

      it('⑪ 拱形飛行抵達時鏡頭朝向正確面向目標建築（夾角 < 5°）——#3780 P0-3 六度審查訂正，鎖住「抵達朝向沒處理，平均差 32°、10.5% 背對超過 90°」那個真實 bug', () => {
        stops.forEach((playerStop, playerIndex) => {
          stops.forEach((target, targetIndex) => {
            if (playerIndex === targetIndex) return;
            const otherBuildings = stops.filter((_, i) => i !== targetIndex).map((s) => ({ x: s.x, z: s.z }));
            const destination = findTravelToDestination({
              target: { x: target.x, z: target.z },
              player: { x: playerStop.x, z: playerStop.z },
              otherBuildings,
              hills: hillPositions,
              zoneCenter: zoneCenters[target.zone],
            });
            if (!destination) return;

            const yaw = arcFlightArrivalYaw(destination, { x: target.x, z: target.z });
            // 跟 createIslandWorld.ts 實際算鏡頭方向用的同一條公式（見
            // animate() 裡 `forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))`）
            // 獨立換算一次，不是直接複述 arcFlightArrivalYaw 內部用的
            // atan2 算式本身——這樣才驗得到「這個 yaw 套進相機方向公式
            // 之後，實際指向的方向真的對準建築」，不是同義反覆。
            const forwardX = -Math.sin(yaw);
            const forwardZ = -Math.cos(yaw);
            const toTargetX = target.x - destination.x;
            const toTargetZ = target.z - destination.z;
            const toTargetLen = Math.hypot(toTargetX, toTargetZ) || 1;
            const dot = (forwardX * toTargetX + forwardZ * toTargetZ) / toTargetLen; // forward 已經是單位向量
            const angleDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
            expect(angleDeg, `第 ${id} 課「${title}」：從「${playerStop.name}」飛往「${target.name}」，抵達朝向跟建築方向夾角 ${angleDeg.toFixed(1)}°`).toBeLessThan(5);
          });
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
