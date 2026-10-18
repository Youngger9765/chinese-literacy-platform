/**
 * OptionGrid — the one place host and player screens each render the same
 * set of options, so they can never visually disagree on which shape/color
 * goes with which choice.
 *
 * PRD §12:
 * - Host (投影): shows shape + color + the option TEXT. Single column when
 *   any option is longer than 30 characters.
 * - Player (手機): shape + color ONLY, no text ("手機不放選項文字").
 * - Correct/wrong uses ✓/✗ + text, never color alone (colorblind-safe).
 */
import React from 'react';
import { ASSET_BASE } from '../../config/assetBase';
import type { LiveQuizOption } from '../../services/liveQuizApi';
import { shapeForOptionIndex } from './liveQuizShapes';

function resolveOptionImageUrl(url: string): string {
  return url.startsWith('/assets/') ? `${ASSET_BASE}${url.slice('/assets'.length)}` : url;
}

interface OptionGridProps {
  options: LiveQuizOption[];
  mode: 'host' | 'player';
  /** Present only after reveal. */
  correctKey?: string;
  /** This player's own submitted choice (player mode only). */
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  disabled?: boolean;
}

const OptionGrid: React.FC<OptionGridProps> = ({
  options,
  mode,
  correctKey,
  selectedKey,
  onSelect,
  disabled,
}) => {
  const singleColumn = mode === 'host' && options.some((o) => o.text.length > 30);
  const gridClass =
    options.length <= 1
      ? 'grid-cols-1'
      : singleColumn
        ? 'grid-cols-1'
        : 'grid-cols-2';

  return (
    <div className={`grid ${gridClass} gap-3 sm:gap-4 w-full`} role="group" aria-label="選項">
      {options.map((opt, i) => {
        const shape = shapeForOptionIndex(i);
        const imageUrl = opt.image ? resolveOptionImageUrl(opt.image) : null;
        const revealed = correctKey != null;
        const isCorrect = revealed && opt.key === correctKey;
        const isWrongSelected = revealed && !isCorrect && opt.key === selectedKey;
        const isSelected = !revealed && opt.key === selectedKey;

        return (
          <button
            key={opt.key}
            type="button"
            disabled={disabled || mode === 'host'}
            onClick={() => onSelect?.(opt.key)}
            aria-label={imageUrl ? `${shape.label}：圖片選項` : mode === 'player' ? `${shape.label}` : `${shape.label}：${opt.text}`}
            aria-pressed={isSelected}
            className={[
              'relative flex items-center justify-center rounded-2xl shadow-sm transition-transform',
              shape.bg,
              shape.textOnBg,
              mode === 'host' ? 'min-h-[88px] px-6 py-4 text-left' : 'min-h-[120px] sm:min-h-[140px] active:scale-95',
              isSelected ? 'ring-4 ring-white ring-offset-2 ring-offset-accent' : '',
              revealed && !isCorrect && !isWrongSelected ? 'opacity-40' : '',
              disabled && mode === 'player' ? 'cursor-not-allowed' : mode === 'player' ? 'cursor-pointer' : '',
            ].join(' ')}
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={`${shape.label}：圖片選項`}
                loading="lazy"
                className={mode === 'host' ? 'h-16 w-16 object-contain mr-4 shrink-0' : 'h-20 w-20 sm:h-28 sm:w-28 object-contain'}
              />
            ) : (
              <span
                className={mode === 'host' ? 'leading-none mr-4 shrink-0' : 'text-[56px] leading-none'}
                style={mode === 'host' ? { fontSize: 'clamp(32px, 8px + 1.875vw, 44px)' } : undefined}
                aria-hidden="true"
              >
                {shape.glyph}
              </span>
            )}
            {mode === 'host' && opt.text && (
              // PRD §12: 選項 32px（1280 寬）／44px（1920 寬）.
              <span
                className="font-medium leading-snug break-words"
                style={{ fontSize: 'clamp(32px, 8px + 1.875vw, 44px)' }}
              >
                {opt.text}
              </span>
            )}
            {revealed && (isCorrect || isWrongSelected) && (
              <span
                className="absolute -top-2 -right-2 flex h-9 w-9 items-center justify-center rounded-full bg-white text-xl font-bold shadow"
                aria-label={isCorrect ? '正確' : '錯誤'}
              >
                {isCorrect ? (
                  <span className="text-[#15803D]">✓</span>
                ) : (
                  <span className="text-on-surface-variant">✗</span>
                )}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default OptionGrid;
