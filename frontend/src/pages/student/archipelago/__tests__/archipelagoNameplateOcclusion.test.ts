/**
 * archipelagoNameplateOcclusion.test.ts — #3780 team-lead 2026-10-31 訂正：
 * 名牌遮擋判斷改用合成資料直接驗證，不要在真實佈局裡旋轉鏡頭碰運氣找一個
 * 剛好被擋住的角度（實測：20 島群試了 10 種角度，重疊淡化每次都有觸發，
 * 但遮擋隱藏一次都沒出現——不代表機制沒用，只是沒測到，用合成資料才能
 * 直接證明這支函式本身是對的）。
 *
 * 兩條核心案例：
 *   ① 一個夠高的方塊剛好擋在「相機→名牌錨點」的連線中間 → 應該回傳遮擋
 *   ② 同樣的方塊搬到連線旁邊（不擋路）→ 應該回傳沒有遮擋
 */
import { describe, it, expect } from 'vitest';
import { isNameplateOccluded, isRectOutOfBounds, type OccluderBox } from '../createArchipelagoWorld';

describe('isNameplateOccluded — 純函式，吃包圍盒不吃 Raycaster/Scene', () => {
  const cameraPos = { x: 0, y: 5, z: 10 };
  const labelAnchor = { x: 0, y: 2, z: -10 }; // 名牌錨點在相機正前方、比相機低

  it('① 一個夠高的方塊剛好擋在連線中間 → 判定遮擋', () => {
    // 連線中點約在 (0, 3.5, 0) 附近——方塊涵蓋這個中點，且比相機/名牌之間
    // 連線在該處的高度更厚，確保一定相交。
    const blockingBox: OccluderBox = {
      slug: 'other-island',
      min: { x: -1, y: 0, z: -1 },
      max: { x: 1, y: 8, z: 1 },
    };
    const occluded = isNameplateOccluded(cameraPos, labelAnchor, 'this-island', [blockingBox]);
    expect(occluded).toBe(true);
  });

  it('② 同樣的方塊搬到連線旁邊（不擋路）→ 判定沒有遮擋', () => {
    const sideBox: OccluderBox = {
      slug: 'other-island',
      min: { x: 20, y: 0, z: -1 }, // 遠離 x=0 的連線路徑
      max: { x: 22, y: 8, z: 1 },
    };
    const occluded = isNameplateOccluded(cameraPos, labelAnchor, 'this-island', [sideBox]);
    expect(occluded).toBe(false);
  });

  it('同一座島自己的包圍盒不算遮擋（島不會擋自己的名牌）', () => {
    const ownBox: OccluderBox = {
      slug: 'this-island', // 跟 ownSlug 相同
      min: { x: -1, y: 0, z: -1 },
      max: { x: 1, y: 8, z: 1 },
    };
    const occluded = isNameplateOccluded(cameraPos, labelAnchor, 'this-island', [ownBox]);
    expect(occluded).toBe(false);
  });

  it('🔒 正向對照：真的有遮擋物時，若不給任何 occluder，必須回傳沒有遮擋（證明預設不是恆真）', () => {
    const occluded = isNameplateOccluded(cameraPos, labelAnchor, 'this-island', []);
    expect(occluded).toBe(false);
  });

  it('遮擋物在名牌「後面」（比名牌更遠）不算遮擋——只看相機到名牌之間', () => {
    const behindBox: OccluderBox = {
      slug: 'other-island',
      min: { x: -1, y: 0, z: -30 }, // z=-30，比 labelAnchor 的 z=-10 更遠
      max: { x: 1, y: 8, z: -28 },
    };
    const occluded = isNameplateOccluded(cameraPos, labelAnchor, 'this-island', [behindBox]);
    expect(occluded).toBe(false);
  });

  it('相機跟名牌錨點重合時必須回傳沒有遮擋（避免除以零/方向向量長度 0）', () => {
    const samePoint = { x: 3, y: 3, z: 3 };
    const occluded = isNameplateOccluded(samePoint, samePoint, 'this-island', [
      { slug: 'other-island', min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
    ]);
    expect(occluded).toBe(false);
  });
});

describe('isRectOutOfBounds — 名牌卡片超出畫布邊界判斷（team-lead 2026-10-31 審查發現）', () => {
  const canvas = { left: 0, right: 1000, top: 0, bottom: 800 };

  it('完全在畫布內的卡片 → 沒有超出', () => {
    expect(isRectOutOfBounds({ left: 100, right: 300, top: 100, bottom: 150 }, canvas)).toBe(false);
  });

  it('卡片右緣超出畫布右邊界 → 判定超出', () => {
    expect(isRectOutOfBounds({ left: 950, right: 1100, top: 100, bottom: 150 }, canvas)).toBe(true);
  });

  it('卡片左緣超出畫布左邊界（負座標）→ 判定超出', () => {
    expect(isRectOutOfBounds({ left: -50, right: 100, top: 100, bottom: 150 }, canvas)).toBe(true);
  });

  it('卡片上緣超出畫布上邊界 → 判定超出', () => {
    expect(isRectOutOfBounds({ left: 100, right: 300, top: -20, bottom: 150 }, canvas)).toBe(true);
  });

  it('卡片下緣超出畫布下邊界 → 判定超出', () => {
    expect(isRectOutOfBounds({ left: 100, right: 300, top: 700, bottom: 850 }, canvas)).toBe(true);
  });

  it('卡片剛好貼齊邊界（不超過）→ 沒有超出，邊界情況不誤判', () => {
    expect(isRectOutOfBounds({ left: 0, right: 1000, top: 0, bottom: 800 }, canvas)).toBe(false);
  });
});
