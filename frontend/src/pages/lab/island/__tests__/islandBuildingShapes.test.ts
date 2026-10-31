import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildStationGroup, applyBuildingGlow, disposeObjectTree, buildingTopY, ALL_STATION_STEP_TYPES } from '../islandBuildingShapes';
import { resolveCelebrationGlow, celebrationGlowBoost, CELEBRATION_PROFILES } from '../islandCelebration';

/**
 * #3780 P0-3 四度審查訂正：鎖住「慶祝/已完成時，整棟建築真的有東西會
 * 變亮」——不是只測 `applyBuildingGlow` 這個純函式本身邏輯對不對，是
 * 直接呼叫**真正的建造程式** `buildStationGroup()`（跟 `createIslandWorld.ts`
 * 用的是同一支），對 15 種真實存在過的 step type 各建一棟，數它實際蒐集
 * 到的材質陣列——這樣才鎖得住「退回只追蹤單一 windowMat」這個舊 bug：
 * 舊寫法底下，15 種裡有 13 種的 `materials` 陣列會是空的（或完全不會被
 * 慶祝邏輯摸到），這條測試在那個退回版本下必須變紅。
 */
const sandBase = () => new THREE.MeshStandardMaterial({ color: 0xd9c397 });

describe('buildStationGroup — 真實建造程式的材質蒐集', () => {
  it('15 種 step type 全部蒐集到至少一塊可發光材質', () => {
    ALL_STATION_STEP_TYPES.forEach((step) => {
      const built = buildStationGroup({ name: `測試-${step}`, step }, sandBase());
      expect(built.materials.length, `step=${step} 應該蒐集到至少一塊材質`).toBeGreaterThan(0);
    });
  });

  it.each(ALL_STATION_STEP_TYPES)('%s：套用慶祝發光後，至少一塊材質真的變亮', (step) => {
    const built = buildStationGroup({ name: `測試-${step}`, step }, sandBase());
    const profile = CELEBRATION_PROFILES.heavy;
    // 用真正的分級發光強度（跟 createIslandWorld.ts 的 per-frame 迴圈同一條
    // 算式），不是隨便塞一個數字——elapsed 取 0 讓 sin 項歸零，拿到穩定值。
    const intensity = celebrationGlowBoost(profile, 0);
    applyBuildingGlow(built.materials, resolveCelebrationGlow(intensity));
    const lit = built.materials.some(
      (slot) => slot.material.emissiveIntensity > 0 && slot.material.emissive.getHex() !== 0x000000,
    );
    expect(lit, `step=${step} 慶祝發光後應該有材質的 emissive 被實際設定`).toBe(true);
  });

  it('建築類型固定清單涵蓋 islandCelebration 的分級表（避免兩邊的清單漂移）', async () => {
    const { STATION_CELEBRATION_TIER } = await import('../islandCelebration');
    const tierKeys = Object.keys(STATION_CELEBRATION_TIER).sort();
    expect([...ALL_STATION_STEP_TYPES].sort()).toEqual(tierKeys);
  });
});

describe('applyBuildingGlow — 不發光時還原各自的建造基準，不是硬壓成黑', () => {
  it('full-text-annotate 的 gold 裝飾材質本來就有 0.12 常態微光，不發光時要維持住，不能被壓黑', () => {
    const built = buildStationGroup({ name: '測試', step: 'full-text-annotate' }, sandBase());
    // 建造剛完成、還沒套用任何發光判斷——此時材質就是它建造時的樣子，
    // 直接找「原本就有非零 emissiveIntensity」的那一塊（= gold 裝飾材質），
    // 不靠猜索引。
    const decorative = built.materials.find((slot) => slot.baseEmissiveIntensity > 0);
    expect(decorative, 'full-text-annotate 應該有一塊材質建造時就帶著非零的裝飾性 emissive').toBeTruthy();
    const baseHex = decorative!.baseEmissiveHex;
    const baseIntensity = decorative!.baseEmissiveIntensity;

    // 先讓它進入發光狀態（模擬這一站完成/慶祝中）……
    applyBuildingGlow(built.materials, resolveCelebrationGlow(6.5));
    expect(decorative!.material.emissiveIntensity).toBeCloseTo(6.5);

    // ……再還原（intensity<=0 代表這一刻不該被完成/慶祝邏輯影響）——應該
    // 回到它自己建造時的基準，不是變成全黑的 0。
    applyBuildingGlow(built.materials, resolveCelebrationGlow(0));
    expect(decorative!.material.emissive.getHex()).toBe(baseHex);
    expect(decorative!.material.emissiveIntensity).toBeCloseTo(baseIntensity);
    expect(baseIntensity).toBeGreaterThan(0); // 確認真的驗到了裝飾材質，不是驗到預設黑的那些
  });

  it('lesson-intro 的 windowMat 建造時 intensity 是 0，不發光時應該還原成 0（不是意外殘留上一次的亮度）', () => {
    const built = buildStationGroup({ name: '港口燈塔', step: 'lesson-intro' }, sandBase());
    applyBuildingGlow(built.materials, resolveCelebrationGlow(6.5));
    applyBuildingGlow(built.materials, resolveCelebrationGlow(0));
    const allDark = built.materials.every((slot) => slot.material.emissiveIntensity === slot.baseEmissiveIntensity);
    expect(allDark).toBe(true);
  });
});

