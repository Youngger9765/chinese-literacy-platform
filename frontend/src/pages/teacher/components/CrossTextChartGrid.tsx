/**
 * CrossTextChartGrid
 *
 * Renders all visual panels for cross-text analytics:
 *   - ClassOverviewPanel  (summary stats + charts for class view)
 *   - StudentDetailPanel  (charts + tables for individual student)
 *   - StudentSelector     (sidebar list for student picking)
 *
 * These were previously inline in CrossTextAnalytics.tsx.
 */
import React from 'react';
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
  Cell,
} from 'recharts';
import {
  ClassroomCrossTextPattern,
  StudentCrossTextPattern,
} from '../../../services/teacherApi';

// ── Shared helpers ─────────────────────────────────────────────────────────────

export function scoreColor(score: number | null): string {
  if (score === null) return '#5B4FC4';
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
}

export function ScoreBadge({ score }: { score: number | null }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-white text-xs font-semibold"
      style={{ backgroundColor: scoreColor(score) }}
    >
      {score !== null ? score : '--'}
    </span>
  );
}

// ── ClassOverviewPanel ─────────────────────────────────────────────────────────

interface ClassOverviewPanelProps {
  data: ClassroomCrossTextPattern;
}

export function ClassOverviewPanel({ data }: ClassOverviewPanelProps) {
  const lastTrend = data.class_score_trend[data.class_score_trend.length - 1];

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: '學生人數', value: data.total_students },
          { label: '總學習次數', value: data.total_sessions },
          { label: '已練習課文數', value: data.text_difficulty_ranking.length },
          {
            label: '最新班級均分',
            value: lastTrend ? `${lastTrend.avg_score} 分` : '--',
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-2xl p-4 text-center shadow-card"
          >
            <div className="text-2xl font-bold text-indigo-600">{stat.value}</div>
            <div className="text-sm text-gray-500 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Class score trend */}
      {data.class_score_trend.length > 1 && (
        <div className="bg-white rounded-2xl shadow-card p-5">
          <h3 className="text-base font-semibold text-gray-700 mb-4">班級整體分數趨勢</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.class_score_trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [`${v} 分`, '班級平均']} />
              <Line
                type="monotone"
                dataKey="avg_score"
                stroke="#5B4FC4"
                strokeWidth={2}
                dot={{ r: 3 }}
                name="班級平均"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Text difficulty ranking */}
      {data.text_difficulty_ranking.length > 0 && (
        <div className="bg-white rounded-2xl shadow-card p-5">
          <h3 className="text-base font-semibold text-gray-700 mb-1">課文難易排行</h3>
          <p className="text-xs text-gray-400 mb-4">依班級平均分由低到高排列</p>
          <ResponsiveContainer
            width="100%"
            height={Math.max(200, data.text_difficulty_ranking.length * 36)}
          >
            <BarChart
              data={data.text_difficulty_ranking}
              layout="vertical"
              margin={{ left: 8, right: 40, top: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="title"
                width={96}
                tick={{ fontSize: 11 }}
                tickFormatter={(v: string) =>
                  v && v.length > 6 ? `${v.slice(0, 6)}...` : v || '未知'
                }
              />
              <Tooltip
                formatter={(v: number) => [`${v} 分`, '班級平均']}
                labelFormatter={(label: string) => `課文：${label}`}
              />
              <Bar dataKey="avg_score" name="班級平均分" radius={[0, 4, 4, 0]}>
                {data.text_difficulty_ranking.map((entry, idx) => (
                  <Cell key={idx} fill={scoreColor(entry.avg_score)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-3 text-xs text-gray-500">
            <span>
              <span className="inline-block w-3 h-3 rounded-sm bg-green-500 mr-1" />
              80+ 分
            </span>
            <span>
              <span className="inline-block w-3 h-3 rounded-sm bg-amber-400 mr-1" />
              60-79 分
            </span>
            <span>
              <span className="inline-block w-3 h-3 rounded-sm bg-red-500 mr-1" />
              60 分以下
            </span>
          </div>
        </div>
      )}

      {/* Common class-level error chars */}
      {data.common_error_chars.length > 0 && (
        <div className="bg-white rounded-2xl shadow-card p-5">
          <h3 className="text-base font-semibold text-gray-700 mb-4">
            班級常見錯字（多人共同出錯）
          </h3>
          <div className="flex flex-wrap gap-2">
            {data.common_error_chars.map((item) => (
              <div
                key={item.char}
                className="flex flex-col items-center bg-red-50 border border-red-200 rounded-lg px-3 py-2 min-w-[56px]"
              >
                <span className="text-xl font-bold text-red-600">{item.char}</span>
                <span className="text-xs text-gray-500 mt-0.5">{item.student_count} 人</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── StudentDetailPanel ─────────────────────────────────────────────────────────

interface StudentDetailPanelProps {
  pattern: StudentCrossTextPattern;
}

export function StudentDetailPanel({ pattern }: StudentDetailPanelProps) {
  return (
    <div className="space-y-5">
      {/* Header stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: '已嘗試課文', value: pattern.total_texts_attempted },
          { label: '學習次數', value: pattern.total_sessions },
          {
            label: '平均分',
            value:
              pattern.overall_avg_score !== null ? `${pattern.overall_avg_score} 分` : '--',
          },
          { label: '強項課文', value: pattern.strong_texts.length },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-2xl p-3 text-center shadow-card"
          >
            <div className="text-xl font-bold text-indigo-600">{stat.value}</div>
            <div className="text-xs text-gray-500 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Score trend */}
      {pattern.score_trend.length > 1 && (
        <div className="bg-white rounded-2xl shadow-card p-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">分數學習曲線</h4>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={pattern.score_trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={(v: number) => [`${v} 分`, '分數']}
                labelFormatter={(
                  _: string,
                  payload: Array<{ payload: { title: string | null } }>,
                ) => payload?.[0]?.payload?.title || ''}
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke="#5B4FC4"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Text performance table */}
      {pattern.text_performance.length > 0 && (
        <div className="bg-white rounded-2xl shadow-card p-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">各課文學習成效</h4>
          {/* Mobile card view */}
          <div className="md:hidden space-y-3">
            {pattern.text_performance.map((tp) => (
              <div key={tp.story_slug} className="bg-white rounded-lg border border-gray-100 p-3 space-y-2">
                <div className="font-medium text-gray-700 truncate text-sm">
                  {tp.story_title || tp.story_slug}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <span className="text-xs text-gray-400">練習次數</span>
                    <p className="text-gray-600">{tp.attempt_count}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400">平均分</span>
                    <p><ScoreBadge score={tp.avg_score} /></p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400">朗讀準確率</span>
                    <p className="text-gray-600">{tp.avg_accuracy !== null ? `${tp.avg_accuracy}%` : '--'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400">閱讀理解</span>
                    <p><ScoreBadge score={tp.avg_comprehension_score} /></p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table view */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-200">
                  <th className="text-left pb-2 pr-4">課文</th>
                  <th className="text-center pb-2 px-3">練習次數</th>
                  <th className="text-center pb-2 px-3">平均分</th>
                  <th className="text-center pb-2 px-3">朗讀準確率</th>
                  <th className="text-center pb-2 px-3">閱讀理解</th>
                </tr>
              </thead>
              <tbody>
                {pattern.text_performance.map((tp) => (
                  <tr key={tp.story_slug} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-4 font-medium text-gray-700 max-w-[140px] truncate">
                      {tp.story_title || tp.story_slug}
                    </td>
                    <td className="py-2 px-3 text-center text-gray-600">
                      {tp.attempt_count}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <ScoreBadge score={tp.avg_score} />
                    </td>
                    <td className="py-2 px-3 text-center text-gray-600">
                      {tp.avg_accuracy !== null ? `${tp.avg_accuracy}%` : '--'}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <ScoreBadge score={tp.avg_comprehension_score} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cross-text recurring errors */}
      {pattern.repeated_error_chars.length > 0 && (
        <div className="bg-white rounded-2xl shadow-card p-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">
            跨課文反覆錯誤字（出現於 2 篇以上）
          </h4>
          <div className="flex flex-wrap gap-2">
            {pattern.repeated_error_chars.map((item) => (
              <div
                key={item.char}
                className="flex flex-col items-center bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 min-w-[60px]"
              >
                <span className="text-2xl font-bold text-orange-600">{item.char}</span>
                <span className="text-xs text-gray-500">{item.story_count} 篇課文</span>
                <span className="text-xs text-red-400">錯 {item.error_count} 次</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Strengths and weaknesses */}
      {(pattern.strong_texts.length > 0 || pattern.weak_texts.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pattern.strong_texts.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-green-700 mb-2">強項課文 (80+ 分)</h4>
              <ul className="space-y-1">
                {pattern.strong_texts.map((slug) => {
                  const tp = pattern.text_performance.find((t) => t.story_slug === slug);
                  return (
                    <li key={slug} className="text-sm text-green-600">
                      {tp?.story_title || slug}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {pattern.weak_texts.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-red-700 mb-2">
                待加強課文 (60 分以下)
              </h4>
              <ul className="space-y-1">
                {pattern.weak_texts.map((slug) => {
                  const tp = pattern.text_performance.find((t) => t.story_slug === slug);
                  return (
                    <li key={slug} className="text-sm text-red-600">
                      {tp?.story_title || slug}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── StudentSelector ────────────────────────────────────────────────────────────

interface StudentSelectorProps {
  students: StudentCrossTextPattern[];
  selected: number | null;
  onSelect: (id: number) => void;
}

export function StudentSelector({ students, selected, onSelect }: StudentSelectorProps) {
  return (
    <div className="w-full md:w-56 flex-shrink-0">
      <div className="bg-white rounded-2xl shadow-card overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            學生列表
          </span>
        </div>
        <ul className="divide-y divide-gray-100 max-h-[480px] overflow-y-auto">
          {students.map((s) => (
            <li key={s.student_id}>
              <button
                onClick={() => onSelect(s.student_id)}
                className={`w-full text-left px-4 py-3 hover:bg-indigo-50 transition-colors ${
                  selected === s.student_id
                    ? 'bg-indigo-50 border-l-2 border-indigo-500'
                    : ''
                }`}
              >
                <div className="text-sm font-medium text-gray-700 truncate">
                  {s.student_name}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-400">{s.total_texts_attempted} 篇</span>
                  {s.overall_avg_score !== null && (
                    <ScoreBadge score={s.overall_avg_score} />
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
