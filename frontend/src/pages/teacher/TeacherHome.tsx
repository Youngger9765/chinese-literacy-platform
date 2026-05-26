/**
 * TeacherHome — teacher landing page / welcome dashboard.
 *
 * Shows:
 * - Welcome message with teacher's name
 * - Quick stats: total classrooms, total students, active classrooms
 * - Quick action cards: 管理班級, 建立作業, 查看報告
 *
 * Route: /teacher-home
 *
 * Fix #1545: 查看報告 now navigates to /teacher with state { intent: 'reports' }
 * so TeacherDashboard renders a "請選擇班級以查看報告" selection banner.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { listMyClassrooms, ClassroomResponse } from '../../services/classroomApi';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeacherStats {
  classroomCount: number;
  studentCount: number;
  activeClassroomCount: number;
}

// ---------------------------------------------------------------------------
// Quick action card data
// ---------------------------------------------------------------------------

interface QuickAction {
  icon: string;
  label: string;
  description: string;
  /** Navigation path for this action */
  path: string;
  /** Optional router state to pass with navigation (e.g. { intent: 'reports' }) */
  state?: Record<string, unknown>;
  colorClass: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    icon: '🏫',
    label: '管理班級',
    description: '查看與管理你的班級',
    path: '/teacher',
    colorClass: 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-700',
  },
  {
    icon: '📋',
    label: '建立作業',
    description: '指派新的學習作業給學生',
    path: '/teacher',
    colorClass: 'bg-green-50 hover:bg-green-100 border-green-200 text-green-700',
  },
  {
    icon: '📊',
    label: '查看報告',
    description: '選擇班級以查看學生學習報告',
    path: '/teacher',
    // Fix #1545: pass intent so TeacherDashboard shows a report-selection banner
    state: { intent: 'reports' },
    colorClass: 'bg-purple-50 hover:bg-purple-100 border-purple-200 text-purple-700',
  },
];

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

interface StatCardProps {
  icon: string;
  label: string;
  value: number | string;
  loading: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, loading }) => (
  <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-center gap-4">
    <span className="text-3xl shrink-0" aria-hidden="true">{icon}</span>
    <div>
      <div
        className={`text-2xl font-bold text-gray-900 ${loading ? 'animate-pulse bg-gray-200 rounded w-8 h-7 inline-block' : ''}`}
        aria-label={`${label}: ${loading ? '載入中' : value}`}
      >
        {!loading && value}
      </div>
      <div className="text-sm text-gray-500 mt-0.5">{label}</div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// ClassroomList preview
// ---------------------------------------------------------------------------

interface ClassroomListPreviewProps {
  classrooms: ClassroomResponse[];
  onSelect: (id: number) => void;
}

const ClassroomListPreview: React.FC<ClassroomListPreviewProps> = ({ classrooms, onSelect }) => {
  if (classrooms.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-gray-200 p-8 text-center">
        <p className="text-gray-400 text-sm">還沒有班級，前往班級管理新增第一個班級</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2" role="list" aria-label="班級列表">
      {classrooms.slice(0, 5).map((classroom) => (
        <li key={classroom.id}>
          <button
            type="button"
            onClick={() => onSelect(classroom.id)}
            aria-label={`前往 ${classroom.name}，共 ${classroom.student_count} 位學生`}
            className="w-full flex items-center justify-between gap-4 bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 text-left"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl" aria-hidden="true">🏫</span>
              <div>
                <div className="text-sm font-semibold text-gray-800">{classroom.name}</div>
                {classroom.grade != null && (
                  <div className="text-xs text-gray-400 mt-0.5">{classroom.grade} 年級</div>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-bold text-gray-700">{classroom.student_count}</div>
              <div className="text-xs text-gray-400">位學生</div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
};

// ---------------------------------------------------------------------------
// TeacherHome component
// ---------------------------------------------------------------------------

const TeacherHome: React.FC = () => {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [classrooms, setClassrooms] = useState<ClassroomResponse[]>([]);
  const [stats, setStats] = useState<TeacherStats>({
    classroomCount: 0,
    studentCount: 0,
    activeClassroomCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    const fetchData = async () => {
      try {
        const result = await listMyClassrooms(token, { limit: 20 });
        if (cancelled) return;

        const active = result.items.filter((c) => c.is_active);
        const totalStudents = result.items.reduce((sum, c) => sum + c.student_count, 0);

        setClassrooms(result.items);
        setStats({
          classroomCount: result.total,
          studentCount: totalStudents,
          activeClassroomCount: active.length,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '無法載入班級資料');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const rawName = user?.name ?? '老師';
  // Issue #1984: avoid duplicating role suffix when name already ends with 老師
  // e.g. '李老師' → '李老師！' (not '李老師 老師！')
  const displayName = rawName.endsWith('老師') ? rawName : `${rawName} 老師`;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Welcome banner */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-full bg-accent flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <span className="text-white text-2xl font-bold">
                {rawName.charAt(0)}
              </span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                歡迎回來，{displayName}！
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                今天也來關心一下學生的學習進度吧
              </p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <section aria-labelledby="stats-title">
          <h2
            id="stats-title"
            className="text-base font-bold text-gray-700 mb-3"
          >
            班級總覽
          </h2>
          {error ? (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm"
            >
              {error}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatCard icon="🏫" label="班級數" value={stats.classroomCount} loading={loading} />
              <StatCard icon="👨‍🎓" label="學生總數" value={stats.studentCount} loading={loading} />
              <StatCard icon="✅" label="進行中班級" value={stats.activeClassroomCount} loading={loading} />
            </div>
          )}
        </section>

        {/* Quick actions */}
        <section aria-labelledby="actions-title">
          <h2
            id="actions-title"
            className="text-base font-bold text-gray-700 mb-3"
          >
            快速操作
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() =>
                  action.state
                    ? navigate(action.path, { state: action.state })
                    : navigate(action.path)
                }
                aria-label={`${action.label}：${action.description}`}
                className={`
                  flex items-center gap-4 p-4 rounded-xl border text-left transition-colors
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
                  ${action.colorClass}
                `}
              >
                <span className="text-3xl shrink-0" aria-hidden="true">{action.icon}</span>
                <div>
                  <div className="font-semibold text-sm">{action.label}</div>
                  <div className="text-xs opacity-75 mt-0.5">{action.description}</div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Classroom list */}
        <section aria-labelledby="classrooms-title">
          <div className="flex items-center justify-between mb-3">
            <h2
              id="classrooms-title"
              className="text-base font-bold text-gray-700"
            >
              我的班級
            </h2>
            <button
              type="button"
              onClick={() => navigate('/teacher')}
              className="text-sm text-accent hover:text-accent-hover font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 rounded"
            >
              查看全部 →
            </button>
          </div>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse"
                  aria-hidden="true"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gray-200 rounded-full" />
                    <div className="space-y-1.5">
                      <div className="h-3 bg-gray-200 rounded w-24" />
                      <div className="h-2.5 bg-gray-200 rounded w-16" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ClassroomListPreview
              classrooms={classrooms}
              onSelect={(id) => navigate(`/teacher/classroom/${id}`)}
            />
          )}
        </section>
      </div>
    </div>
  );
};

export default TeacherHome;
