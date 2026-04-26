/**
 * StudentProgressDashboard — progress stats + learning curve chart.
 *
 * Shows:
 * - Streak, total completed, weekly count, avg score
 * - 30-day learning activity chart (Recharts ResponsiveLineChart)
 *
 * Issue #25
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { useAuth } from '../../contexts/AuthContext';
import { fetchStudentDashboard, StudentDashboardData } from '../../services/learningApi';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ── Stat card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  highlight?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, sub, icon, highlight }) => (
  <div
    className={`rounded-2xl p-4 flex items-start gap-3 ${
      highlight
        ? 'bg-gradient-to-br from-accent to-accent-hover text-white shadow-sm'
        : 'bg-surface-container-lowest border border-[#E5E0D5]'
    }`}
  >
    <div
      className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-lg ${
        highlight ? 'bg-white/20' : 'bg-accent-bg'
      }`}
    >
      {icon}
    </div>
    <div className="min-w-0">
      <div className={`text-2xl font-bold leading-none ${highlight ? 'text-white' : 'text-on-surface'}`}>
        {value}
      </div>
      <div className={`text-xs mt-0.5 ${highlight ? 'text-white/80' : 'text-on-surface-variant'}`}>{label}</div>
      {sub && (
        <div className={`text-xs mt-0.5 ${highlight ? 'text-white/60' : 'text-on-surface-variant/70'}`}>{sub}</div>
      )}
    </div>
  </div>
);

// ── Custom tooltip for the chart ─────────────────────────────────────────────

interface TooltipProps {
  active?: boolean;
  payload?: { value: number; name: string }[];
  label?: string;
}

const ChartTooltip: React.FC<TooltipProps> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const sessions = payload.find((p) => p.name === 'sessions')?.value ?? 0;
  return (
    <div className="bg-surface-container-lowest border border-[#E5E0D5] rounded-xl shadow-editorial px-3 py-2 text-xs">
      <p className="font-medium text-on-surface mb-1">{label}</p>
      <p className="text-on-surface-variant">完成：{sessions} 篇</p>
    </div>
  );
};

// ── Empty/new student state ───────────────────────────────────────────────────

const NewStudentHint: React.FC = () => (
  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
    <span className="text-base mt-0.5">👋</span>
    <div>
      <p className="font-medium">歡迎來到學習圖書館！</p>
      <p className="mt-0.5 text-amber-700 text-xs">選一篇課文開始閱讀，完成後就能在這裡看到你的學習曲線。</p>
    </div>
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

interface StudentProgressDashboardProps {
  /** Called with the set of completed story slugs so StoryLibrary can show badges. */
  onDashboardLoaded?: (completedSlugs: string[]) => void;
}

const StudentProgressDashboard: React.FC<StudentProgressDashboardProps> = ({
  onDashboardLoaded,
}) => {
  const { user, token } = useAuth();
  const [data, setData] = useState<StudentDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Keep a stable ref so the callback never causes the effect to re-run.
  // The effect only needs to fire when user/token become available, not when the
  // callback reference changes (Issue #1156 — dashboard was fetched 3x on login).
  const onDashboardLoadedRef = useRef(onDashboardLoaded);
  useEffect(() => { onDashboardLoadedRef.current = onDashboardLoaded; });

  // Use user.id (primitive) rather than the full user object so that a new
  // object reference (e.g. after isLoading toggles) does NOT re-trigger the
  // fetch.  The dashboard only needs to reload when the logged-in user changes
  // or the token is rotated (Issue #1156 — was fetching 3x on login).
  const userId = user?.id;

  useEffect(() => {
    if (!userId || !token) return;
    fetchStudentDashboard(token, userId)
      .then((d) => {
        setData(d);
        onDashboardLoadedRef.current?.(d.completed_story_slugs);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [userId, token]); // onDashboardLoaded intentionally excluded — use ref above

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-surface-container rounded-2xl h-20 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    // Non-fatal — just hide the dashboard
    return null;
  }

  const isNewStudent = data.total_sessions === 0;
  const chartData = data.daily_activity.map((d) => ({
    date: formatShortDate(d.date),
    sessions: d.sessions_completed,
    score: d.avg_score,
  }));
  const hasActivity = data.daily_activity.some((d) => d.sessions_completed > 0);

  return (
    <div className="space-y-4 mb-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          highlight
          label="連續學習天數"
          value={`${data.streak_days} 天`}
          sub={data.longest_streak > data.streak_days ? `最長 ${data.longest_streak} 天` : undefined}
          icon={<span>🔥</span>}
        />
        <StatCard
          label="本週完成"
          value={data.week_sessions}
          sub="篇課文"
          icon={<span>📅</span>}
        />
        <StatCard
          label="累計完成"
          value={data.completed_sessions}
          sub={`共 ${data.total_sessions} 次練習`}
          icon={<span>📚</span>}
        />
        {/* Issue #1094: 學生端不顯示平均分數；改顯示鼓勵圖示（或省略整張卡） */}
      </div>

      {/* New student hint */}
      {isNewStudent && <NewStudentHint />}

      {/* 30-day activity chart — Issue #1094: 學生端改顯示完成篇數曲線，不顯示平均分數 */}
      {hasActivity && (
        <div className="bg-surface-container-lowest rounded-2xl border border-[#E5E0D5] p-4">
          <h3 className="text-sm font-semibold text-on-surface mb-3">近 30 天學習曲線</h3>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="sessionsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#5B4FC4" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#5B4FC4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                interval={4}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="sessions"
                name="sessions"
                stroke="#5B4FC4"
                strokeWidth={2}
                fill="url(#sessionsGradient)"
                dot={false}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default StudentProgressDashboard;
