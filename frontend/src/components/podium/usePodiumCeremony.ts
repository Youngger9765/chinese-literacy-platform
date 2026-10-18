/**
 * usePodiumCeremony — #3630 頒獎台揭曉時序引擎。
 *
 * Pure timing/state logic (no DOM, no Tailwind) for the award-ceremony
 * reveal sequence: ranks reveal in descending order (3rd → 2nd → 1st),
 * confetti fires exactly when the champion (rank 1) appears, and
 * `prefers-reduced-motion` short-circuits straight to a fully-revealed,
 * static, confetti-free state (see frontend-design rule + PkVsScreen /
 * usePrefersReducedMotion for the same pattern elsewhere in this repo).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type PodiumStage = 'idle' | 'revealing' | 'settled';

/** Millisecond offsets from mount. Tuned for a live ~6-8s ceremony when
 *  projected at a product launch: a short dim beat, then each place rises
 *  with enough breathing room to read the name+score before the next one
 *  lands, settling shortly after the champion's confetti burst. */
export const PODIUM_TIMING_MS = {
  THIRD: 300,
  SECOND: 2600,
  FIRST: 5200,
  SETTLE: 7400,
} as const;

interface UsePodiumCeremonyResult {
  stage: PodiumStage;
  revealedRanks: ReadonlySet<number>;
  showConfetti: boolean;
  replay: () => void;
}

/** Reveal order is always descending by rank (3 before 2 before 1), built
 *  only from the ranks actually present — a 2-finisher game never schedules
 *  a phantom "3rd place" that will never arrive. */
function buildRevealOrder(availableRanks: number[]): number[] {
  return [...availableRanks].sort((a, b) => b - a);
}

/** Step 0 always lands at THIRD, step 1 at SECOND, step 2 (only possible
 *  with a full podium) at FIRST — i.e. offsets count from the START of the
 *  sequence, not anchored to the champion. With 3 finishers that's the
 *  familiar 3rd(THIRD)→2nd(SECOND)→1st(FIRST) cadence; with 2 it's
 *  2nd(THIRD)→1st(SECOND); with 1 it's 1st(THIRD) — still well before
 *  SETTLE, so confetti has already landed by the time the stage settles. */
const STEP_OFFSETS_MS = [PODIUM_TIMING_MS.THIRD, PODIUM_TIMING_MS.SECOND, PODIUM_TIMING_MS.FIRST] as const;

function offsetForStep(stepIndex: number): number {
  return STEP_OFFSETS_MS[stepIndex] ?? PODIUM_TIMING_MS.FIRST;
}

export function usePodiumCeremony(availableRanks: number[], reducedMotion: boolean): UsePodiumCeremonyResult {
  const revealOrder = buildRevealOrder(availableRanks);
  const hasChampion = revealOrder.includes(1);

  const computeInitial = useCallback((): { stage: PodiumStage; revealed: Set<number>; confetti: boolean } => {
    if (reducedMotion) {
      return { stage: 'settled', revealed: new Set(revealOrder), confetti: false };
    }
    if (revealOrder.length === 0) {
      return { stage: 'settled', revealed: new Set(), confetti: false };
    }
    return { stage: 'revealing', revealed: new Set(), confetti: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed explicitly via replay()/runId, not on every availableRanks identity change
  }, [reducedMotion]);

  const [runId, setRunId] = useState(0);
  const [stage, setStage] = useState<PodiumStage>(() => computeInitial().stage);
  const [revealedRanks, setRevealedRanks] = useState<Set<number>>(() => computeInitial().revealed);
  const [showConfetti, setShowConfetti] = useState<boolean>(() => computeInitial().confetti);

  const timeoutIdsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearPendingTimers = useCallback(() => {
    timeoutIdsRef.current.forEach((id) => clearTimeout(id));
    timeoutIdsRef.current = [];
  }, []);

  useEffect(() => {
    clearPendingTimers();

    if (reducedMotion) {
      setRevealedRanks(new Set(revealOrder));
      setShowConfetti(false);
      setStage('settled');
      return clearPendingTimers;
    }

    if (revealOrder.length === 0) {
      setRevealedRanks(new Set());
      setShowConfetti(false);
      setStage('settled');
      return clearPendingTimers;
    }

    setRevealedRanks(new Set());
    setShowConfetti(false);
    setStage('revealing');

    revealOrder.forEach((rank, index) => {
      const delay = offsetForStep(index);
      const id = setTimeout(() => {
        setRevealedRanks((prev) => {
          const next = new Set(prev);
          next.add(rank);
          return next;
        });
        if (rank === 1) {
          setShowConfetti(true);
        }
      }, delay);
      timeoutIdsRef.current.push(id);
    });

    const settleId = setTimeout(() => {
      setStage('settled');
    }, PODIUM_TIMING_MS.SETTLE);
    timeoutIdsRef.current.push(settleId);

    return clearPendingTimers;
    // revealOrder is derived fresh from availableRanks/reducedMotion each
    // render; re-running this effect per runId (replay) or when the actual
    // rank set / motion preference changes is the intended behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, reducedMotion, JSON.stringify(revealOrder), hasChampion, clearPendingTimers]);

  const replay = useCallback(() => {
    if (reducedMotion) return; // static ceremony: nothing to replay
    setRunId((id) => id + 1);
  }, [reducedMotion]);

  return { stage, revealedRanks, showConfetti, replay };
}
