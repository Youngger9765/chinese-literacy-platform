/**
 * StudentProfile — 學生個人 Profile 頁面
 *
 * Route: /profile
 * Issue #464
 *
 * Shows:
 *   - Student name, email, account type
 *   - Enrolled classrooms and teachers
 *   - Learning stats (completed stories, streak, XP, average score)
 *   - Joined date
 *   - Link to change password
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { gradeLabel } from '../../utils/gradeLabel';
import {
  fetchMyEnrolledClassrooms,
  fetchStudentDashboard,
  type StudentEnrolledClassroom,
  type StudentDashboardData,
} from '../../services/learningApi';
import {
  getGamificationSummary,
  type GamificationSummary,
} from '../../services/gamificationApi';

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  icon: string;
  label: string;
  value: string | number;
  sub?: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, sub }) => (
  <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
    <span className="text-2xl shrink-0" aria-hidden="true">{icon}</span>
    <div className="min-w-0">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold text-gray-900 leading-tight">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const StudentProfile: React.FC = () => {
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [classrooms, setClassrooms] = useState<StudentEnrolledClassroom[]>([]);
  const [dashboard, setDashboard] = useState<StudentDashboardData | null>(null);
  const [gamification, setGamification] = useState<GamificationSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !user) return;

    Promise.allSettled([
      fetchMyEnrolledClassrooms(token),
      fetchStudentDashboard(token, user.id),
      getGamificationSummary(user.id, token),
    ]).then(([classroomsResult, dashboardResult, gamificationResult]) => {
      if (classroomsResult.status === 'fulfilled') {
        setClassrooms(classroomsResult.value.classrooms);
      }
      if (dashboardResult.status === 'fulfilled') {
        setDashboard(dashboardResult.value);
      }
      if (gamificationResult.status === 'fulfilled') {
        setGamification(gamificationResult.value);
      }
      setLoading(false);
    });
  }, [token, user]);

  if (!user) return null;

  const firstName = user.name ?? '同學';
  const initial = firstName.charAt(0).toUpperCase();

  // Format joined date from created_at — AuthUser doesn't expose it directly,
  // so we use what we have. Backend created_at is available via /api/users/me
  // but AuthUser doesn't include it. Use a fallback.
  const joinedYear = new Date().getFullYear(); // placeholder; profile data from /api/users/me

  const roleLabel = user.roles.length > 0
    ? user.roles.map((r) => r.role_display_name).join('、')
    : '學生';

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        {/* Avatar + name + email */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-5">
            <div
              className="w-16 h-16 rounded-full bg-accent flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <span className="text-white text-2xl font-bold">{initial}</span>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-gray-900 truncate">{user.name}</h1>
              <p className="text-sm text-gray-500 mt-0.5 truncate">{user.email}</p>
              <p className="text-xs text-indigo-600 mt-1 font-medium">{roleLabel}</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/change-password')}
              className="shrink-0 text-xs font-medium text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 px-3 py-2 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              修改密碼
            </button>
          </div>
        </div>

        {/* Learning stats */}
        {!loading && (
          <section aria-labelledby="stats-title">
            <h2 id="stats-title" className="text-base font-bold text-gray-700 mb-3">
              學習統計
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                icon="📚"
                label="完成課文"
                value={
                  gamification?.stories_completed ??
                  dashboard?.completed_sessions ??
                  0
                }
                sub="篇"
              />
              <StatCard
                icon="🔥"
                label="連續天數"
                value={
                  gamification?.streak?.current_streak ??
                  dashboard?.streak_days ??
                  0
                }
                sub={`最長 ${gamification?.streak?.longest_streak ?? dashboard?.longest_streak ?? 0} 天`}
              />
              <StatCard
                icon="⭐"
                label="總 XP"
                value={gamification?.total_xp ?? 0}
                sub={gamification ? `Lv.${gamification.level_info.level} ${gamification.level_info.level_name}` : undefined}
              />
              {/* Issue #1094: 學生端不顯示平均分數 */}
            </div>
          </section>
        )}

        {/* Enrolled classrooms */}
        <section aria-labelledby="classrooms-title">
          <div className="flex items-center justify-between mb-3">
            <h2 id="classrooms-title" className="text-base font-bold text-gray-700">
              我的班級
            </h2>
            <button
              type="button"
              onClick={() => navigate('/classroom-dashboard')}
              className="text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
            >
              查看詳情
            </button>
          </div>

          {loading ? (
            <div className="text-sm text-gray-400 animate-pulse">載入中...</div>
          ) : classrooms.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
              <span className="text-xl" aria-hidden="true">🏫</span>
              <div>
                <p className="text-sm font-semibold text-amber-800">尚未加入班級</p>
                <button
                  type="button"
                  onClick={() => navigate('/join')}
                  className="text-xs text-accent hover:underline mt-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                >
                  加入班級
                </button>
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {classrooms.map((c) => (
                <li
                  key={c.id}
                  className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3"
                >
                  <span className="text-xl shrink-0" aria-hidden="true">🏫</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">老師：{c.teacher_name}</p>
                  </div>
                  {c.grade != null && (
                    <span className="shrink-0 text-xs text-gray-400">{gradeLabel(String(c.grade))}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Account info */}
        <section aria-labelledby="account-title">
          <h2 id="account-title" className="text-base font-bold text-gray-700 mb-3">
            帳號資訊
          </h2>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-50">
            <div className="px-4 py-3 flex justify-between text-sm">
              <span className="text-gray-500">電子信箱</span>
              <span className="text-gray-900 font-medium truncate max-w-[60%] text-right">
                {user.email}
              </span>
            </div>
            <div className="px-4 py-3 flex justify-between text-sm">
              <span className="text-gray-500">帳號狀態</span>
              <span className={`font-medium ${user.is_active ? 'text-green-600' : 'text-red-500'}`}>
                {user.is_active ? '啟用中' : '已停用'}
              </span>
            </div>
            <div className="px-4 py-3 flex justify-between text-sm">
              <span className="text-gray-500">Email 驗證</span>
              <span className="text-gray-900 font-medium">
                {'email_verified' in user && (user as Record<string, unknown>).email_verified ? '已驗證' : '未驗證'}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default StudentProfile;
