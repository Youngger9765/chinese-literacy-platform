import { describe, it, expect } from 'vitest';
import { introProgress, characterPose } from '../islandMotion';

describe('introProgress — 開場鏡頭從海上空推近到主角', () => {
  it('starts at 0, ends at 1 and clamps outside the window', () => {
    expect(introProgress(-1, 3)).toBe(0);
    expect(introProgress(0, 3)).toBe(0);
    expect(introProgress(3, 3)).toBe(1);
    expect(introProgress(9, 3)).toBe(1);
  });

  it('eases out: covers more than half the distance in the first half of the time', () => {
    expect(introProgress(1.5, 3)).toBeGreaterThan(0.75);
  });
});

describe('characterPose — 人物微動作', () => {
  it('idle: breathes (height changes over time) while keeping volume (x shrinks when y grows)', () => {
    const a = characterPose({ elapsed: 0.5, moving: false, sinceLanded: 9 });
    const b = characterPose({ elapsed: 1.5, moving: false, sinceLanded: 9 });
    expect(a.scaleY).not.toBeCloseTo(b.scaleY, 3);
    expect(Math.abs(a.scaleY - 1)).toBeLessThan(0.05);
    expect((a.scaleY - 1) * (a.scaleX - 1)).toBeLessThanOrEqual(0);
    expect(a.tilt).toBe(0);
  });

  it('walking: sways side to side, no breathing', () => {
    const tilts = [0.1, 0.2, 0.3].map((t) => characterPose({ elapsed: t, moving: true, sinceLanded: 9 }).tilt);
    expect(Math.max(...tilts)).toBeGreaterThan(0);
    expect(Math.min(...tilts)).toBeLessThan(0);
    expect(Math.max(...tilts.map(Math.abs))).toBeLessThan(0.12);
    expect(characterPose({ elapsed: 0.5, moving: true, sinceLanded: 9 }).scaleY).toBe(1);
  });

  it('landing: squashes right after touching down, back to normal within 0.3s', () => {
    const land = characterPose({ elapsed: 5, moving: false, sinceLanded: 0.02 });
    expect(land.scaleY).toBeLessThan(0.92);
    expect(land.scaleX).toBeGreaterThan(1.05);
    const later = characterPose({ elapsed: 5, moving: true, sinceLanded: 0.35 });
    expect(later.scaleY).toBe(1);
  });
});
