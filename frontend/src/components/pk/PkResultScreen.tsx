/**
 * PkResultScreen — PRD §3.1 step 7/8, §3.3 結果畫面, §18 review #2/#6.
 *
 * - Win/draw/loss each get a short entrance animation; loss is deliberately
 *   gentle/encouraging, never a "失敗" red/sad treatment (§3.3, §18 #2).
 * - Per-round list defaults COLLAPSED (§18 #6) — a tap expands the stem +
 *   options for that round.
 * - Three actions (§3.1 step 8): 再戰一場 / 換對手 / 返回.
 */
import React, { useState } from 'react';
import type { PkMatchResult } from '../../services/pkApi';
import { getPkFigure } from '../../data/pkFigures';

interface PkResultScreenProps {
  result: PkMatchResult;
  onRematch: () => void;
  onChangeOpponent: () => void;
  onBack: () => void;
}

const OUTCOME_COPY: Record<PkMatchResult['outcome'], { title: string; colorClass: string; animClass: string }> = {
  win: { title: '你贏了！', colorClass: 'text-success', animClass: 'animate-bounce-in' },
  draw: { title: '平手', colorClass: 'text-on-surface', animClass: 'animate-fade-in' },
  loss: { title: '再接再厲！', colorClass: 'text-tertiary', animClass: 'animate-fade-in' },
};

const PkResultScreen: React.FC<PkResultScreenProps> = ({ result, onRematch, onChangeOpponent, onBack }) => {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const copy = OUTCOME_COPY[result.outcome];
  const ratingDelta =
    result.rating_before != null && result.rating_after != null ? result.rating_after - result.rating_before : null;
  const unlockedFigure = result.newly_unlocked_tier != null ? getPkFigure(result.newly_unlocked_tier) : null;

  const toggle = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="flex min-h-screen flex-col items-center bg-surface px-5 py-8 overflow-y-auto">
      {result.outcome === 'win' && (
        <>
          <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
            <div className="absolute left-1/3 top-0 h-3 w-3 rounded-sm bg-accent animate-confetti-drop-1" />
            <div className="absolute left-1/2 top-0 h-3 w-3 rounded-sm bg-tertiary-container animate-confetti-drop-2" />
            <div className="absolute left-2/3 top-0 h-3 w-3 rounded-sm bg-success animate-confetti-drop-3" />
          </div>
        </>
      )}

      <h1 className={`text-3xl font-extrabold ${copy.colorClass} ${copy.animClass}`}>{copy.title}</h1>

      <div className="mt-4 flex items-center gap-6 text-xl font-bold text-on-surface">
        <span>{result.my_score}</span>
        <span className="text-on-surface-variant text-sm font-normal">:</span>
        <span>{result.opponent_score}</span>
      </div>

      {ratingDelta != null && (
        <p className="mt-1 text-xs text-on-surface-variant">
          積分{ratingDelta > 0 ? '上升' : ratingDelta < 0 ? '下降' : '不變'}
        </p>
      )}

      {unlockedFigure && (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-2xl bg-accent-bg px-6 py-4 animate-pop">
          <img
            src={`/pk/figures/${unlockedFigure.tier}-${unlockedFigure.slug}/icon.svg`}
            alt={unlockedFigure.name}
            className="h-16 w-16"
          />
          <p className="text-sm font-bold text-accent">解鎖人物卡：{unlockedFigure.name}</p>
        </div>
      )}

      <div className="mt-8 w-full max-w-md space-y-2">
        {result.rounds.map((r) => {
          const isOpen = expanded.has(r.round_index);
          return (
            <div key={r.round_index} className="rounded-xl border border-surface-container overflow-hidden">
              <button
                type="button"
                onClick={() => toggle(r.round_index)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <span className="text-sm font-medium text-on-surface">
                  第 {r.round_index + 1} 題：
                  {r.my_is_correct ? (
                    <span className="ml-1 text-success">✓ 答對</span>
                  ) : (
                    <span className="ml-1 text-tertiary">✗ 答錯</span>
                  )}
                </span>
                <span className="text-on-surface-variant" aria-hidden="true">
                  {isOpen ? '▲' : '▼'}
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-surface-container bg-surface-container-low px-4 py-3 text-sm">
                  <p className="mb-2 text-on-surface">{r.stem}</p>
                  <ul className="space-y-1">
                    {r.options.map((o) => (
                      <li
                        key={o.key}
                        className={
                          o.key === r.correct_key
                            ? 'font-bold text-success'
                            : o.key === r.my_choice_key
                              ? 'text-tertiary'
                              : 'text-on-surface-variant'
                        }
                      >
                        {o.key}. {o.text}
                        {o.key === r.correct_key ? '（正解）' : o.key === r.my_choice_key ? '（你的答案）' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex w-full max-w-md flex-col gap-3 pb-6">
        <button
          type="button"
          onClick={onRematch}
          className="rounded-full bg-accent px-6 py-3 text-base font-bold text-white active:scale-95"
        >
          再戰一場
        </button>
        <button
          type="button"
          onClick={onChangeOpponent}
          className="rounded-full border border-accent px-6 py-3 text-base font-bold text-accent active:scale-95"
        >
          換對手
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-full px-6 py-3 text-base font-medium text-on-surface-variant active:scale-95"
        >
          返回
        </button>
      </div>
    </div>
  );
};

export default PkResultScreen;
