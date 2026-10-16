/**
 * PkOptionButtons — PRD §3.3: "沿用 §4/§6 既有的四色四形大色塊（重用
 * live_quiz 的 liveQuizShapes.ts），本身已經是遊戲化的視覺語言；按下去要有
 * 明顯的按壓回饋（縮放 95% 再彈回，約 100–150ms）" + "答對時選項卡有一個簡短
 * 的「命中」特效".
 *
 * PK's own component (not a re-import of live-quiz's OptionGrid) because the
 * interaction language differs: full-screen game buttons, always big
 * (PK never has live-quiz's "host 投影 vs 手機" mode split), and the hit
 * effect reuses this repo's existing `animate-pop` utility rather than
 * live-quiz's plain ✓/✗ badge.
 */
import React from 'react';
import { shapeForOptionIndex } from '../live-quiz/liveQuizShapes';
import type { PkOption } from '../../services/pkApi';

interface PkOptionButtonsProps {
  options: PkOption[];
  selectedKey: string | null;
  correctKey?: string; // present only once revealed
  disabled: boolean;
  onSelect: (key: string) => void;
}

const PkOptionButtons: React.FC<PkOptionButtonsProps> = ({
  options,
  selectedKey,
  correctKey,
  disabled,
  onSelect,
}) => {
  const revealed = correctKey != null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 w-full max-w-md mx-auto" role="group" aria-label="選項">
      {options.map((opt, i) => {
        const shape = shapeForOptionIndex(i);
        const isCorrect = revealed && opt.key === correctKey;
        const isWrongSelected = revealed && !isCorrect && opt.key === selectedKey;
        const isSelected = !revealed && opt.key === selectedKey;

        return (
          <button
            key={opt.key}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(opt.key)}
            aria-label={`${shape.label}：${opt.text}`}
            aria-pressed={isSelected}
            className={[
              'relative flex min-h-[120px] sm:min-h-[140px] flex-col items-center justify-center gap-2 rounded-2xl p-3 text-center shadow-sm transition-transform duration-150',
              shape.bg,
              shape.textOnBg,
              'active:scale-95',
              isSelected ? 'ring-4 ring-white ring-offset-2 ring-offset-accent scale-105' : '',
              isCorrect ? 'animate-pop ring-4 ring-white' : '',
              revealed && !isCorrect && !isWrongSelected ? 'opacity-40' : '',
              disabled ? 'cursor-not-allowed' : 'cursor-pointer',
            ].join(' ')}
          >
            <span className="text-[40px] leading-none" aria-hidden="true">
              {shape.glyph}
            </span>
            <span className="text-base font-medium leading-snug break-words">{opt.text}</span>
            {revealed && (isCorrect || isWrongSelected) && (
              <span
                className="absolute -top-2 -right-2 flex h-9 w-9 items-center justify-center rounded-full bg-white text-xl font-bold shadow"
                aria-label={isCorrect ? '正確' : '錯誤'}
              >
                {isCorrect ? <span className="text-[#15803D]">✓</span> : <span className="text-on-surface-variant">✗</span>}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default PkOptionButtons;
