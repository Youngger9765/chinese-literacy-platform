/**
 * PkFigureIntro — PRD §10: AI 對手人物生平小動畫.
 *
 * - §10.1: skip button visible from frame 1, never blocks the match start.
 * - §10.2: first encounter -> full version (10–15s, all 3 beats); a repeat
 *   encounter -> condensed version (3–5s, one beat + the quote only).
 * - §10.3: "傳說"/"信史" beats are tagged and rendered with a visible badge
 *   — never presented as settled fact when the source itself hedges.
 * - §10.4: `prefers-reduced-motion` -> static card + text, fixed dwell
 *   (here: the condensed content) or "繼續" button, no animated transitions.
 *   Captions always on (no audio narration at all, so there's nothing to
 *   silence).
 */
import React, { useEffect, useRef, useState } from 'react';
import type { PkFigure } from '../../data/pkFigures';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

interface PkFigureIntroProps {
  figure: PkFigure;
  /** PRD §10.2 — true on first-ever encounter (full version), false on a
   * repeat (condensed version). */
  firstTime: boolean;
  onDone: () => void;
}

const BEAT_DURATION_MS = 3500;
const REDUCED_MOTION_DWELL_MS = 6000; // PRD §10.4: "停留時間固定（例如 6 秒）或等使用者按「繼續」"

const PkFigureIntro: React.FC<PkFigureIntroProps> = ({ figure, firstTime, onDone }) => {
  const reducedMotion = usePrefersReducedMotion();
  const beats = firstTime ? figure.bio : [figure.bio[0]];
  const [beatIndex, setBeatIndex] = useState(0);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };

  useEffect(() => {
    if (reducedMotion) {
      const t = window.setTimeout(finish, REDUCED_MOTION_DWELL_MS);
      return () => window.clearTimeout(t);
    }
    if (beatIndex >= beats.length) {
      finish();
      return undefined;
    }
    const t = window.setTimeout(() => setBeatIndex((i) => i + 1), BEAT_DURATION_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatIndex, reducedMotion]);

  const portraitUrl = `/pk/figures/${figure.tier}-${figure.slug}/portrait-idle.svg`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-surface px-6 py-8">
      <button
        type="button"
        onClick={finish}
        className="absolute right-4 top-4 z-10 rounded-full bg-surface-container px-4 py-2 text-sm font-semibold text-on-surface shadow active:scale-95"
      >
        跳過
      </button>

      <div className={`flex flex-col items-center gap-4 max-w-sm text-center ${reducedMotion ? '' : 'animate-fade-in'}`}>
        <img src={portraitUrl} alt={figure.name} className="h-40 w-40 sm:h-56 sm:w-56 object-contain" />
        <h2 className="text-xl font-bold text-on-surface">
          {figure.name}
          <span className="ml-2 text-sm font-normal text-on-surface-variant">{figure.epithet}・{figure.years}</span>
        </h2>

        {reducedMotion ? (
          <div className="space-y-3">
            <p className="text-base text-on-surface">
              {beats[0].text}
              {beats[0].kind === 'legend' && (
                <span className="ml-1 rounded bg-accent-bg px-1.5 py-0.5 text-xs font-bold text-accent">傳說</span>
              )}
            </p>
            <p className="text-sm italic text-on-surface-variant">「{figure.quote.text}」—— {figure.quote.work}</p>
          </div>
        ) : beatIndex < beats.length ? (
          <p key={beatIndex} className="text-base text-on-surface animate-fade-in">
            {beats[beatIndex].text}
            {beats[beatIndex].kind === 'legend' && (
              <span className="ml-1 rounded bg-accent-bg px-1.5 py-0.5 text-xs font-bold text-accent">傳說</span>
            )}
          </p>
        ) : (
          <p className="text-sm italic text-on-surface-variant animate-fade-in">
            「{figure.quote.text}」—— {figure.quote.work}
          </p>
        )}

        {reducedMotion && (
          <button
            type="button"
            onClick={finish}
            className="mt-2 rounded-full bg-accent px-6 py-2 text-sm font-bold text-white active:scale-95"
          >
            繼續
          </button>
        )}
      </div>
    </div>
  );
};

export default PkFigureIntro;
