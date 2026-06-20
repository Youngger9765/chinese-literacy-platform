/* eslint-disable no-use-before-define -- pre-existing pattern, not TDZ risk (#2289) */
import React, { useState, useEffect, useCallback } from 'react';
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
  Legend,
} from 'recharts';
import { useAuth } from '../../contexts/AuthContext';
import {
  getClassroomStats,
  getClassroomProgress,
  getStudentSessions,
  getErrorVocab,
  getTimeStats,
  getClassroomHeatmap,
  getClassroomAlerts,
  ClassroomStats,
  StudentProgress,
  StudentSession,
  ErrorVocabItem,
  TimeStats,
  ClassroomHeatmap,
  StudentAlert,
  TeacherApiError,
} from '../../services/teacherApi';
import HeatmapChart from '../../components/teacher/HeatmapChart';

interface ClassroomAnalyticsProps {
  classroomId: number;
}

// Color palette for multi-student lines
const LINE_COLORS = [
  '#5B4FC4', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
];

interface AccuracyDataPoint {
  date: string;
  [studentName: string]: string | number | null;
}

const ClassroomAnalytics: React.FC<ClassroomAnalyticsProps> = ({ classroomId }) => {
  const { token } = useAuth();
  const [stats, setStats] = useState<ClassroomStats | null>(null);
  const [errorVocab, setErrorVocab] = useState<ErrorVocabItem[]>([]);
  const [timeStats, setTimeStats] = useState<TimeStats | null>(null);
  const [heatmap, setHeatmap] = useState<ClassroomHeatmap | null>(null);
  const [accuracyData, setAccuracyData] = useState<AccuracyDataPoint[]>([]);
  const [studentNames, setStudentNames] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<StudentAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      // Fetch all data in parallel
      const [statsData, errorData, timeData, progressData, heatmapData, alertsData] = await Promise.all([
        getClassroomStats(token, classroomId),
        getErrorVocab(token, classroomId),
        getTimeStats(token, classroomId),
        getClassroomProgress(token, classroomId),
        getClassroomHeatmap(token, classroomId),
        getClassroomAlerts(token, classroomId),
      ]);

      setStats(statsData);
      setErrorVocab(errorData);
      setTimeStats(timeData);
      setHeatmap(heatmapData);
      setAlerts(alertsData);

      // Build accuracy trend data from per-student sessions
      await buildAccuracyTrend(progressData);
    } catch (err) {
      if (err instanceof TeacherApiError) {
        setError(err.message);
      } else {
        setError('無法載入分析資料');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, classroomId]);

  const buildAccuracyTrend = async (progressData: StudentProgress[]) => {
    if (!token || progressData.length === 0) {
      setAccuracyData([]);
      setStudentNames([]);
      return;
    }

    // Fetch sessions for up to 10 students (avoid too many requests)
    const studentsToShow = progressData
      .filter((s) => s.total_sessions > 0)
      .slice(0, 10);

    if (studentsToShow.length === 0) {
      setAccuracyData([]);
      setStudentNames([]);
      return;
    }

    const sessionsMap: Record<string, StudentSession[]> = {};
    const names: string[] = [];

    await Promise.all(
      studentsToShow.map(async (student) => {
        try {
          const sessions = await getStudentSessions(token, student.student_id);
          const completedWithScore = sessions.filter(
            (s) => s.status === 'completed' && s.overall_score !== null,
          );
          if (completedWithScore.length > 0) {
            sessionsMap[student.student_name] = completedWithScore;
            names.push(student.student_name);
          }
        } catch {
          // Skip students we can't load
        }
      }),
    );

    setStudentNames(names);

    // Build time-series: collect all unique dates, then map scores
    const dateScoreMap: Record<string, Record<string, number>> = {};

    for (const [name, sessions] of Object.entries(sessionsMap)) {
      for (const sess of sessions) {
        const date = new Date(sess.started_at).toLocaleDateString('zh-TW', {
          month: 'short',
          day: 'numeric',
        });
        if (!dateScoreMap[date]) dateScoreMap[date] = {};
        dateScoreMap[date][name] = Math.round(sess.overall_score!);
      }
    }

    // Sort by date
    const sortedDates = Object.keys(dateScoreMap).sort((a, b) => {
      // Parse zh-TW short date for sorting
      return a.localeCompare(b, 'zh-TW');
    });

    const chartData: AccuracyDataPoint[] = sortedDates.map((date) => {
      const point: AccuracyDataPoint = { date };
      for (const name of names) {
        point[name] = dateScoreMap[date][name] ?? null;
      }
      return point;
    });

    setAccuracyData(chartData);
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (isLoading) {
    return (
      <div className="p-5 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 bg-gray-100 animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-5">
        <div className="text-center py-6 bg-red-50 rounded-lg border border-red-200">
          <p className="text-red-700 text-sm">{error}</p>
          <button
            onClick={loadData}
            className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer"
          >
            重試
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-6">
      {/* Alert banner */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">學習預警</h3>
          {alerts.map((alert) => (
            <AlertCard key={`${alert.student_id}-${alert.alert_type}`} alert={alert} />
          ))}
        </div>
      )}

      {/* Overview cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            label="活躍學生"
            value={`${stats.active_students} / ${stats.total_students}`}
            sub="位"
          />
          <StatCard
            label="平均正確率"
            value={stats.avg_accuracy !== null ? `${stats.avg_accuracy}%` : '-'}
          />
          <StatCard
            label="完成率"
            value={`${Math.round(stats.completion_rate * 100)}%`}
          />
          <StatCard
            label="平均學習時長"
            value={
              stats.avg_session_duration_minutes !== null
                ? `${stats.avg_session_duration_minutes}`
                : '-'
            }
            sub="分鐘"
          />
        </div>
      )}

      {/* Time stats row */}
      {timeStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="總學習時數" value={`${timeStats.total_hours}`} sub="小時" />
          <StatCard label="學習天數" value={`${timeStats.study_days}`} sub="天" />
          <StatCard label="本週練習" value={`${timeStats.sessions_this_week}`} sub="次" />
          <StatCard label="上週練習" value={`${timeStats.sessions_last_week}`} sub="次" />
        </div>
      )}

      {/* Accuracy trend chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">成績趨勢</h3>
        {accuracyData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={accuracyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              {studentNames.map((name, idx) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={LINE_COLORS[idx % LINE_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-center py-8 text-gray-400 text-sm">
            尚無已完成的學習記錄
          </div>
        )}
      </div>

      {/* Heatmap: student × story performance matrix */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">班級表現矩陣（學生 × 課文）</h3>
        {heatmap ? (
          <HeatmapChart data={heatmap} />
        ) : (
          <div className="text-center py-8 text-gray-400 text-sm">
            尚無學習記錄
          </div>
        )}
      </div>

      {/* Error vocabulary bar chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          常見錯字排行（前 10）
        </h3>
        {errorVocab.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={errorVocab.slice(0, 10)}
              layout="vertical"
              margin={{ left: 30 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis
                type="category"
                dataKey="character"
                tick={{ fontSize: 14 }}
                width={40}
              />
              <Tooltip
                formatter={(value: number, name: string) => {
                  if (name === 'count') return [value, '錯誤次數'];
                  if (name === 'student_count') return [value, '學生人數'];
                  return [value, name];
                }}
              />
              <Bar dataKey="count" fill="#ef4444" name="count" radius={[0, 4, 4, 0]} />
              <Bar
                dataKey="student_count"
                fill="#f59e0b"
                name="student_count"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-center py-8 text-gray-400 text-sm">
            尚無錯字記錄
          </div>
        )}
      </div>
    </div>
  );
};

const ALERT_CONFIG: Record<
  StudentAlert['alert_type'],
  { bg: string; border: string; badge: string; badgeText: string; label: string }
> = {
  low_performance: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    badge: 'bg-red-100 text-red-700',
    badgeText: '低分預警',
    label: '查看詳情',
  },
  declining: {
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    badge: 'bg-orange-100 text-orange-700',
    badgeText: '成績下滑',
    label: '查看詳情',
  },
  inactive: {
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    badge: 'bg-gray-200 text-gray-600',
    badgeText: '未活躍',
    label: '查看詳情',
  },
};

function AlertCard({ alert }: { alert: StudentAlert }) {
  const cfg = ALERT_CONFIG[alert.alert_type];
  return (
    <div
      className={`flex items-center justify-between rounded-lg border px-4 py-3 ${cfg.bg} ${cfg.border}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className={`shrink-0 inline-block px-2 py-0.5 rounded text-xs font-medium ${cfg.badge}`}>
          {cfg.badgeText}
        </span>
        <span className="font-medium text-sm text-gray-900 truncate">{alert.student_name}</span>
        <span className="text-xs text-gray-500 hidden sm:block truncate">{alert.detail}</span>
      </div>
      <span className="text-xs text-gray-500 sm:hidden ml-2 shrink-0">{alert.detail}</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 text-center">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-gray-900">
        {value}
        {sub && <span className="text-xs font-normal text-gray-500 ml-0.5">{sub}</span>}
      </p>
    </div>
  );
}

export default ClassroomAnalytics;
