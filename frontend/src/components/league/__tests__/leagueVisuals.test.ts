import { describe, it, expect } from 'vitest';
import { energyPercent, chestHintText, displayPoints } from '../leagueVisuals';

describe('energyPercent', () => {
  it('computes a simple fraction', () => {
    expect(energyPercent(60, 120)).toBe(50);
  });

  it('clamps above 100 (a team can exceed the badge threshold)', () => {
    expect(energyPercent(240, 120)).toBe(100);
  });

  it('clamps below 0 for a negative points value', () => {
    expect(energyPercent(-5, 120)).toBe(0);
  });

  it('never divides by a zero or negative threshold', () => {
    expect(energyPercent(10, 0)).toBe(0);
    expect(energyPercent(10, -1)).toBe(0);
  });

  it('never returns NaN for non-finite input', () => {
    expect(energyPercent(Number.NaN, 120)).toBe(0);
    expect(Number.isNaN(energyPercent(10, Number.NaN))).toBe(false);
  });
});

describe('chestHintText', () => {
  it('shows the unlocked message when eligible', () => {
    expect(chestHintText(true, 0)).toBe('全班已解鎖神秘寶箱！');
  });

  it('shows the unlocked message when needed <= 0 even if eligible is somehow false', () => {
    // Defensive: the two fields should never disagree, but the copy must
    // not say "還差 0 人" (reads as a bug, not good news) if they do.
    expect(chestHintText(false, 0)).toBe('全班已解鎖神秘寶箱！');
  });

  it('shows the gap count when not yet eligible', () => {
    expect(chestHintText(false, 2)).toBe('還差 2 人就能解鎖神秘寶箱');
  });
});

describe('displayPoints', () => {
  it('rounds fractional points to the nearest whole number', () => {
    expect(displayPoints(12.4)).toBe(12);
    expect(displayPoints(12.5)).toBe(13);
  });
});
