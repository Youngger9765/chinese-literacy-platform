import { describe, expect, it } from 'vitest';
import { detectSideEvents, type SideSnapshot } from '../detectSideEvents';

const fresh = (): SideSnapshot => ({ towers_destroyed: 0, current_hp: 100, base_destroyed: false });

describe('detectSideEvents', () => {
  it('returns nothing on the very first poll (no prior snapshot)', () => {
    expect(detectSideEvents(null, { a: fresh(), b: fresh() })).toEqual([]);
  });

  it('returns nothing when neither side changed', () => {
    const snap = { a: fresh(), b: fresh() };
    expect(detectSideEvents(snap, snap)).toEqual([]);
  });

  it('detects partial damage via a current_hp decrease', () => {
    const prev = { a: fresh(), b: fresh() };
    const next = { a: fresh(), b: { ...fresh(), current_hp: 80 } };
    expect(detectSideEvents(prev, next)).toEqual([{ side: 'b', kind: 'damage' }]);
  });

  it('detects a tower falling via towers_destroyed increasing', () => {
    const prev = { a: fresh(), b: fresh() };
    const next = { a: fresh(), b: { towers_destroyed: 1, current_hp: 100, base_destroyed: false } };
    expect(detectSideEvents(prev, next)).toEqual([{ side: 'b', kind: 'tower_fallen' }]);
  });

  it('detects base_destroyed even when towers_destroyed/current_hp do not change further', () => {
    const prev = { a: fresh(), b: { towers_destroyed: 3, current_hp: 1, base_destroyed: false } };
    const next = { a: fresh(), b: { towers_destroyed: 3, current_hp: 0, base_destroyed: true } };
    expect(detectSideEvents(prev, next)).toEqual([{ side: 'b', kind: 'base_destroyed' }]);
  });

  it('reports both sides independently when both changed', () => {
    const prev = { a: fresh(), b: fresh() };
    const next = {
      a: { ...fresh(), current_hp: 90 },
      b: { towers_destroyed: 1, current_hp: 100, base_destroyed: false },
    };
    const events = detectSideEvents(prev, next);
    expect(events).toContainEqual({ side: 'a', kind: 'damage' });
    expect(events).toContainEqual({ side: 'b', kind: 'tower_fallen' });
  });

  it('never reports an event when HP increases or stays the same (no "healing" misfires)', () => {
    const prev = { a: { ...fresh(), current_hp: 50 }, b: fresh() };
    const next = { a: { ...fresh(), current_hp: 100 }, b: fresh() };
    expect(detectSideEvents(prev, next)).toEqual([]);
  });
});
