/**
 * core/__tests__/groundRadius.test.ts — 鎖住「地面圓盤半徑不夠大，畫面
 * 最上緣露出邊緣」這個退回重做的 bug（team-lead 2026-10-31）。
 *
 * 兩筆真實群的數字（實測，不是編的）：
 * - 28 島群（`group=grade&cluster=5`）：`maxRadius≈33.26`，理論最小需要
 *   半徑≈199.8，舊版 `6×maxRadius=199.53`——少了 0.27，露邊緣。
 * - 36 島群（`group=category&cluster=歷史人文`）：`maxRadius≈54.57`，
 *   理論最小需要半徑≈323.1，舊版 `6×maxRadius=327.4`——只多 4.3，幾乎
 *   沒有安全邊際。
 *
 * 這支鎖兩件事：① 新函式在這兩個真實 maxRadius 上回傳的半徑都要明顯大於
 * 舊版 `6×maxRadius`（有真正的安全邊際，不是又卡在門檻上）② mutation：
 * 把 `safetyMargin` 的乘法拿掉會讓這支紅。
 */
import { describe, it, expect } from 'vitest';
import { requiredGroundRadius } from '../groundRadius';

describe('requiredGroundRadius — 地面圓盤安全半徑', () => {
  it('28 島群（maxRadius≈33.26）：新半徑明顯大於舊版 6×maxRadius=199.53', () => {
    const maxRadius = 33.26;
    const oldRadius = maxRadius * 6;
    const newRadius = requiredGroundRadius(maxRadius);
    expect(newRadius).toBeGreaterThan(oldRadius * 1.3); // 至少多 30% 安全邊際，不是又卡在門檻上
  });

  it('36 島群（maxRadius≈54.57）：新半徑明顯大於舊版 6×maxRadius=327.4', () => {
    const maxRadius = 54.57;
    const oldRadius = maxRadius * 6;
    const newRadius = requiredGroundRadius(maxRadius);
    expect(newRadius).toBeGreaterThan(oldRadius * 1.3);
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
