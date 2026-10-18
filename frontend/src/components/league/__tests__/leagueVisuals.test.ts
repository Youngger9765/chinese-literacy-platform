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

  it('floors a tiny non-zero fraction to a minimum visible width (2026-10-16 fix)', () => {
    // 2026-10-16: a 1698-roster class scoring 12 points averages to
    // 12/1698 = 0.00707% of the 120-point threshold — 0 visible pixels wide
    // in a bar, indistinguishable from "nobody has done anything yet"
    // (staging-teacher-battlehero-scored-1280.png). Any non-zero progress
    // must render as SOME visible width.
    const pct = energyPercent(12, 1698);
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeGreaterThanOrEqual(2);
  });

  it('does not apply the minimum-visible floor to an exact zero', () => {
    expect(energyPercent(0, 120)).toBe(0);
  });

  it('does not shrink an already-large percentage below its real value', () => {
    // The floor must never pull a legitimately higher percentage DOWN.
    expect(energyPercent(60, 120)).toBe(50);
  });
});

describe('chestHintText', () => {
  // #3615: the chest wording follows the active story pack — it used to be
  // hardcoded「神秘寶箱」for every pack.
  it('shows the unlocked message with the pack chest name when eligible', () => {
    expect(chestHintText('絲路寶箱', true, 0)).toBe('全班已解鎖絲路寶箱！');
  });

  it('shows the unlocked message when needed <= 0 even if eligible is somehow false', () => {
    // Defensive: the two fields should never disagree, but the copy must
    // not say "還差 0 人" (reads as a bug, not good news) if they do.
    expect(chestHintText('瓦子寶箱', false, 0)).toBe('全班已解鎖瓦子寶箱！');
  });

  it('shows the gap count with the pack chest name when not yet eligible', () => {
    expect(chestHintText('秘笈寶箱', false, 2)).toBe('還差 2 人就能解鎖秘笈寶箱');
  });

  it('never falls back to the old hardcoded「神秘寶箱」when given a name', () => {
    expect(chestHintText('線索百寶箱', false, 3)).not.toContain('神秘寶箱');
    expect(chestHintText('線索百寶箱', true, 0)).not.toContain('神秘寶箱');
  });
});

describe('displayPoints', () => {
  it('rounds fractional points >= 10 to the nearest whole number', () => {
    expect(displayPoints(12.4)).toBe('12');
    expect(displayPoints(12.5)).toBe('13');
  });

  it('shows a whole number unchanged', () => {
    expect(displayPoints(120)).toBe('120');
    expect(displayPoints(12)).toBe('12');
  });

  it('shows exactly 0 (not "0.0") for zero', () => {
    expect(displayPoints(0)).toBe('0');
  });

  it('shows one decimal for a non-zero value under 10 (2026-10-16 fix)', () => {
    // Coordinator's real-world example: a 30-kid class with one lesson
    // done averages 12/30 = 0.4 points. Math.round(0.4) === 0, which made
    // genuine early progress look identical to "nobody has started" — the
    // exact failure mode the min-visible-bar fix above also addresses.
    expect(displayPoints(0.4)).toBe('0.4');
  });

  it('rounds a one-decimal value to the nearest tenth, not just truncates', () => {
    expect(displayPoints(0.449)).toBe('0.4');
    expect(displayPoints(0.46)).toBe('0.5');
  });

  it('falls back to whole-number display when rounding to one decimal would read as 10', () => {
    // 9.96 -> "10.0" would look like a formatting glitch right next to the
    // "120" threshold format; it must present as "10" instead.
    expect(displayPoints(9.96)).toBe('10');
  });

  it('never returns a negative or NaN-looking string', () => {
    expect(displayPoints(-3)).toBe('0');
    expect(displayPoints(Number.NaN)).toBe('0');
  });
});
