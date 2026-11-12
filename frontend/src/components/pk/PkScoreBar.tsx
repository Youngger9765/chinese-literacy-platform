/**
 * PkScoreBar — PRD §3.3: "雙方各有一條動畫分數條（視覺上像遊戲的經驗/進度
 * 條），答對時用填滿動畫往上跳" — deliberately a FILL bar, not an HP/health
 * bar that depletes ("不需要「扣血」這種對抗性視覺").
 */
import React from 'react';

interface PkScoreBarProps {
  label: string;
  score: number;
  maxScore: number;
  colorClass?: string; // Tailwind bg-* class
  avatarUrl?: string;
  isAi?: boolean;
}

const PkScoreBar: React.FC<PkScoreBarProps> = ({
  label,
  score,
  maxScore,
  colorClass = 'bg-accent',
  avatarUrl,
  isAi = false,
}) => {
  const pct = maxScore > 0 ? Math.min(100, Math.max(0, (score / maxScore) * 100)) : 0;

  return (
    <div className="flex items-center gap-2 w-full">
      {avatarUrl && (
        <img
          src={avatarUrl}
          alt=""
          aria-hidden="true"
          className="h-8 w-8 rounded-full border-2 border-surface-container-lowest shrink-0 object-cover"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs font-medium text-on-surface-variant mb-0.5">
          <span className="truncate flex items-center gap-1">
            {label}
            {isAi && (
              <span className="rounded-full bg-accent-bg px-1.5 py-0.5 text-[10px] font-bold text-accent">
                AI
              </span>
            )}
          </span>
          <span className="tabular-nums">{score}</span>
        </div>
        <div className="h-3 w-full rounded-full bg-surface-container overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${label} 分數`}>
          <div
            className={`h-full ${colorClass} transition-[width] duration-500 ease-out`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default PkScoreBar;
