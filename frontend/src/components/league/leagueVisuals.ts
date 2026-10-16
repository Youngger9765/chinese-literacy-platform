/**
 * leagueVisuals — pure presentation helpers for the 2026-10-16 league UI
 * redesign (#3554 follow-up, PRD §12). Kept dependency-free and separate
 * from the page components so the percent-clamping / copy-generation logic
 * has its own fast unit tests instead of only being exercised indirectly
 * through a full page render.
 */

/** A non-zero bar must still render as SOME visible width — below this, a
 * real 12-point class of 1698 students (0.00707%) is pixel-identical to a
 * class with zero participation. 2026-10-16 fix (coordinator review of
 * staging-teacher-battlehero-scored-1280.png). */
const MIN_VISIBLE_PCT = 2;

/** Progress toward a frozen threshold, clamped to [0, 100]. Guards against
 * threshold <= 0 (shouldn't happen — PRD §5 weights are always positive —
 * but a UI helper must never divide by zero or render NaN%). Any strictly
 * positive result is floored to MIN_VISIBLE_PCT so early progress is never
 * visually indistinguishable from no progress at all. */
export function energyPercent(points: number, threshold: number): number {
  if (!Number.isFinite(points) || !Number.isFinite(threshold) || threshold <= 0) {
    return 0;
  }
  const pct = (points / threshold) * 100;
  const clamped = Math.max(0, Math.min(100, pct));
  if (clamped <= 0) return 0;
  return Math.max(clamped, MIN_VISIBLE_PCT);
}

/** 「還差 N 人解鎖寶箱」 copy — PRD §12.1 item 8. Eligible already (needed
 * <= 0) returns the unlocked message instead of "還差 0 人", which would
 * read as a glitch rather than good news. */
export function chestHintText(eligible: boolean, participantsNeeded: number): string {
  if (eligible || participantsNeeded <= 0) {
    return '全班已解鎖神秘寶箱！';
  }
  return `還差 ${participantsNeeded} 人就能解鎖神秘寶箱`;
}

/** Display formatting for a points value. Whole numbers (and anything
 * rounding to >= 10) show as whole numbers — individual contributions are
 * always a multiple of lesson_complete (10), so this branch is what every
 * per-student total hits. A CLASS AVERAGE, though, divides by roster size
 * and routinely lands under 10 as a genuine non-zero fraction (a 30-kid
 * class with one lesson done averages 12/30 = 0.4). Math.round(0.4) === 0
 * made real early progress look pixel-identical to "nobody has started" —
 * 2026-10-16 fix (coordinator review of staging-teacher-battlehero-scored-
 * 1280.png, same report as the energyPercent min-visible-width fix above).
 * Returns a string (not a number) because "0.4" must render verbatim, not
 * get re-rounded by a caller that expects a display-ready value. */
export function displayPoints(points: number): string {
  if (!Number.isFinite(points) || points <= 0) return '0';
  if (points < 10) {
    const oneDecimal = Math.round(points * 10) / 10;
    // Guard the 9.95-9.99 edge: rounding to one decimal must never produce
    // "10.0" sitting next to whole-number thresholds like "120".
    if (oneDecimal < 10) return oneDecimal.toFixed(1);
  }
  return String(Math.round(points));
}