/**
 * #3780 P0-3 四度審查訂正（review follow-up）：整棟建築改成每塊網格各自
 * clone 材質之後，一個 12-16 站的 session 會建立約 115-150 個獨立
 * `THREE.MeshStandardMaterial`——`createIslandWorld.ts` 的 `dispose()`
 * 原本只清 geometry（Mesh）跟貼圖（Sprite），材質本身從沒釋放過。這條鎖
 * 不是測「有沒有呼叫 dispose 方法」這種同義反覆，是對**真實建造程式**
 * 產出的 group（`buildStationGroup('full-text-annotate', …)`，17 塊材質）
 * 逐一 spy 每塊材質的 `dispose`，呼叫 `disposeObjectTree()` 之後斷言
 * 每一塊都剛好被呼叫一次——退回「拿掉材質 dispose 那行」要紅。
 */
describe('disposeObjectTree — 離開島頁要釋放每一塊 clone 出來的材質', () => {
  it('對真實建造的建築（full-text-annotate，17 塊材質）：每塊材質的 dispose 都剛好被呼叫一次', () => {
    const built = buildStationGroup({ name: '測試', step: 'full-text-annotate' }, sandBase());
    expect(built.materials.length, '這個 step 應該蒐集到多塊材質才有鎖的意義').toBeGreaterThan(1);

    const materialSpies = built.materials.map((slot) => vi.spyOn(slot.material, 'dispose'));
    const geometrySpies: ReturnType<typeof vi.spyOn>[] = [];
    built.root.traverse((object) => {
      if (object instanceof THREE.Mesh) geometrySpies.push(vi.spyOn(object.geometry, 'dispose'));
    });

    disposeObjectTree(built.root);

    materialSpies.forEach((spy, i) => {
      expect(spy, `第 ${i} 塊材質應該被 dispose 剛好一次`).toHaveBeenCalledTimes(1);
    });
    geometrySpies.forEach((spy, i) => {
      expect(spy, `第 ${i} 個 mesh 的 geometry 應該被 dispose 剛好一次`).toHaveBeenCalledTimes(1);
    });
  });

  it('材質陣列（單一 mesh 掛多塊材質）跟 sprite（含貼圖）都要各自被 dispose 一次', () => {
    const group = new THREE.Group();
    const matA = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const matB = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [matA, matB]);
    group.add(mesh);

    const texture = new THREE.Texture();
    const spriteMat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMat);
    group.add(sprite);

    const matASpy = vi.spyOn(matA, 'dispose');
    const matBSpy = vi.spyOn(matB, 'dispose');
    const geoSpy = vi.spyOn(mesh.geometry, 'dispose');
    const textureSpy = vi.spyOn(texture, 'dispose');
    const spriteMatSpy = vi.spyOn(spriteMat, 'dispose');

    disposeObjectTree(group);

    expect(matASpy, '陣列材質的第一塊應該被 dispose').toHaveBeenCalledTimes(1);
    expect(matBSpy, '陣列材質的第二塊應該被 dispose').toHaveBeenCalledTimes(1);
    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect(textureSpy, 'sprite 的貼圖應該被 dispose').toHaveBeenCalledTimes(1);
    expect(spriteMatSpy, 'sprite 的材質本身應該被 dispose').toHaveBeenCalledTimes(1);
  });
});

/**
 * #3780 P0-3 八度審查訂正：`spawnPoint.ts` 的 `isLabelOccluded`（鏡頭→
 * 名牌遮擋判斷）需要每種建築型態的真實頂端高度，用真正建出來的
 * `THREE.Box3` 量，不是手 key 一份可能跟真實幾何漂移的數字表。
 */
describe('buildingTopY — 用真實幾何量出來的建築頂端高度', () => {
  it('每種型態的高度都是正常範圍內的正數（不是 0、NaN、或離譜的巨大值）', () => {
    ALL_STATION_STEP_TYPES.forEach((step) => {
      const topY = buildingTopY(step);
      expect(topY, `step=${step} 應該是正數`).toBeGreaterThan(0);
      expect(topY, `step=${step} 高度不該離譜（> 15 代表量錯了，可能把光束這種特效也算進去）`).toBeLessThan(15);
    });
  });

  it('港口燈塔（lesson-intro）應該是全島最高的建築型態——跟 ARC_FLIGHT_PEAK_HEIGHT/LIGHTHOUSE_ROOF_TOP_Y 的既有假設一致', () => {
    const lighthouseTopY = buildingTopY('lesson-intro');
    ALL_STATION_STEP_TYPES.forEach((step) => {
      if (step === 'lesson-intro') return;
      expect(lighthouseTopY, `lesson-intro 應該比 ${step} 高`).toBeGreaterThan(buildingTopY(step));
    });
  });

  it('同一個型態呼叫兩次要回傳一樣的值（有快取，不是每次重算出不同的浮點誤差）', () => {
    expect(buildingTopY('full-text-annotate')).toBe(buildingTopY('full-text-annotate'));
  });
});
