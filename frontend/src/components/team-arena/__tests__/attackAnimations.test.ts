/**
 * TDD for pickAttackVariant — PRD §0 v2 改版 N: "多種攻擊模式、每次隨機...
 * 不連續兩次重複".
 */
import { describe, expect, it } from 'vitest';
import { ATTACK_VARIANTS, pickAttackVariant } from '../attackAnimations';

describe('pickAttackVariant', () => {
  it('never repeats the previous variant', () => {
    let previous: (typeof ATTACK_VARIANTS)[number] | null = null;
    let seed = 0;
    const rng = () => {
      // Deterministic sweep across [0, 1) so every branch of the pool
      // gets exercised, not just whatever Math.random() happens to give.
      seed = (seed + 0.137) % 1;
      return seed;
    };
    for (let i = 0; i < 200; i += 1) {
      const next = pickAttackVariant(previous, rng);
      expect(ATTACK_VARIANTS).toContain(next);
      if (previous !== null) {
        expect(next).not.toBe(previous);
      }
      previous = next;
    }
  });

  it('can pick every variant when previous is null (first attack of the match)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < ATTACK_VARIANTS.length; i += 1) {
      seen.add(pickAttackVariant(null, () => i / ATTACK_VARIANTS.length));
    }
    expect(seen.size).toBe(ATTACK_VARIANTS.length);
  });

  it('excludes exactly the previous variant from the pool, nothing else', () => {
    const previous = ATTACK_VARIANTS[2];
    const seen = new Set<string>();
    const poolSize = ATTACK_VARIANTS.length - 1;
    for (let i = 0; i < poolSize; i += 1) {
      seen.add(pickAttackVariant(previous, () => i / poolSize));
    }
    expect(seen.has(previous)).toBe(false);
    expect(seen.size).toBe(poolSize);
  });

  it('rng returning exactly 1 (edge case) still returns a valid variant', () => {
    const next = pickAttackVariant(null, () => 0.999999999);
    expect(ATTACK_VARIANTS).toContain(next);
  });
});
