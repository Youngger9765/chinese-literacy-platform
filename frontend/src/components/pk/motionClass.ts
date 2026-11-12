/**
 * motionClass — PRD §3.3/§10.4 reduced-motion: the global `@media
 * (prefers-reduced-motion: reduce)` rule (index.css) already collapses every
 * Tailwind `animate-*` duration to ~0, which is enough for the small
 * per-event effects (hit flash, combo pop, score-bar fill, countdown ring,
 * result entrance — all CSS-driven, see those components). The VS screen's
 * entrance animation is explicit about it too (not just relying on the
 * duration becoming instant) so the two states stay visibly distinct and
 * the intent is readable at each call site, instead of every screen
 * re-deriving its own reduced-motion conditional.
 */
export function motionClass(reducedMotion: boolean, animatedClassName: string): string {
  return reducedMotion ? '' : animatedClassName;
}
