/**
 * PkHeroBanner — #3761 round 3 (after Young reviewed #3756's screenshots):
 * "現在只有一小塊紫色卡＋一個按鈕...不像遊戲。要有真正的主視覺橫幅（七位
 * 文學家並排出場或對峙構圖的插畫）". This renders all 7 PK_FIGURES in a
 * line-up, plus the "怎麼玩" 3 steps as icons instead of a bullet list.
 *
 * round 4 (Young reviewed round 3's screenshots): two real bugs here —
 * (1) the leftmost figure (駱賓王) was visibly clipped by the card's
 * rounded corner. Root cause: at this page's old `max-w-2xl` width, 7
 * figures' total row width (7 × 80px + 6 × 12px gap = 632px) slightly
 * EXCEEDS the available content width after padding, so the row actually
 * overflows — and `justify-center` on an overflowing flex row centers the
 * content as if it had the full natural width, which pushes part of the
 * FIRST item off-screen to the left with no way to scroll back to it
 * (you can only scroll toward the end, never past the start). Fixed by
 * widening the page to `max-w-4xl` (StudentPkEntry.tsx) AND switching to
 * `justify-start` (centering a horizontally-scrollable row is the wrong
 * default regardless — it's the same bug waiting to resurface at any
 * width/figure-count combination that happens to overflow).
 * (2) each figure thumb was its own inline `FigureThumb`, a second,
 * parallel copy of the exact fallback logic `PkHistoryPanel`'s roster had
 * — now both use the shared `PkFigureAvatar` (see that file's docstring).
 */
import React from 'react';
import { PK_FIGURES } from '../../data/pkFigures';
import PkFigureAvatar from './PkFigureAvatar';

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
            PK is 1-on-1 against any of the 7, not a team match).
            `justify-start` (not `-center`) — see file docstring round-4
            note: centering a row that can overflow clips/hides the first
            item with no way to scroll back to it.
            round 4 (Young: "手機版橫幅只顯示四位...要能看到全部七位"): even
            at the smallest readable circle size, 7 figures still slightly
            overflow a 390px viewport (328px of circles vs ~300px usable
            width) — rather than shrink further and hurt legibility of the
            single-character fallback labels, this keeps the row
            horizontally scrollable and adds a right-edge fade + bouncing
            chevron (mobile-only, `sm:hidden` — desktop already fits all 7
            without scrolling) as the "可捲動" affordance Young asked for. */}
        <div className="relative">
          <div className="flex items-end justify-start gap-2 overflow-x-auto px-1 sm:gap-3 sm:justify-center">
            {PK_FIGURES.map((figure) => (
              <PkFigureAvatar key={figure.slug} slug={figure.slug} name={figure.name} size="md" />
            ))}
          </div>
          <div
            className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-end bg-gradient-to-l from-[#5B4DBD] to-transparent sm:hidden"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 animate-pulse text-white/80">
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
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
