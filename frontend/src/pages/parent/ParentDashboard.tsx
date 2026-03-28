/**
 * ParentDashboard — read-only view of linked children's learning progress.
 *
 * Route: /parent
 * Issue #95
 *
 * Features:
 *   - List linked children (tabs or cards)
 *   - Per-child progress: streak, completed sessions, avg score, weekly count
 *   - 30-day learning activity chart (reuses chart logic from StudentProgressDashboard)
 *   - Redeem invite code to link a new child
 */

import React, { useEffect, useState } from 'react';
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
import type { StudentDashboardData } from '../../services/learningApi';
import {
  LinkedChild,
  fetchChildDashboard,
  listLinkedChildren,
  redeemParentInviteCode,
} from '../../services/parentApi';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: string;
  highlight?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, sub, icon, highlight }) => (
  <div
    className={`rounded-xl p-4 flex items-start gap-3 ${
      highlight ? 'bg-indigo-500 text-white' : 'bg-white border border-gray-200'
    }`}
  >
    <div
      className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-lg ${
        highlight ? 'bg-white/20' : 'bg-indigo-50'
      }`}
    >
      {icon}
    </div>
    <div className="min-w-0">
      <div className={`text-2xl font-bold leading-none ${highlight ? 'text-white' : 'text-gray-900'}`}>
        {value}
      </div>
      <div className={`text-xs mt-0.5 ${highlight ? 'text-white/80' : 'text-gray-500'}`}>{label}</div>
      {sub && (
        <div className={`text-xs mt-0.5 ${highlight ? 'text-white/60' : 'text-gray-400'}`}>{sub}</div>
      )}
    </div>
  </div>
);

// ── Chart tooltip ─────────────────────────────────────────────────────────────

interface TooltipProps {
  active?: boolean;
  payload?: { value: number; name: string }[];
  label?: string;
}

const ChartTooltip: React.FC<TooltipProps> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const sessions = payload.find((p) => p.name === 'sessions')?.value ?? 0;
  const score = payload.find((p) => p.name === 'score')?.value;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2 text-xs">
      <p className="font-medium text-gray-700 mb-1">{label}</p>
      <p className="text-gray-600">完成：{sessions} 篇</p>
      {score != null && <p className="text-indigo-600 font-medium">平均分：{score}%</p>}
    </div>
  );
};

// ── Child progress panel ──────────────────────────────────────────────────────

const ChildProgressPanel: React.FC<{ child: LinkedChild; token: string }> = ({
  child,
  token,
}) => {
  const [data, setData] = useState<StudentDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setIsLoading(true);
    setError('');
    fetchChildDashboard(token, child.student_id)
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [token, child.student_id]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-gray-100 rounded-xl h-20 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">
        載入失敗：{error || '未知錯誤'}
      </div>
    );
  }

  const chartData = data.daily_activity.map((d) => ({
    date: formatShortDate(d.date),
    sessions: d.sessions_completed,
    score: d.avg_score,
  }));
  const hasActivity = data.daily_activity.some((d) => d.sessions_completed > 0);

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          highlight
          label="連續學習天數"
          value={`${data.streak_days} 天`}
          sub={data.longest_streak > data.streak_days ? `最長 ${data.longest_streak} 天` : undefined}
          icon="🔥"
        />
        <StatCard
          label="本週完成"
          value={data.week_sessions}
          sub="篇課文"
          icon="📅"
        />
        <StatCard
          label="累計完成"
          value={data.completed_sessions}
          sub={`共 ${data.total_sessions} 次練習`}
          icon="📚"
        />
        <StatCard
          label="平均分數"
          value={data.avg_score != null ? `${data.avg_score}%` : '—'}
          sub={data.avg_score != null ? '綜合評量' : '尚無記錄'}
          icon="⭐"
        />
      </div>

      {data.total_sessions === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          孩子尚未開始任何課文練習。
        </div>
      )}

      {/* 30-day activity chart */}
      {hasActivity && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">近 30 天學習曲線</h3>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="parentScoreGradient" x1="0" y1="0" x2="0" y2="1">
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
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="score"
                name="score"
                stroke="#5B4FC4"
                strokeWidth={2}
                fill="url(#parentScoreGradient)"
                dot={false}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Completed stories list */}
      {data.completed_story_slugs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            已完成課文（{data.completed_story_slugs.length} 篇）
          </h3>
          <div className="flex flex-wrap gap-2">
            {data.completed_story_slugs.map((slug) => (
              <span
                key={slug}
                className="inline-block px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium"
              >
                {slug}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Redeem code form ──────────────────────────────────────────────────────────

const RedeemCodeForm: React.FC<{
  token: string;
  onLinked: (child: LinkedChild) => void;
}> = ({ token, onLinked }) => {
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!code.trim()) return;
    setIsSubmitting(true);
    try {
      const child = await redeemParentInviteCode(token, code.trim());
      setSuccess(`已成功連結孩子：${child.student_name}`);
      setCode('');
      onLinked(child);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '連結失敗，請確認邀請碼是否正確');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">輸入邀請碼連結孩子帳號</h3>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="請輸入 8 位邀請碼"
          maxLength={12}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button
          type="submit"
          disabled={isSubmitting || !code.trim()}
          className="px-4 py-2 bg-indigo-500 text-white text-sm rounded-lg font-medium hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? '連結中…' : '連結'}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {success && <p className="mt-2 text-sm text-green-600">{success}</p>}
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

const ParentDashboard: React.FC = () => {
  const { user, token } = useAuth();
  const [children, setChildren] = useState<LinkedChild[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    listLinkedChildren(token)
      .then((list) => {
        setChildren(list);
        if (list.length > 0) setSelectedChildId(list[0].student_id);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [token]);

  const handleLinked = (child: LinkedChild) => {
    setChildren((prev) => {
      const exists = prev.some((c) => c.student_id === child.student_id);
      if (exists) return prev;
      const updated = [...prev, child];
      setSelectedChildId(child.student_id);
      return updated;
    });
  };

  if (!user || !token) return null;

  const selectedChild = children.find((c) => c.student_id === selectedChildId) ?? null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">家長學習進度</h1>
        <p className="text-sm text-gray-500 mt-1">即時查看孩子的閱讀學習狀況</p>
      </div>

      {/* Redeem code */}
      <RedeemCodeForm token={token} onLinked={handleLinked} />

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Error state */}
      {!isLoading && error && (
        <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">
          載入失敗：{error}
        </div>
      )}

      {/* No children yet */}
      {!isLoading && !error && children.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">
          <p className="text-4xl mb-3">👶</p>
          <p>尚未連結任何孩子帳號。</p>
          <p className="mt-1">請向老師索取邀請碼並輸入於上方。</p>
        </div>
      )}

      {/* Child tabs */}
      {children.length > 0 && (
        <>
          {children.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {children.map((child) => (
                <button
                  key={child.student_id}
                  onClick={() => setSelectedChildId(child.student_id)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    selectedChildId === child.student_id
                      ? 'bg-indigo-500 text-white'
                      : 'bg-white border border-gray-300 text-gray-700 hover:border-indigo-400'
                  }`}
                >
                  {child.student_name}
                </button>
              ))}
            </div>
          )}

          {/* Progress panel for selected child */}
          {selectedChild && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-gray-800">
                {selectedChild.student_name} 的學習進度
              </h2>
              <ChildProgressPanel child={selectedChild} token={token} />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ParentDashboard;
