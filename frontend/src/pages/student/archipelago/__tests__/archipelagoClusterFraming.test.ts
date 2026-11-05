/**
 * archipelagoClusterFraming.test.ts — #3780 team-lead 2026-10-31 明令：
 * 「開場鏡頭要能框住整群，傳送門廣場放在畫面正中央，不要像現在只截到
 * 一角」。根因：鏡頭一直 `lookAt` 寫死的世界原點 (0,0,0)，但廣場的真實
 * 質心常常不在原點上（`layoutArchipelago()` 的廣場格子從 (0,0) 往外長
 * 3 格，長出來的形狀不對稱時質心會偏——實測一個 20 島群廣場中心量到
 * `(-1,0)`）。`computeClusterBoundingCircle` 抽成純函式，直接用合成座標
 * 驗證「鏡頭該看哪裡、半徑該多大」算得對不對。
 */
import { describe, it, expect } from 'vitest';
import { computeClusterBoundingCircle } from '../createArchipelagoWorld';

describe('computeClusterBoundingCircle — 純函式，吃一組 2D 位置', () => {
  it('對稱分布在原點四周時，圓心就是原點', () => {
    const positions = [
      { x: -5, z: 0 },
      { x: 5, z: 0 },
      { x: 0, z: -5 },
      { x: 0, z: 5 },
    ];
    const circle = computeClusterBoundingCircle(positions);
    expect(circle.center.x).toBeCloseTo(0, 5);
    expect(circle.center.z).toBeCloseTo(0, 5);
    expect(circle.radius).toBeCloseTo(5, 5);
  });

  it('🔒 偏向一側分布時，圓心要跟著偏移，不能死守原點（這是這次要修的根因——重現實測過的「廣場在 (-1,0)」那種不對稱分布）', () => {
    // 模擬一個 20 島群常見的不對稱分布：大部分島落在 x 負側
    const positions = [
      { x: -6.75, z: 0 },
      { x: -4, z: 2 },
      { x: -4, z: -2 },
      { x: 6, z: 0 },
    ];
    const circle = computeClusterBoundingCircle(positions);
    // bbox 中心 = ((-6.75+6)/2, (−2+2)/2) = (-0.375, 0)——明顯不是原點
    expect(circle.center.x).toBeCloseTo(-0.375, 5);
    expect(circle.center.x).not.toBeCloseTo(0, 1);
  });

  it('半徑是「離圓心最遠的點」的距離，不是離原點最遠的點（兩者在不對稱分布下不相等）', () => {
    const positions = [
      { x: -10, z: 0 },
      { x: 0, z: 0 },
    ];
    const circle = computeClusterBoundingCircle(positions);
    // bbox 中心 = (-5, 0)，兩點到圓心都是 5
    expect(circle.center.x).toBeCloseTo(-5, 5);
    expect(circle.radius).toBeCloseTo(5, 5);
    // 對照：離原點最遠的點是 10，不是這支函式該回傳的半徑
    expect(circle.radius).not.toBeCloseTo(10, 1);
  });

  it('單一位置：半徑保底為 1（避免除以零/鏡頭距離變成 0）', () => {
    const circle = computeClusterBoundingCircle([{ x: 3, z: 3 }]);
    expect(circle.center).toEqual({ x: 3, y: 0, z: 3 });
    expect(circle.radius).toBeGreaterThanOrEqual(1);
  });

  it('空陣列不拋錯，回傳一個保底值（fail-safe，不應該發生但不能讓整個鏡頭初始化掛掉）', () => {
    const circle = computeClusterBoundingCircle([]);
    expect(circle.center).toEqual({ x: 0, y: 0, z: 0 });
    expect(circle.radius).toBeGreaterThanOrEqual(1);
  });

  it('🔒 team-lead 2026-10-31 明令「傳送門廣場距畫面中心 ≤10%」：傳 forceCenter（廣場位置）時，圓心必須剛好等於那個點，不是 bbox 中心——這樣鏡頭 lookAt 這個圓心時，廣場的螢幕投影恆為畫面正中央（0% 偏移，不是「算出來剛好很小」）', () => {
    // 重現實測過的真實案例：20 島群廣場在 (-1,0)，bbox 中心卻是 (-0.375,0)
    // ——不傳 forceCenter 時兩者不相等（上面測過），傳了就該完全等於廣場。
    const positions = [
      { x: -6.75, z: 0 },
      { x: -4, z: 2 },
      { x: -4, z: -2 },
      { x: 6, z: 0 },
    ];
    const plazaPos = { x: -1, z: 0 };
    const circle = computeClusterBoundingCircle(positions, plazaPos);
    expect(circle.center.x).toBe(-1);
    expect(circle.center.z).toBe(0);
    // 半徑要改成「以廣場為圓心」重算，不是沿用 bbox 中心那組半徑
    const expectedRadius = Math.max(
      Math.hypot(-6.75 - -1, 0),
      Math.hypot(-4 - -1, 2),
      Math.hypot(-4 - -1, -2),
      Math.hypot(6 - -1, 0),
    );
    expect(circle.radius).toBeCloseTo(expectedRadius, 5);
  });
});
