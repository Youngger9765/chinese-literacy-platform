/**
 * ReadingProgressChart — Line chart showing CPM and accuracy progress over attempts.
 *
 * Uses recharts. Shows:
 * - CPM line (primary, blue)
 * - Accuracy line (secondary, green)
 * - Target CPM reference line (dashed red)
 * - Encouragement message
 *
 * Issue #909: 重複朗讀 + 進步曲線
 */
import React, { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useAuth } from '../../contexts/AuthContext';
import {
  getReadingHistory,
  getReadingSummary,
  type ReadingHistoryItem,
  type ReadingProgressSummary,
} from '../../services/readingHistoryApi';

interface ReadingProgressChartProps {
  studentId: number;
  lessonId: string;
  readingType?: 'full' | 'paragraph';
  paragraphIndex?: number;
  /** Compact mode hides the summary text below the chart */
  compact?: boolean;
  /** Called when summary data loads (parent can use encouragement message) */
  onSummaryLoad?: (summary: ReadingProgressSummary) => void;
}

interface ChartDataPoint {
  attempt: number;
  cpm: number;
  accuracy: number;
  date: string;
}

const ReadingProgressChart: React.FC<ReadingProgressChartProps> = ({
  studentId,
  lessonId,
  readingType = 'full',
  paragraphIndex,
  compact = false,
  onSummaryLoad,
}) => {
  const { token } = useAuth();
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [targetCpm, setTargetCpm] = useState(90);
  const [summary, setSummary] = useState<ReadingProgressSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !studentId || !lessonId) return;

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [historyRes, summaryRes] = await Promise.all([
          getReadingHistory(studentId, lessonId, token, readingType, paragraphIndex),
          getReadingSummary(studentId, lessonId, token, readingType),
        ]);

        if (cancelled) return;

        const points: ChartDataPoint[] = historyRes.history.map(
          (item: ReadingHistoryItem, idx: number) => ({
            attempt: idx + 1,
            cpm: Math.round(item.cpm),
            accuracy: Math.round(item.accuracy),
            date: new Date(item.created_at).toLocaleDateString('zh-TW', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }),
          }),
        );

        setData(points);
        setTargetCpm(historyRes.target_cpm);
        setSummary(summaryRes);
        onSummaryLoad?.(summaryRes);
      } catch (err) {
        console.error('Failed to load reading progress:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [studentId, lessonId, token, readingType, paragraphIndex, onSummaryLoad]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-400">
        <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        載入中...
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500">
        <p className="text-lg">還沒有朗讀紀錄</p>
        <p className="text-sm mt-1">完成朗讀後，進步曲線會顯示在這裡</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          朗讀進步曲線
          {data.length > 1 && summary && (
            <span className={`ml-2 text-xs font-normal ${
              summary.cpm_improvement_pct > 0 ? 'text-green-600' : 'text-gray-500'
            }`}>
              {summary.cpm_improvement_pct > 0 ? '▲' : summary.cpm_improvement_pct < 0 ? '▼' : ''}
              {Math.abs(summary.cpm_improvement_pct).toFixed(0)}% 速度變化
            </span>
          )}
        </h3>

        <ResponsiveContainer width="100%" height={compact ? 180 : 240}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="attempt"
              label={{ value: '第 N 次', position: 'insideBottomRight', offset: -5, fontSize: 12 }}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              yAxisId="cpm"
              label={{ value: '字/分鐘', angle: -90, position: 'insideLeft', fontSize: 12 }}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              yAxisId="accuracy"
              orientation="right"
              domain={[0, 100]}
              label={{ value: '準確率%', angle: 90, position: 'insideRight', fontSize: 12 }}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              formatter={(value: number, name: string) => {
                if (name === 'cpm') return [`${value} 字/分鐘`, '閱讀速度'];
                return [`${value}%`, '準確率'];
              }}
              labelFormatter={(label: number) => `第 ${label} 次朗讀`}
              contentStyle={{ fontSize: 13, borderRadius: 8 }}
            />
            <Legend
              formatter={(value: string) => (value === 'cpm' ? '閱讀速度' : '準確率')}
              wrapperStyle={{ fontSize: 12 }}
            />

            {/* Target CPM reference line */}
            <ReferenceLine
              yAxisId="cpm"
              y={targetCpm}
              stroke="#ef4444"
              strokeDasharray="6 3"
              label={{
                value: `目標 ${targetCpm}`,
                position: 'right',
                fill: '#ef4444',
                fontSize: 11,
              }}
            />

            {/* CPM line */}
            <Line
              yAxisId="cpm"
              type="monotone"
              dataKey="cpm"
              stroke="#3b82f6"
              strokeWidth={2.5}
              dot={{ r: 4, fill: '#3b82f6' }}
              activeDot={{ r: 6 }}
              name="cpm"
            />

            {/* Accuracy line */}
            <Line
              yAxisId="accuracy"
              type="monotone"
              dataKey="accuracy"
              stroke="#22c55e"
              strokeWidth={2}
              dot={{ r: 3, fill: '#22c55e' }}
              strokeDasharray="4 2"
              name="accuracy"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Summary stats */}
      {!compact && summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="朗讀次數" value={String(summary.total_attempts)} />
          <StatCard
            label="最佳速度"
            value={`${summary.best_cpm} 字/分`}
            highlight={summary.target_reached}
          />
          <StatCard
            label="最新速度"
            value={`${summary.latest_cpm} 字/分`}
          />
          <StatCard
            label="最佳準確率"
            value={`${summary.best_accuracy}%`}
          />
        </div>
      )}

      {/* Encouragement */}
      {summary && (
        <div className={`rounded-lg px-4 py-3 text-sm ${
          summary.target_reached
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-blue-50 text-blue-700 border border-blue-200'
        }`}>
          {summary.target_reached && <span className="mr-1">🎉</span>}
          {summary.encouragement}
        </div>
      )}
    </div>
  );
};

function StatCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg px-3 py-2 text-center border ${
        highlight
          ? 'bg-green-50 border-green-200'
          : 'bg-gray-50 border-gray-200'
      }`}
    >
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-base font-semibold mt-0.5 ${
        highlight ? 'text-green-700' : 'text-gray-800'
      }`}>
        {value}
      </div>
    </div>
  );
}

export default ReadingProgressChart;
