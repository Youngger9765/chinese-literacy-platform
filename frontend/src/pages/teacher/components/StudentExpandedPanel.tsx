import React from 'react';
import { Link } from 'react-router-dom';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { LearningCurvePoint, StudentSession } from '../../../services/teacherApi';
import { formatDate, formatScore, statusLabel } from './studentProgressUtils';

export interface AvailableStory {
  slug: string;
  title: string;
}

export interface StudentExpandedPanelProps {
  classroomId: number;
  studentId: number;
  studentName: string;
  sessions: StudentSession[];
  isLoadingSessions: boolean;
  sessionsError: string | null;
  learningCurve: LearningCurvePoint[];
  isLoadingCurve: boolean;
  curveError: string | null;
  curveStoryFilter: string;
  availableStories: AvailableStory[];
  loadingDialogueSessionId: number | null;
  onCurveStoryFilterChange: (value: string) => void;
  onViewDialogue: (
    studentId: number,
    sessionId: number,
    storyTitle: string | null,
    studentName: string,
  ) => void;
  variant?: 'mobile' | 'desktop';
}

function buildCurveChartData(points: LearningCurvePoint[]) {
  return points.map((point, index) => {
    const windowStart = Math.max(0, index - 4);
    const windowSlice = points.slice(windowStart, index + 1);
    const rollingAvg = windowSlice.reduce((sum, item) => sum + item.score, 0) / windowSlice.length;
    return {
      date: new Date(point.date).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' }),
      score: point.score,
      rollingAvg: Math.round(rollingAvg * 10) / 10,
      story_title: point.story_title,
      cpm: point.cpm,
      accuracy: point.accuracy,
    };
  });
}

const chartLegendFormatter = (value: string) => {
  if (value === 'score') return '實際分數';
  if (value === 'rollingAvg') return '5次均線';
  if (value === 'cpm') return '語速';
  if (value === 'accuracy') return '準確度';
  return value;
};

const chartTooltipFormatter = (value: number, name: string) => {
  if (name === 'score') return [value, '實際分數'];
  if (name === 'rollingAvg') return [value, '5次均線'];
  if (name === 'cpm') return [`${value} 字/分`, '語速'];
  if (name === 'accuracy') return [`${value}%`, '準確度'];
  return [value, name];
};

