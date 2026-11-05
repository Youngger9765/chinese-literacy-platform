/**
 * archipelagoFog.test.ts — #3780 美術指導書 §2.2 白屏事故後的訂正
 * （2026-10-31，team-lead 算出根因：`density = 2.2/maxRadius` 在小群會
 * 讓 `(density×distance)²` 逼近/超過能讓 `exp(-x²)` 趨近 0 的範圍，整個
 * 場景的霧化係數趨近 1，所有東西都變成霧色——霧色又是淺色系，畫面因此
 * 整片洗白）。
 *
 * 新公式反過來想：先決定「最遠那座島的霧化係數大概要多少」（0.35，看得
 * 到島但有明顯空氣感，不是完全看不見也不是完全沒有霧），再反推密度，
 * 不是先決定一個密度再看它產生出來的霧化係數是多少。
 */
import { describe, it, expect } from 'vitest';
import { archipelagoFogDensity, archipelagoFogFactorAt, FARTHEST_DISTANCE_MULTIPLIER } from '../createArchipelagoWorld';

describe('archipelagoFogDensity — 反推密度，目標是「最遠距離」的霧化係數落在指定值', () => {
  it('用算出來的密度回推最遠距離的霧化係數，應該等於目標值（0.35）', () => {
    const maxDist = 20;
    const density = archipelagoFogDensity(maxDist);
    const farthestDistance = maxDist * FARTHEST_DISTANCE_MULTIPLIER;
    const factor = archipelagoFogFactorAt(density, farthestDistance);
    expect(factor).toBeCloseTo(0.35, 5);
  });

  it('🔒 正向對照：舊公式（2.2/maxRadius）在同樣的 maxDist 會讓最遠距離霧化係數超過 0.9（證明新公式真的解決了洗白問題，不是碰巧算出差不多的數字）', () => {
    const maxDist = 20;
    const oldDensity = Math.min(0.04, 2.2 / Math.max(6, maxDist));
    const farthestDistance = maxDist * FARTHEST_DISTANCE_MULTIPLIER;
    const oldFactor = archipelagoFogFactorAt(oldDensity, farthestDistance);
    expect(oldFactor).toBeGreaterThan(0.9);
  });

  it('不同 maxDist 都能讓最遠距離的霧化係數落在目標值附近（公式對群的大小有自適應，不是單一群才剛好對）', () => {
    for (const maxDist of [6, 10, 20, 40, 71]) {
      const density = archipelagoFogDensity(maxDist);
      const farthestDistance = maxDist * FARTHEST_DISTANCE_MULTIPLIER;
      const factor = archipelagoFogFactorAt(density, farthestDistance);
      expect(factor, `maxDist=${maxDist}`).toBeCloseTo(0.35, 5);
    }
  });

  it('群越大，密度越小（維持構圖統一感，不是群大了霧反而變濃）', () => {
    const small = archipelagoFogDensity(10);
    const large = archipelagoFogDensity(60);
    expect(large).toBeLessThan(small);
  });

  it('可以指定不同的目標霧化係數（預設 0.35，但保留可調整的彈性）', () => {
    const maxDist = 20;
    const density = archipelagoFogDensity(maxDist, 0.5);
    const farthestDistance = maxDist * FARTHEST_DISTANCE_MULTIPLIER;
    const factor = archipelagoFogFactorAt(density, farthestDistance);
    expect(factor).toBeCloseTo(0.5, 5);
  });

  it('決定性：同樣輸入兩次呼叫結果一樣', () => {
    expect(archipelagoFogDensity(20)).toBe(archipelagoFogDensity(20));
  });

  it('maxDist 極小時（接近 0）不會產生 Infinity 或 NaN（fail-safe 下限）', () => {
    const density = archipelagoFogDensity(0);
    expect(Number.isFinite(density)).toBe(true);
    expect(density).toBeGreaterThan(0);
  });
});

describe('archipelagoFogFactorAt — FogExp2 霧化係數公式本身（純數學）', () => {
  it('距離 0 時霧化係數是 0（完全看得清楚）', () => {
    expect(archipelagoFogFactorAt(0.02, 0)).toBe(0);
  });

  it('密度 0 時霧化係數永遠是 0（不管距離多遠都沒有霧）', () => {
    expect(archipelagoFogFactorAt(0, 1000)).toBe(0);
  });

  it('距離越遠，霧化係數越高（單調遞增）', () => {
    const a = archipelagoFogFactorAt(0.02, 10);
    const b = archipelagoFogFactorAt(0.02, 50);
    expect(b).toBeGreaterThan(a);
  });
});
