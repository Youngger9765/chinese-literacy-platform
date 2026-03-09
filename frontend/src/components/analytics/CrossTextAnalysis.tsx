/**
 * CrossTextAnalysis — student-facing cross-text learning pattern component.
 *
 * Displays:
 *   - Performance summary by text genre and category
 *   - Vocabulary growth timeline
 *   - Difficulty progression across completed texts
 *   - Recurring error characters
 *
 * Issue #253
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useAuth } from '../../contexts/AuthContext';
import {
  getCrossTextAnalysis,
  CrossTextAnalysisResult,
  CrossTextGenreEntry,
} from '../../services/api';

interface CrossTextAnalysisProps {
  studentId: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
}

function ScorePill({ score }: { score: number | null }) {
  if (score === null) return <span className="text-gray-400 text-sm">--</span>;
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-white text-xs font-semibold"
      style={{ backgroundColor: scoreColor(score) }}
    >
      {score}
    </span>
  );
}

// ── Genre/Category Bar Chart ───────────────────────────────────────────────

interface GenreChartProps {
  data: CrossTextGenreEntry[];
  title: string;
}

function GenreChart({ data, title }: GenreChartProps) {
  if (data.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-sm">尚無資料</div>
    );
  }

  const chartData = data.map((d) => ({
    name: d.label,
    分數: d.avg_score,
    次數: d.attempts,
  }));

  return (
    <div>
      <p className="text-sm font-semibold text-gray-700 mb-2">{title}</p>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(value: number, name: string) =>
              name === '分數' ? [`${value} 分`, '平均分數'] : [`${value} 次`, '練習次數']
            }
          />
          <Bar
            dataKey="分數"
            fill="#6366f1"
            radius={[3, 3, 0, 0]}
            maxBarSize={40}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Vocabulary Growth Timeline ─────────────────────────────────────────────

function VocabGrowthChart({ data }: { data: CrossTextAnalysisResult['vocabulary_growth'] }) {
  if (data.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-sm">尚無詞彙資料</div>
    );
  }

  const chartData = data.map((d) => ({
    課文: d.text_title.length > 6 ? d.text_title.slice(0, 6) + '…' : d.text_title,
    累積詞彙: d.cumulative_words,
    新詞: d.new_words,
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="課文" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Line
          type="monotone"
          dataKey="累積詞彙"
          stroke="#6366f1"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Difficulty Progression Chart ──────────────────────────────────────────

function DifficultyProgressionChart({
  data,
}: {
  data: CrossTextAnalysisResult['difficulty_progression'];
}) {
  if (data.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-sm">尚無進度資料</div>
    );
  }

  const chartData = data.map((d) => ({
    課文: d.text_title.length > 6 ? d.text_title.slice(0, 6) + '…' : d.text_title,
    分數: d.score,
    年級: d.grade,
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="課文" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(value: number | null) =>
            value !== null ? [`${value} 分`, '得分'] : ['--', '得分']
          }
        />
        <Line
          type="monotone"
          dataKey="分數"
          stroke="#10b981"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

const CrossTextAnalysis: React.FC<CrossTextAnalysisProps> = ({ studentId }) => {
  const { token } = useAuth();
  const [data, setData] = useState<CrossTextAnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const result = await getCrossTextAnalysis(token, studentId);
      setData(result);
    } catch {
      setError('無法載入跨課文分析資料');
    } finally {
      setIsLoading(false);
    }
  }, [token, studentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
        載入跨課文分析中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
        {error}
      </div>
    );
  }

  if (!data) return null;

  if (!data.has_enough_data) {
    return (
      <div className="rounded-lg bg-blue-50 border border-blue-200 p-6 text-center">
        <p className="text-blue-700 font-medium">需要更多學習記錄</p>
        <p className="text-blue-600 text-sm mt-1">
          目前已完成 {data.total_completed_texts} 篇課文。完成至少 2 篇課文後，即可查看跨課文學習模式分析。
        </p>
      </div>
    );
  }

  const { summary, text_type_performance, vocabulary_growth, difficulty_progression, common_error_patterns } = data;

  return (
    <div className="space-y-6">
      {/* Summary Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
          <p className="text-2xl font-bold text-indigo-600">{data.total_completed_texts}</p>
          <p className="text-xs text-gray-500 mt-0.5">已完成課文</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
          <p className="text-2xl font-bold text-emerald-600">{summary.total_vocabulary_words}</p>
          <p className="text-xs text-gray-500 mt-0.5">累積詞彙量</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
          <p className="text-lg font-bold text-indigo-600 truncate">{summary.strongest_genre ?? '--'}</p>
          <p className="text-xs text-gray-500 mt-0.5">最強文體</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
          <p className="text-xl font-bold text-amber-500">{summary.recurring_error_chars}</p>
          <p className="text-xs text-gray-500 mt-0.5">反覆錯誤字</p>
        </div>
      </div>

      {/* Genre & Category Performance */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">各文體表現</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <GenreChart data={text_type_performance.by_genre} title="依文體" />
          <GenreChart data={text_type_performance.by_category} title="依類別" />
        </div>
      </div>

      {/* Vocabulary Growth */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-2">詞彙累積成長</h3>
        <VocabGrowthChart data={vocabulary_growth} />
      </div>

      {/* Difficulty Progression */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-2">各課文得分趨勢</h3>
        <DifficultyProgressionChart data={difficulty_progression} />
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-1 pr-4 text-gray-500 font-medium">課文</th>
                <th className="text-left py-1 pr-4 text-gray-500 font-medium">文體</th>
                <th className="text-left py-1 pr-4 text-gray-500 font-medium">年級</th>
                <th className="text-left py-1 text-gray-500 font-medium">得分</th>
              </tr>
            </thead>
            <tbody>
              {difficulty_progression.map((row, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1 pr-4 text-gray-700 max-w-[120px] truncate">{row.text_title}</td>
                  <td className="py-1 pr-4 text-gray-600">{row.genre ?? '--'}</td>
                  <td className="py-1 pr-4 text-gray-600">{row.grade ? `${row.grade} 年級` : '--'}</td>
                  <td className="py-1"><ScorePill score={row.score} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recurring Error Characters */}
      {common_error_patterns.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">反覆出現的錯誤字</h3>
          <div className="flex flex-wrap gap-2">
            {common_error_patterns.map((err) => (
              <div
                key={err.character}
                className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5"
                title={`出現 ${err.text_count} 篇課文，共 ${err.error_count} 次錯誤`}
              >
                <span className="text-lg font-bold text-red-700">{err.character}</span>
                <div className="text-xs text-red-500">
                  <div>{err.text_count} 篇</div>
                  <div>{err.error_count} 次</div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            以上字在 2 篇以上課文中重複出現錯誤，建議加強練習。
          </p>
        </div>
      )}
    </div>
  );
};

export default CrossTextAnalysis;
