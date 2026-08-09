/**
 * ReadingMetricsCard — 朗讀正確率 + 語速顯示卡片 (Issue #1505)
 *
 * Displays accuracy (正確率) and speech rate (語速 in CPM) after a reading
 * session completes.  Optionally shows a history table of past attempts.
 *
 * Design constraints (per 5/8 educator review):
 * - Show data only, no judgment text / 5-step rubric
 * - No "次數限制" — students can practice unlimited times (數位優勢)
 * - Style: amber/blue cards matching existing design system
 */

import React, { useState } from 'react';
import type { ReadingHistoryItem } from '../../../services/readingHistoryApi';
import ReadingTrendChart from './ReadingTrendChart';
import { SHOW_READING_ACCURACY } from '../../../config/readingScoreDisplay';

interface ReadingMetricsCardProps {
  /** 正確率 0–100 (integer %) */
  accuracy: number;
  /** 語速 字/分鐘 */
  cpm: number;
  /** Past attempts — caller passes API order (oldest-first); this component
   *  re-orders to newest-first for display (#1633). */
  history?: ReadingHistoryItem[];
}

const HISTORY_DEFAULT_ROWS = 4;

const ReadingMetricsCard: React.FC<ReadingMetricsCardProps> = ({ accuracy, cpm, history }) => {
  const roundedAccuracy = Math.round(accuracy);
  const roundedCpm = Math.round(cpm);

  /* #1633: table shows newest at the top, defaults to 4 rows with 「載入更多」
   * to progressively unfold older attempts. */
  const newestFirst = history && history.length > 0 ? [...history].reverse() : [];
  const [expanded, setExpanded] = useState(false);
  const visibleRowCount = expanded
    ? newestFirst.length
    : Math.min(newestFirst.length, HISTORY_DEFAULT_ROWS);
  const displayHistory = newestFirst.slice(0, visibleRowCount);
  const remaining = newestFirst.length - visibleRowCount;

  return (
    <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 space-y-4">
      {/* Section label */}
      <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider">
        這次成績
      </p>

      {/* Metric pills — 語速(流暢度) + 正確率（Issue #2568：正確率預設隱藏） */}
      <div className="flex gap-3">
        {/* 正確率 — Issue #2568: 只留流暢度，正確率隱藏（計算仍保留） */}
        {SHOW_READING_ACCURACY && (
        <div className="flex-1 flex flex-col items-center gap-1 bg-amber-50 rounded-2xl py-4 px-3 border border-amber-200">
          <span
            className="material-symbols-outlined text-amber-500 text-2xl"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            check_circle
          </span>
          <span className="text-2xl font-headline font-bold text-amber-700">
            {roundedAccuracy}%
          </span>
          <span className="text-xs font-headline text-amber-600">正確率</span>
        </div>
        )}

        {/* 語速 */}
        <div className="flex-1 flex flex-col items-center gap-1 bg-blue-50 rounded-2xl py-4 px-3 border border-blue-200">
          <span
            className="material-symbols-outlined text-blue-500 text-2xl"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            speed
          </span>
          <span className="text-2xl font-headline font-bold text-blue-700">
            {roundedCpm}
          </span>
          <span className="text-xs font-headline text-blue-600">字/分鐘</span>
        </div>
      </div>

      {/* History table — only when we have ≥ 2 past attempts. Newest at the
          top (#1633), default 4 rows then 「載入更多」. */}
      {newestFirst.length >= 2 && (
        <div>
          <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-2">
            歷史紀錄
          </p>
          <div className="divide-y divide-surface-container-high">
            {displayHistory.map((item, idx) => {
              const date = new Date(item.created_at);
              const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
              return (
                <div key={item.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-on-surface-variant font-headline">
                    {idx === 0 ? '最新' : dateStr}
                  </span>
                  <div className="flex items-center gap-4">
                    {SHOW_READING_ACCURACY && (
                      <span className="text-amber-700 font-headline font-bold">
                        {Math.round(item.accuracy)}%
                      </span>
                    )}
                    <span className="text-blue-700 font-headline font-bold">
                      {Math.round(item.cpm)} 字/分
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="w-full mt-2 text-xs font-headline text-on-surface-variant bg-surface-container-low hover:bg-surface-container rounded-full py-2 transition-colors"
            >
              載入更多（還有 {remaining} 筆）
            </button>
          )}
        </div>
      )}

      {/* #1597 Trend chart — all-history dual-axis line. Renders an inline
          encouragement message when < 2 points (the chart component handles
          its own empty state). */}
      {history && history.length > 0 && (
        <ReadingTrendChart history={history} showAccuracy={SHOW_READING_ACCURACY} />
      )}
    </div>
  );
};

export default ReadingMetricsCard;
