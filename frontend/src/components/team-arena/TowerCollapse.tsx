/**
 * TowerCollapse / VictoryBurst — PRD §0 v2 改版 N: "倒塔另有崩塌動畫，主堡
 * 被打倒有勝利動畫". Same reduced-motion fallback shape as
 * AttackAnimation.tsx (fade only).
 */
import React, { useEffect, useRef } from 'react';
import { usePrefersReducedMotion } from '../pk/usePrefersReducedMotion';

const FALLBACK_MS = 900;
const REDUCED_MOTION_FADE_MS = 300;

function useAutoComplete(onComplete: () => void, reducedMotion: boolean, ms: number) {
  const firedRef = useRef(false);
  const complete = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    onComplete();
  };
  useEffect(() => {
    firedRef.current = false;
    const timer = window.setTimeout(complete, reducedMotion ? REDUCED_MOTION_FADE_MS : ms);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);
  return complete;
}

export const TowerCollapse: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const reducedMotion = usePrefersReducedMotion();
  const complete = useAutoComplete(onComplete, reducedMotion, FALLBACK_MS);
  return (
    <div
      className={`pointer-events-none absolute inset-0 flex items-center justify-center text-5xl ${
        reducedMotion ? 'animate-fade-in opacity-60' : 'animate-tower-collapse'
      }`}
      onAnimationEnd={complete}
      aria-hidden="true"
      data-testid="tower-collapse-animation"
    >
      🏯
    </div>
  );
};

export const VictoryBurst: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const reducedMotion = usePrefersReducedMotion();
  const complete = useAutoComplete(onComplete, reducedMotion, FALLBACK_MS);
  return (
    <div
      className={`pointer-events-none absolute inset-0 flex items-center justify-center text-6xl ${
        reducedMotion ? 'animate-fade-in opacity-80' : 'animate-star-burst'
      }`}
      onAnimationEnd={complete}
      aria-hidden="true"
      data-testid="victory-animation"
    >
      🎉
    </div>
  );
};
