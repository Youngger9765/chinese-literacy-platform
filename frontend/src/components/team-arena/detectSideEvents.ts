/**
 * detectSideEvents — derives "something just happened to this side's
 * towers/base" purely from two consecutive PUBLIC `sides` snapshots
 * (towers_destroyed/current_hp/base_destroyed — visible to EVERY viewer,
 * including opponents and the host, PRD §0 v2 rule N: "學生端與開房者端
 * 都要看到攻擊動畫"). This is deliberately NOT derived from any per-round
 * payload (those are role-gated for privacy) — comparing the public
 * summary before/after a poll is the one signal every viewer can
 * legitimately see.
 */

export interface SideSnapshot {
  towers_destroyed: number;
  current_hp: number;
  base_destroyed: boolean;
}

export type SideEventKind = 'damage' | 'tower_fallen' | 'base_destroyed';

export interface SideEvent {
  side: 'a' | 'b';
  kind: SideEventKind;
}

/**
 * `prev === null` (first poll ever) never produces events — there is
 * nothing to compare against yet, so nothing "just happened".
 */
export function detectSideEvents(
  prev: Record<'a' | 'b', SideSnapshot> | null,
  next: Record<'a' | 'b', SideSnapshot>,
): SideEvent[] {
  if (!prev) return [];
  const events: SideEvent[] = [];
  (['a', 'b'] as const).forEach((side) => {
    const p = prev[side];
    const n = next[side];
    if (!p || !n) return;
    if (!p.base_destroyed && n.base_destroyed) {
      events.push({ side, kind: 'base_destroyed' });
      return;
    }
    if (n.towers_destroyed > p.towers_destroyed) {
      events.push({ side, kind: 'tower_fallen' });
      return;
    }
    if (n.current_hp < p.current_hp) {
      events.push({ side, kind: 'damage' });
    }
  });
  return events;
}
