/**
 * PkHeroBanner — #3761 (round 3 after Young reviewed #3756's screenshots):
 * "現在只有一小塊紫色卡＋一個按鈕...不像遊戲。要有真正的主視覺橫幅（七位
 * 文學家並排出場或對峙構圖的插畫）". This renders all 7 PK_FIGURES in a
 * line-up, plus the "怎麼玩" 3 steps as icons instead of a bullet list.
 *
 * Does NOT touch `pkFigures.ts`'s `PK_PNG_ART_OVERRIDE` (that map still
 * only points tier 7/李白 at its PNG set — switching the other 6 tiers
 * over is a separate in-flight workstream, #3745/pk-avatars) and does NOT
 * read through `pkFigurePortraitUrl()` for that reason (it would return
 * the OLD placeholder SVGs for tiers 1-6). Instead this builds the PNG
 * path directly from each figure's `slug` — the same `story-assets/pk-
 * {slug}/portrait-idle.png` convention #3745 already established for
 * 李白, so it picks up each figure's real art automatically the moment
 * pk-avatars commits it, with zero coordination and zero risk of
 * clobbering their file. Until a given figure's PNG lands, `FigureThumb`
 * below falls back to a generic initial-circle (same pattern used
 * elsewhere in this app for a missing avatar, e.g. Sidebar.tsx's
 * `user.name.charAt(0)`) — never a broken-image icon.
 */
import React, { useState } from 'react';
import { PK_FIGURES } from '../../data/pkFigures';

const FigureThumb: React.FC<{ slug: string; name: string }> = ({ slug, name }) => {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-white/70 bg-white/20 text-lg font-bold text-white sm:h-20 sm:w-20"
        aria-hidden="true"
      >
        {name.charAt(0)}
      </div>
    );
  }
  return (
    <img
      src={`/story-assets/pk-${slug}/portrait-idle.png`}
      alt=""
      aria-hidden="true"
      onError={() => setBroken(true)}
      className="h-16 w-16 shrink-0 rounded-full border-2 border-white/70 bg-white/20 object-cover object-top sm:h-20 sm:w-20"
    />
  );
};

const STEPS: { icon: React.ReactNode; text: string }[] = [
  {
    // stopwatch — "5 題搶答"
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
        <circle cx="12" cy="13" r="8" stroke="currentColor" strokeWidth="2" />
        <path d="M12 9v4l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M9 2h6M12 2v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    text: '5 題搶答，答得又對又快分數越高',
  },
  {
    // balance/scale — "平手比速度"
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
        <path d="M12 3v18M7 21h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M4 7h6M14 7h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M4 7l-2 4a2 2 0 0 0 4 0l-2-4ZM20 7l-2 4a2 2 0 0 0 4 0l-2-4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    ),
    text: '平手時看誰總作答時間比較快',
  },
  {
    // trophy/unlock card — "打贏解鎖"
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
        <path d="M6 4h12v4a6 6 0 0 1-12 0V4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M4 5H3a2 2 0 0 0 2 4M20 5h1a2 2 0 0 1-2 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 14v3M9 20h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    text: '打贏文學家可以解鎖他的人物卡',
  },
];

const PkHeroBanner: React.FC = () => {
  return (
    <div className="w-full overflow-hidden rounded-3xl bg-gradient-to-br from-[#8B7FD1] to-[#5B4DBD] shadow-sm">
      <div className="px-5 pb-4 pt-6 sm:px-8 sm:pt-8">
        {/* 七位文學家並排出場 — line-up composition, not a confrontation
            pose (no art direction asked for one side-vs-other split, and
            PK is 1-on-1 against any of the 7, not a team match). */}
        <div className="flex items-end justify-center gap-2 overflow-x-auto px-1 sm:gap-3">
          {PK_FIGURES.map((figure) => (
            <FigureThumb key={figure.slug} slug={figure.slug} name={figure.name} />
          ))}
        </div>
        <h1 className="mt-4 text-center text-2xl font-bold text-white sm:text-3xl">PK 對戰</h1>
        <p className="mt-1 text-center text-sm text-white/90">一對一，隨時挑戰同學或文學家</p>
      </div>
      <div className="bg-white/10 px-5 py-4 sm:px-8">
        <p className="mb-2 text-center text-xs font-bold uppercase tracking-wide text-white/80 sm:text-left">
          怎麼玩？
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <div key={i} className="flex items-center gap-2 text-white sm:flex-col sm:text-center">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
              {step.icon}
            </span>
            <span className="text-xs text-white/90 sm:mt-1">{step.text}</span>
          </div>
        ))}
        </div>
      </div>
    </div>
  );
};

export default PkHeroBanner;
