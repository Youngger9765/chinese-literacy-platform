/**
 * PRD §10.4: "這個網站已經有全站適用的 @media (prefers-reduced-motion:
 * reduce) 規則（DESIGN.md，index.css 定義）" — that global rule already
 * collapses every CSS transition/animation DURATION to ~0, which is enough
 * for the small per-event effects (hit flash, combo pop, score-bar fill,
 * countdown ring, result entrance — all CSS-driven here).
 *
 * This hook exists only for the ONE place that needs a STRUCTURAL swap, not
 * just a faster transition: the figure intro animation becomes a static
 * card + text with a fixed dwell time (PRD §10.4), which JS has to decide.
 */
import { useEffect, useState } from 'react';

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);

  return reduced;
}
