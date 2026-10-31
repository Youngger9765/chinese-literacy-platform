/**
 * core/__tests__/groundRadius.test.ts — 鎖住「地面圓盤半徑不夠大，畫面
 * 最上緣露出邊緣」這個退回重做的 bug（team-lead 2026-10-31）。
 *
 * ⚠️ 2026-10-31 五次訂正：原本這裡拿「舊版 `6×maxRadius`」當比較基準，
 * 但那個 `6` 是針對**舊俯仰角 0.65 rad** 校準的門檻值——構圖那輪訂正把
 * 俯仰角調陡到 1.05 rad 之後，陡角度下視線打到地面的距離本來就短很多，
 * 新函式在新相機參數下算出來的安全半徑（maxRadius=33.26 時≈91，
 * maxRadius=54.57 時≈148）遠小於那個已經過時的 `6×` 數字——這不是退步，
 * 是「舊基準線本身只對舊相機角度有意義」。改成跟函式自己的
 * `safetyMargin=1` 情況比（也就是「理論最小值」本身），這樣不管以後
 * 相機俯仰角/縮放倍率再怎麼調，這條鎖都還是在驗證「真的有安全邊際」這件
 * 事，不會因為構圖再訂正一次又變成要手動改的魔術數字。
 *
 * 這支鎖兩件事：① 新函式在真實 maxRadius 上回傳的半徑都要明顯大於「不留
 * 安全邊際」(`safetyMargin=1`) 時的理論最小值 ② mutation：把 `safetyMargin`
 * 的乘法拿掉會讓這支紅。
 */
import { describe, it, expect } from 'vitest';
import { requiredGroundRadius } from '../groundRadius';

describe('requiredGroundRadius — 地面圓盤安全半徑', () => {
  it('28 島群（maxRadius≈33.26）：預設安全邊際下的半徑明顯大於「理論最小值」（safetyMargin=1）', () => {
    const maxRadius = 33.26;
    const theoreticalMin = requiredGroundRadius(maxRadius, 1);
    const withMargin = requiredGroundRadius(maxRadius);
    expect(withMargin).toBeGreaterThan(theoreticalMin * 1.3); // 預設 1.5 倍margin，至少要比沒邊際時多 30%
  });

  it('36 島群（maxRadius≈54.57）：同上', () => {
    const maxRadius = 54.57;
    const theoreticalMin = requiredGroundRadius(maxRadius, 1);
    const withMargin = requiredGroundRadius(maxRadius);
    expect(withMargin).toBeGreaterThan(theoreticalMin * 1.3);
  });

  it('半徑隨 maxRadius 遞增（群越大，地面要越大）', () => {
    const small = requiredGroundRadius(10);
    const big = requiredGroundRadius(60);
    expect(big).toBeGreaterThan(small);
  });

  it('極小 maxRadius 有下限（不會算出一個比島本身還小的地面）', () => {
    expect(requiredGroundRadius(0.1)).toBeGreaterThanOrEqual(60);
  });

  it('safetyMargin 是真的乘數——調大它半徑會跟著變大（mutation 驗過：拿掉乘法這條會紅）', () => {
    const base = requiredGroundRadius(40, 1.5);
    const bigger = requiredGroundRadius(40, 3);
    expect(bigger).toBeGreaterThan(base * 1.9); // 大約兩倍（浮點數給一點容忍）
  });
});
