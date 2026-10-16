/**
 * leagueVisuals — pure presentation helpers for the 2026-10-16 league UI
 * redesign (#3554 follow-up, PRD §12). Kept dependency-free and separate
 * from the page components so the percent-clamping / copy-generation logic
 * has its own fast unit tests instead of only being exercised indirectly
 * through a full page render.
 */

/** Progress toward a frozen threshold, clamped to [0, 100]. Guards against
 * threshold <= 0 (shouldn't happen — PRD §5 weights are always positive —
 * but a UI helper must never divide by zero or render NaN%). */
export function energyPercent(points: number, threshold: number): number {
  if (!Number.isFinite(points) || !Number.isFinite(threshold) || threshold <= 0) {
    return 0;
  }
  const pct = (points / threshold) * 100;
  return Math.max(0, Math.min(100, pct));
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

/** Whole-number display points (the scoring engine can produce fractional
 * points from assignment_bonus combinations; the UI always shows whole
 * numbers so two different exact values never render identically rounded
 * in one place and not another). */
export function displayPoints(points: number): number {
  return Math.round(points);
}
