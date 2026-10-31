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
import {
  isNameplateOccluded,
  isRectOutOfBounds,
  shouldShowFullNameplate,
  nameplatePriorityScore,
  resolveNameplateOverlaps,
  type OccluderBox,
  type ScoredNameplateRect,
} from '../createArchipelagoWorld';

/** 數重疊數——驗收標準用的同一把尺，跟 production 用的是同一種矩形相交
 *  判斷，寫在測試檔裡是因為我們只需要「數出有幾對」不需要「決定誰退讓」
 *  （那是 `resolveNameplateOverlaps` 自己的事）。 */
function countOverlappingPairs(rects: readonly { slug: string; rect: ScoredNameplateRect['rect'] }[]): number {
  let count = 0;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i].rect;
      const b = rects[j].rect;
      if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) count++;
    }
  }
  return count;
}

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

  it('🔒 team-lead 2026-10-31 二次審查明確要求：只有「部分」跨出（左緣還在畫布內，只有右緣超出）也要判定超出，不是只抓「整張都在畫布外」的情況', () => {
    // 左緣 950 在畫布內（<1000），只有右緣 1100 超出——這就是「部分跨出」，
    // 跟下一條「整張都在畫布外」是不同的兩種情況，這裡故意把兩者都測到。
    const partiallyOut = { left: 950, right: 1100, top: 100, bottom: 150 };
    expect(partiallyOut.left < canvas.right, '這張卡片的左緣本身還在畫布內，用來確認這確實是部分跨出而不是整張在外').toBe(true);
    expect(isRectOutOfBounds(partiallyOut, canvas)).toBe(true);
  });

  it('整張卡片完全在畫布外（左緣也超出右邊界）→ 判定超出', () => {
    const fullyOut = { left: 1050, right: 1200, top: 100, bottom: 150 };
    expect(fullyOut.left >= canvas.right, '確認這張卡片整張都在畫布外，不是部分跨出').toBe(true);
    expect(isRectOutOfBounds(fullyOut, canvas)).toBe(true);
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

describe('shouldShowFullNameplate — 名牌卡片 vs 狀態色小圓點（PRD §3.2 2026-10-31 team-lead 訂正）', () => {
  it('已佔領——即使不在最近名額內、沒有 hover，仍然常駐顯示課名', () => {
    expect(shouldShowFullNameplate('occupied', false, false)).toBe(true);
  });

  it('探索中（in_progress）——即使不在最近名額內、沒有 hover，仍然常駐顯示課名', () => {
    expect(shouldShowFullNameplate('in_progress', false, false)).toBe(true);
  });

  it('🔒 未開始（not_started）且不在最近名額內、沒有 hover——退化成小圓點（這是真正會被「36 島全常駐擠成一團」卡到的情況，真實 demo 資料測不到這條，因為 demo 帳號幾乎每座島都已經是 in_progress）', () => {
    expect(shouldShowFullNameplate('not_started', false, false)).toBe(false);
  });

  it('未開始但在鏡頭焦點最近名額內——顯示課名', () => {
    expect(shouldShowFullNameplate('not_started', true, false)).toBe(true);
  });

  it('未開始但正在被 hover——顯示課名', () => {
    expect(shouldShowFullNameplate('not_started', false, true)).toBe(true);
  });
});

describe('nameplatePriorityScore — 重疊時誰留下的優先序（team-lead 2026-10-31 二次訂正：「hover > 已佔領 > 鏡頭最近 > 探索中」）', () => {
  it('hover 分數最高，即使同時也是已佔領／最近名額', () => {
    expect(nameplatePriorityScore('occupied', true, true)).toBe(3);
  });

  it('已佔領（沒被 hover）分數次高，即使不在最近名額內', () => {
    expect(nameplatePriorityScore('occupied', false, false)).toBe(2);
  });

  it('在最近名額內（非已佔領、沒被 hover）分數第三', () => {
    expect(nameplatePriorityScore('in_progress', true, false)).toBe(1);
  });

  it('只是探索中，不在最近名額、沒被 hover——分數墊底', () => {
    expect(nameplatePriorityScore('in_progress', false, false)).toBe(0);
  });

  it('🔒 嚴格分級不是加總：已佔領+最近名額 分數仍然是 2（已佔領那一級），不會因為同時符合兩個條件而疊加超過 hover 的 3', () => {
    expect(nameplatePriorityScore('occupied', true, false)).toBe(2);
  });
});

describe('resolveNameplateOverlaps — 貪婪演算法保證重疊數為 0（team-lead 2026-10-31 退回重做明確要求）', () => {
  it('完全不重疊的矩形——全部保留，沒有任何一個被退化', () => {
    const candidates: ScoredNameplateRect[] = [
      { slug: 'a', rect: { left: 0, right: 100, top: 0, bottom: 50 }, score: 1 },
      { slug: 'b', rect: { left: 200, right: 300, top: 0, bottom: 50 }, score: 1 },
    ];
    const demoted = resolveNameplateOverlaps(candidates);
    expect(demoted.size).toBe(0);
  });

  it('兩個重疊，分數低的那個被退化成圓點', () => {
    const candidates: ScoredNameplateRect[] = [
      { slug: 'low', rect: { left: 0, right: 100, top: 0, bottom: 50 }, score: 1 },
      { slug: 'high', rect: { left: 50, right: 150, top: 0, bottom: 50 }, score: 5 },
    ];
    const demoted = resolveNameplateOverlaps(candidates);
    expect(demoted.has('low')).toBe(true);
    expect(demoted.has('high')).toBe(false);
  });

  it('🔒 team-lead 明確要求的案例：三張彼此相交的矩形（A-B 重疊、B-C 重疊、A-C 不重疊），分數 A>B>C——解完之後重疊數必須是 0', () => {
    // A 在最左、C 在最右，中間的 B 跟兩邊都重疊，但 A 跟 C 本身距離夠遠不重疊
    // ——這正是「逐對比較、比到的那一對裡較遠的退讓」舊寫法會算錯的案例：
    // 如果照陣列順序先比 (A,B) 退 B、再比 (A,C) 沒事、最後比 (B,C) 因為 B
    // 已經退過而跳過，結果看起來正確；但如果分數反過來（C>B>A）同一組矩形
    // 舊寫法會在 (B,C) 那一步才退 B，(A,B) 卻已經在更早的步驟因為「比較到
    // 的那一對裡較遠的」退了 A，兩個條件同時退會導致 kept 集合裡只剩 C，
    // 不是「保留分數最高的，demote 最少的」。這裡只驗收重疊數為 0，不比較
    // 哪個實作留下誰——0 重疊是明確的驗收標準。
    const candidates: ScoredNameplateRect[] = [
      { slug: 'A', rect: { left: 0, right: 100, top: 0, bottom: 50 }, score: 3 },
      { slug: 'B', rect: { left: 60, right: 160, top: 0, bottom: 50 }, score: 2 },
      { slug: 'C', rect: { left: 120, right: 220, top: 0, bottom: 50 }, score: 1 },
    ];
    // 先確認合成資料真的符合「A-B 重疊、B-C 重疊、A-C 不重疊」的前提，
    // 不然這條測試量不到想驗的東西。
    expect(countOverlappingPairs(candidates)).toBe(2); // A-B 跟 B-C，A-C 不算

    const demoted = resolveNameplateOverlaps(candidates);
    const remaining = candidates.filter((c) => !demoted.has(c.slug));
    expect(countOverlappingPairs(remaining), '解完之後剩下的矩形彼此不該再有任何重疊').toBe(0);
    // 分數最高的 A 一定要保留（貪婪法從最高分開始，第一個絕對不會被退化）。
    expect(demoted.has('A')).toBe(false);
  });

  it('🔒 反向分數的同一組矩形（C>B>A）——重疊數一樣要是 0，且分數最高的 C 一定保留', () => {
    const candidates: ScoredNameplateRect[] = [
      { slug: 'A', rect: { left: 0, right: 100, top: 0, bottom: 50 }, score: 1 },
      { slug: 'B', rect: { left: 60, right: 160, top: 0, bottom: 50 }, score: 2 },
      { slug: 'C', rect: { left: 120, right: 220, top: 0, bottom: 50 }, score: 3 },
    ];
    const demoted = resolveNameplateOverlaps(candidates);
    const remaining = candidates.filter((c) => !demoted.has(c.slug));
    expect(countOverlappingPairs(remaining)).toBe(0);
    expect(demoted.has('C')).toBe(false);
  });

  it('四張排成一列、每一張都跟左右相鄰的重疊（鏈狀重疊）——重疊數解完也要是 0', () => {
    const candidates: ScoredNameplateRect[] = [
      { slug: 'w', rect: { left: 0, right: 100, top: 0, bottom: 50 }, score: 4 },
      { slug: 'x', rect: { left: 60, right: 160, top: 0, bottom: 50 }, score: 3 },
      { slug: 'y', rect: { left: 120, right: 220, top: 0, bottom: 50 }, score: 2 },
      { slug: 'z', rect: { left: 180, right: 280, top: 0, bottom: 50 }, score: 1 },
    ];
    const demoted = resolveNameplateOverlaps(candidates);
    const remaining = candidates.filter((c) => !demoted.has(c.slug));
    expect(countOverlappingPairs(remaining)).toBe(0);
  });
});
