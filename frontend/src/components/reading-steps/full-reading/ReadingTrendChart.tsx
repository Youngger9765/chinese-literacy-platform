/**
 * ReadingTrendChart — 朗讀歷史趨勢線圖 (#1597, Refs #1505).
 *
 * Young 5/8 ask: 「累積自己跟自己比的那個排行榜...一個那個線圖，就是慢慢
 * 上去都可以的」. Renders dual-axis line chart of accuracy (%) + CPM over
 * attempts so students see their own progression.
 *
 * #1633: default to the most recent DEFAULT_POINTS attempts (curve was getting
 * too crowded after 10+ practices). Students can press 「載入更多」 to
 * progressively expand back into history. MAX_POINTS still caps the absolute
 * maximum so the chart stays readable. X-axis numbers always reflect the
 * actual attempt position in full history (e.g. attempt #37 → labelled 37).
 */
import React, { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { ReadingHistoryItem } from '../../../services/readingHistoryApi';

interface ReadingTrendChartProps {
  /** Reading history items — order from caller is preserved internally. */
  history: ReadingHistoryItem[];
}

interface ChartPoint {
  attempt: number;
  accuracy: number;
  cpm: number;
  dateLabel: string;
  fullDate: string;
}

const DEFAULT_POINTS = 4;
const MAX_POINTS = 20;

function buildChartData(
  history: ReadingHistoryItem[],
  visiblePoints: number,
): ChartPoint[] {
  const sorted = [...history].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const totalAttempts = sorted.length;
  const sliceCount = Math.min(visiblePoints, totalAttempts);
  const points = sorted.slice(-sliceCount);
  const firstAttemptNo = totalAttempts - sliceCount + 1;
  return points.map((item, i) => {
    const date = new Date(item.created_at);
    const dateLabel = `${date.getMonth() + 1}/${date.getDate()}`;
    const fullDate = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    return {
      attempt: firstAttemptNo + i,
      accuracy: Math.round(item.accuracy),
      cpm: Math.round(item.cpm),
      dateLabel,
      fullDate,
    };
  });
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
}

function CustomTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-surface-container-lowest border border-surface-container-high rounded-lg shadow-md px-3 py-2 text-xs">
      <div className="font-headline font-bold text-on-surface mb-1">第 {p.attempt} 次 · {p.fullDate}</div>
      <div className="flex items-center gap-2 text-amber-700">
        <span className="w-2 h-2 rounded-full bg-amber-500" />
        正確率：<span className="font-bold">{p.accuracy}%</span>
      </div>
      <div className="flex items-center gap-2 text-blue-700">
        <span className="w-2 h-2 rounded-full bg-blue-500" />
        語速：<span className="font-bold">{p.cpm} 字/分</span>
      </div>
    </div>
  );
}

const ReadingTrendChart: React.FC<ReadingTrendChartProps> = ({ history }) => {
  const totalAttempts = history.length;
  /* #1633: start with the latest 4 attempts; 「載入更多」 unlocks more. */
  const [visiblePoints, setVisiblePoints] = useState(DEFAULT_POINTS);
  const effectiveVisible = Math.min(visiblePoints, totalAttempts, MAX_POINTS);
  const data = useMemo(
    () => buildChartData(history, effectiveVisible),
    [history, effectiveVisible],
  );

  if (data.length < 2) {
    return (
      <div className="bg-surface-container-low rounded-2xl py-6 px-4 text-center text-xs text-on-surface-variant">
        再多練幾次就會出現趨勢圖，可以看到自己慢慢進步 🚀
      </div>
    );
  }

  const totalDisplayable = Math.min(totalAttempts, MAX_POINTS);
  const expandable = effectiveVisible < totalDisplayable;
  const remaining = totalDisplayable - effectiveVisible;
  const cappedByMax = totalAttempts > MAX_POINTS;
  /* Only show the count hint when something is actually hidden — for ≤ 4
   * attempts every point is visible, so 「顯示最近 N 次」 reads awkwardly. */
  const showCountHint = totalAttempts > DEFAULT_POINTS;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider">
          進步趨勢
        </p>
        {showCountHint && (
          <span className="text-[10px] text-on-surface-variant">
            顯示最近 {effectiveVisible} 次
            {cappedByMax && `（共 ${totalAttempts} 次，最多顯示 ${MAX_POINTS} 次）`}
          </span>
        )}
      </div>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="attempt" tick={{ fontSize: 10 }} stroke="#9ca3af" />
            <YAxis
              yAxisId="accuracy"
              orientation="left"
              domain={[0, 100]}
              tick={{ fontSize: 10 }}
              stroke="#d97706"
              tickFormatter={(v) => `${v}%`}
              width={32}
            />
            <YAxis
              yAxisId="cpm"
              orientation="right"
              domain={['auto', 'auto']}
              tick={{ fontSize: 10 }}
              stroke="#2563eb"
              width={32}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
            <Line
              yAxisId="accuracy"
              type="monotone"
              dataKey="accuracy"
              name="正確率 %"
              stroke="#d97706"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
            <Line
              yAxisId="cpm"
              type="monotone"
              dataKey="cpm"
              name="語速 字/分"
              stroke="#2563eb"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {expandable && (
        <button
          type="button"
          onClick={() => setVisiblePoints((v) => Math.min(v + DEFAULT_POINTS, MAX_POINTS))}
          className="w-full text-xs font-headline text-on-surface-variant bg-surface-container-low hover:bg-surface-container rounded-full py-2 transition-colors"
        >
          載入更多（還有 {remaining} 筆{cappedByMax ? `，圖表最多顯示 ${MAX_POINTS} 筆` : ''}）
        </button>
      )}
    </div>
  );
};

export default ReadingTrendChart;
