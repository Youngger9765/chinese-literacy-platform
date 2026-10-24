/**
 * PkPlayerPanel — one side of the battle/result layout: the student on the
 * left, the opponent on the right (Young 2026-10-24: the opponent portrait
 * stacked above the question took most of the screen; scores must read as
 * "whose" at a glance, so each side carries its own name, picture, score).
 *
 * `size="large"` is the side column on wide screens; `size="compact"` is the
 * one-row header on phones, where a full portrait would push the question
 * below the fold.
 */
import React from 'react';

interface PkPlayerPanelProps {
  side: 'me' | 'opponent';
  name: string;
  score: number;
  maxScore: number;
  /** Portrait/icon image; when absent a round badge with the name's first character is shown. */
  imageUrl?: string;
  isAi?: boolean;
  subtitle?: string;
  size?: 'large' | 'compact';
  /** Highlights the side that is currently ahead / won. */
  leading?: boolean;
}

const PkPlayerPanel: React.FC<PkPlayerPanelProps> = ({
  side,
  name,
  score,
  maxScore,
  imageUrl,
  isAi = false,
  subtitle,
  size = 'large',
  leading = false,
}) => {
  const pct = maxScore > 0 ? Math.min(100, Math.max(0, (score / maxScore) * 100)) : 0;
  const isMe = side === 'me';
  const barColor = isMe ? 'bg-accent' : 'bg-tertiary-container';
  const ring = leading ? (isMe ? 'ring-2 ring-accent' : 'ring-2 ring-tertiary-container') : '';
  const initial = name.trim().charAt(0) || '你';

  const picture = (cls: string) =>
    imageUrl ? (
      <img src={imageUrl} alt={name} className={`${cls} object-contain`} />
    ) : (
      <div
        aria-hidden="true"
        className={`${cls} flex items-center justify-center rounded-full ${isMe ? 'bg-accent text-white' : 'bg-tertiary-container text-tertiary'} font-extrabold`}
      >
        {initial}
      </div>
    );

  const nameLine = (
    <span className="flex items-center gap-1 truncate font-bold text-on-surface">
      {name}
      {isAi && (
        <span className="rounded-full bg-accent-bg px-1.5 py-0.5 text-[10px] font-bold text-accent">AI</span>
      )}
    </span>
  );

  const bar = (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-surface-container"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${name} 分數`}
    >
      <div className={`h-full ${barColor} transition-[width] duration-500 ease-out`} style={{ width: `${pct}%` }} />
    </div>
  );

  if (size === 'compact') {
    return (
      <div
        data-testid={`pk-panel-${side}`}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-surface-container-lowest px-2.5 py-2 shadow-sm ${ring} ${isMe ? '' : 'flex-row-reverse text-right'}`}
      >
        {picture('h-11 w-11 shrink-0')}
        <div className="min-w-0 flex-1">
          <div className={`flex items-center text-xs ${isMe ? '' : 'justify-end'}`}>{nameLine}</div>
          <div key={score} className="text-xl font-extrabold tabular-nums text-on-surface animate-pop">{score}</div>
          {bar}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={`pk-panel-${side}`}
      className={`flex w-full flex-col items-center gap-2 rounded-3xl bg-surface-container-lowest px-4 py-5 shadow-sm ${ring}`}
    >
      {picture(imageUrl ? 'h-48 w-40' : 'h-24 w-24 text-4xl')}
      <div className="text-sm">{nameLine}</div>
      {subtitle && <div className="text-xs text-on-surface-variant">{subtitle}</div>}
      <div key={score} className="text-4xl font-extrabold tabular-nums text-on-surface animate-pop">{score}</div>
      {bar}
    </div>
  );
};

export default PkPlayerPanel;
