/**
 * 多人對抗賽 v2 攻擊動畫 — PRD §0 v2 改版 N: "每次答對...多種攻擊模式、每次
 * 隨機（例：投石、閃電、火球、箭雨、旋風、流星；不連續兩次重複）".
 *
 * Pure picker logic only — the visual component (AttackAnimation.tsx)
 * imports `AttackVariant`/`ATTACK_VARIANTS` from here but has no say in
 * which one gets picked; this keeps "never twice in a row" independently
 * testable without mounting anything.
 */

export const ATTACK_VARIANTS = ['rock', 'lightning', 'fireball', 'arrows', 'tornado', 'meteor'] as const;

export type AttackVariant = (typeof ATTACK_VARIANTS)[number];

export const ATTACK_VARIANT_LABELS: Record<AttackVariant, string> = {
  rock: '投石',
  lightning: '閃電',
  fireball: '火球',
  arrows: '箭雨',
  tornado: '旋風',
  meteor: '流星',
};

/**
 * Picks a random variant, excluding `previous` when given one — PRD's
 * "不連續兩次重複". Takes an injectable `rng` (defaults to Math.random)
 * purely for deterministic testing; production callers never pass one.
 */
export function pickAttackVariant(
  previous: AttackVariant | null,
  rng: () => number = Math.random,
): AttackVariant {
  const pool = previous ? ATTACK_VARIANTS.filter((v) => v !== previous) : ATTACK_VARIANTS;
  const index = Math.floor(rng() * pool.length);
  return pool[Math.min(index, pool.length - 1)];
}
