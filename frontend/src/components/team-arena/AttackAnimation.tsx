/**
 * AttackAnimation — PRD §0 v2 改版 N: 答對時播放一次攻擊對方塔的動畫,
 * ≤1.5 秒不擋下一題、respects `prefers-reduced-motion`（只淡入淡出）。
 * 不使用任何商業遊戲的名稱／角色／美術 — 每種攻擊只是一個 emoji + CSS
 * keyframe 位移（見 tailwind.config.js `attack-*`），不是描摹特定作品。
 */
import React, { useEffect, useRef } from 'react';
import { usePrefersReducedMotion } from '../pk/usePrefersReducedMotion';
import type { AttackVariant } from './attackAnimations';

const VARIANT_EMOJI: Record<AttackVariant, string> = {
  rock: '🪨',
  lightning: '⚡',
  fireball: '🔥',
  arrows: '🏹',
  tornado: '🌪️',
  meteor: '☄️',
};

const VARIANT_ANIMATION_CLASS: Record<AttackVariant, string> = {
  rock: 'animate-attack-rock',
  lightning: 'animate-attack-lightning',
  fireball: 'animate-attack-fireball',
  arrows: 'animate-attack-arrows',
  tornado: 'animate-attack-tornado',
  meteor: 'animate-attack-meteor',
};

// PRD N: "動畫 ≤1.5 秒" — fallback timer in case `onAnimationEnd` never
// fires (e.g. a browser quirk), so a turn can never be stuck waiting.
const FALLBACK_MS = 1200;
const REDUCED_MOTION_FADE_MS = 300;

interface AttackAnimationProps {
  variant: AttackVariant;
  onComplete: () => void;
}

const AttackAnimation: React.FC<AttackAnimationProps> = ({ variant, onComplete }) => {
  const reducedMotion = usePrefersReducedMotion();
  const firedRef = useRef(false);

  const complete = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    onComplete();
  };

  useEffect(() => {
    firedRef.current = false;
    const timer = window.setTimeout(complete, reducedMotion ? REDUCED_MOTION_FADE_MS : FALLBACK_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, reducedMotion]);

  if (reducedMotion) {
    return (
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center animate-fade-in"
        aria-hidden="true"
        data-testid="attack-animation"
        data-variant={variant}
        data-reduced-motion="true"
      >
        <span className="text-3xl opacity-70">{VARIANT_EMOJI[variant]}</span>
      </div>
    );
  }

  return (
    <div
      className={`pointer-events-none absolute inset-0 flex items-center justify-center text-5xl ${VARIANT_ANIMATION_CLASS[variant]}`}
      onAnimationEnd={complete}
      aria-hidden="true"
      data-testid="attack-animation"
      data-variant={variant}
    >
      {VARIANT_EMOJI[variant]}
    </div>
  );
};

export default AttackAnimation;
