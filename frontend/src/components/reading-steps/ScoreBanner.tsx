/**
 * ScoreBanner.tsx
 *
 * End-of-game score screen for ZhuyinPhoneticGame.
 * Shows percentage bar, encouragement, retry and finish buttons.
 *
 * Extracted from ZhuyinPhoneticGame.tsx as part of refactor/issue-1885.
 */

import React from 'react';

export interface ScoreBannerProps {
  score: number;
  total: number;
  onFinish: () => void;
  onRetry: () => void;
}

export function ScoreBanner({ score, total, onFinish, onRetry }: ScoreBannerProps) {
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const isGreat = pct >= 80;

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-indigo-50 px-6 py-10">
      <div className="max-w-sm w-full bg-white rounded-3xl shadow-lg border border-indigo-100 p-8 flex flex-col items-center gap-5 text-center">
        <div className="text-5xl select-none">{isGreat ? '🌟' : '💪'}</div>
        <div>
          <h3 className="text-2xl font-bold text-gray-900">
            {isGreat ? '太厲害了！' : '繼續加油！'}
          </h3>
          <p className="text-gray-500 text-sm mt-1">
            {isGreat ? '幾乎全對，超級棒！' : '有答對一些，再試一次會更好'}
          </p>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${isGreat ? 'bg-emerald-500' : 'bg-indigo-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="w-full flex flex-col gap-3 mt-2">
          <button
            onClick={onRetry}
            className="w-full py-2.5 rounded-full font-bold text-sm bg-indigo-600 hover:bg-indigo-500 text-white shadow transition-all active:scale-95"
          >
            再玩一次
          </button>
          <button
            onClick={onFinish}
            className="w-full py-2.5 rounded-full font-semibold text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-all active:scale-95"
          >
            返回生字練習
          </button>
        </div>
      </div>
    </div>
  );
}