export const StudentExpandedPanel: React.FC<StudentExpandedPanelProps> = ({
  classroomId,
  studentId,
  studentName,
  sessions,
  isLoadingSessions,
  sessionsError,
  learningCurve,
  isLoadingCurve,
  curveError,
  curveStoryFilter,
  availableStories,
  loadingDialogueSessionId,
  onCurveStoryFilterChange,
  onViewDialogue,
  variant = 'desktop',
}) => {
  void classroomId;

  const renderChart = () => {
    if (isLoadingCurve) {
      return <div className="h-40 bg-gray-200 animate-pulse rounded" />;
    }

    if (curveError) {
      return (
        <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          <span>學習曲線載入失敗：收合後再展開重試</span>
        </div>
      );
    }

    if (learningCurve.length < 2) return null;

    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-gray-500">學習曲線</p>
          {availableStories.length > 1 && (
            <select
              value={curveStoryFilter}
              onChange={(event) => onCurveStoryFilterChange(event.target.value)}
              className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-600"
            >
              <option value="">全部課文</option>
              {availableStories.map((story) => (
                <option key={story.slug} value={story.slug}>{story.title}</option>
              ))}
            </select>
          )}
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={buildCurveChartData(learningCurve)}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={28} />
            <Tooltip
              formatter={chartTooltipFormatter}
              labelFormatter={(label) => `日期：${label}`}
            />
            <Legend formatter={chartLegendFormatter} />
            <Line type="monotone" dataKey="score" stroke="#5B4FC4" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            <Line type="monotone" dataKey="rollingAvg" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="5 3" connectNulls />
            {curveStoryFilter && (
              <>
                <Line type="monotone" dataKey="cpm" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="accuracy" stroke="#ef4444" strokeWidth={1} dot={{ r: 2 }} strokeDasharray="4 2" connectNulls />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const renderMobileSessions = () => {
    if (isLoadingSessions) {
      return (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-16 bg-gray-200 animate-pulse rounded-lg" />
          ))}
        </div>
      );
    }

    if (sessionsError) {
      return (
        <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          <span>練習紀錄載入失敗：收合後再展開重試</span>
        </div>
      );
    }

    if (sessions.length === 0) {
      return <p className="text-xs text-gray-500 text-center py-2">尚無練習記錄</p>;
    }

    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-500">練習記錄</p>
        {sessions.map((session) => {
          const reviewedAt = (session as StudentSession & { teacher_reviewed_at?: string | null }).teacher_reviewed_at;
          return (
            <div key={session.id} className="bg-white rounded-lg border border-gray-100 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-700 text-sm truncate">{session.story_title ?? '-'}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {statusLabel(session.status)}
                  {reviewedAt && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200" title="已查看">
                      ✓ 已查看
                    </span>
                  )}
                  <Link
                    to={`/teacher/students/${studentId}/sessions/${session.id}/report`}
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-accent border border-accent/30 hover:bg-accent-bg transition-colors"
                    title="查看學習報告"
                  >
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    報告
                  </Link>
                  <button
                    type="button"
                    disabled={loadingDialogueSessionId === session.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onViewDialogue(studentId, session.id, session.story_title, studentName);
                    }}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-accent border border-accent/30 hover:bg-accent-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="查看蘇格拉底對話記錄"
                  >
                    {loadingDialogueSessionId === session.id ? (
                      <span className="w-2.5 h-2.5 border border-accent border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    )}
                    對話
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                <div>
                  <span className="text-gray-400">日期</span>
                  <p className="text-gray-600">{formatDate(session.started_at)}</p>
                </div>
                <div>
                  <span className="text-gray-400">分數</span>
                  <p className="text-gray-700 font-medium">{formatScore(session.overall_score)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderDesktopSessions = () => {
    if (isLoadingSessions) {
      return (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex gap-4">
              <div className="h-3 bg-gray-200 animate-pulse rounded w-1/3" />
              <div className="h-3 bg-gray-200 animate-pulse rounded w-1/5" />
              <div className="h-3 bg-gray-200 animate-pulse rounded w-1/6" />
              <div className="h-3 bg-gray-200 animate-pulse rounded w-1/6" />
            </div>
          ))}
        </div>
      );
    }

    if (sessionsError) {
      return (
        <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          <span>練習紀錄載入失敗：收合後再展開重試</span>
        </div>
      );
    }

    if (sessions.length === 0) {
      return <p className="text-xs text-gray-500 text-center py-2">尚無練習記錄</p>;
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-400">
              <th className="pb-1.5 font-medium">課文</th>
              <th className="pb-1.5 font-medium">日期</th>
              <th className="pb-1.5 font-medium text-center">分數</th>
              <th className="pb-1.5 font-medium text-center">狀態</th>
              <th className="pb-1.5 font-medium text-center">報告</th>
              <th className="pb-1.5 font-medium text-center">對話</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sessions.map((session) => {
              const reviewedAt = (session as StudentSession & { teacher_reviewed_at?: string | null }).teacher_reviewed_at;
              return (
                <tr key={session.id}>
                  <td className="py-1.5 text-gray-700">{session.story_title ?? '-'}</td>
                  <td className="py-1.5 text-gray-500">{formatDate(session.started_at)}</td>
                  <td className="py-1.5 text-gray-700 text-center font-medium">{formatScore(session.overall_score)}</td>
                  <td className="py-1.5 text-center">{statusLabel(session.status)}</td>
                  <td className="py-1.5 text-center">
                    <Link
                      to={`/teacher/students/${studentId}/sessions/${session.id}/report`}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-accent border border-accent/30 hover:bg-accent-bg transition-colors"
                      title="查看學習報告"
                    >
                      {reviewedAt ? '✓ 報告' : '報告'}
                    </Link>
                  </td>
                  <td className="py-1.5 text-center">
                    <button
                      type="button"
                      disabled={loadingDialogueSessionId === session.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        onViewDialogue(studentId, session.id, session.story_title, studentName);
                      }}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-accent border border-accent/30 hover:bg-accent-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      title="查看蘇格拉底對話記錄"
                    >
                      {loadingDialogueSessionId === session.id ? (
                        <span className="w-2.5 h-2.5 border border-accent border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      )}
                      對話
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className={variant === 'mobile' ? 'mt-2 bg-gray-50 rounded-lg p-3 space-y-4' : 'space-y-4'}>
      {renderChart()}
      {variant === 'mobile' ? renderMobileSessions() : renderDesktopSessions()}
    </div>
  );
};

export default StudentExpandedPanel;
