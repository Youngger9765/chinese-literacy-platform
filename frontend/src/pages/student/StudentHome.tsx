/**
 * StudentHome — student landing page / dashboard.
 *
 * Combines:
 * - Welcome message with user's name
 * - Classroom context card (班級 + 老師) if enrolled — Issue #462
 * - Quick action cards (start reading, continue assignment, practice vocabulary)
 * - StudentProgressDashboard (streak, chart, stats)
 * - RecommendedStories
 * - SessionResumePrompt (resume incomplete session)
 *
 * Route: /student
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import StudentProgressDashboard from '../../components/student/StudentProgressDashboard';
import RecommendedStories from '../../components/student/RecommendedStories';
import SessionResumePrompt from '../../components/SessionResumePrompt';
import {
  fetchMyEnrolledClassrooms,
  type StudentEnrolledClassroom,
} from '../../services/api';

// ---------------------------------------------------------------------------
// Quick action card data
// ---------------------------------------------------------------------------

interface QuickAction {
  icon: string;
  label: string;
  description: string;
  path: string;
  colorClass: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    icon: '📚',
    label: '開始閱讀',
    description: '選一篇課文開始朗讀練習',
    path: '/library',
    colorClass: 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-700',
  },
  {
    icon: '📋',
    label: '查看作業',
    description: '完成老師指派的學習作業',
    path: '/assignments',
    colorClass: 'bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-700',
  },
  {
    icon: '📖',
    label: '生字練習',
    description: '複習學過的生字詞語',
    path: '/vocabulary',
    colorClass: 'bg-green-50 hover:bg-green-100 border-green-200 text-green-700',
  },
];

// ---------------------------------------------------------------------------
// ClassroomContextCard — shows the student's enrolled classroom(s)
// ---------------------------------------------------------------------------

interface ClassroomContextCardProps {
  classrooms: StudentEnrolledClassroom[];
  onSelectClassroom: (classroomId: number) => void;
}

const ClassroomContextCard: React.FC<ClassroomContextCardProps> = ({
  classrooms,
  onSelectClassroom,
}) => {
  if (classrooms.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
        <span className="text-2xl" aria-hidden="true">🏫</span>
        <div>
          <p className="text-sm font-semibold text-amber-800">尚未加入班級</p>
          <p className="text-xs text-amber-600 mt-0.5">
            請向老師索取班級加入碼，或等待老師將你加入班級。
          </p>
        </div>
      </div>
    );
  }

  if (classrooms.length === 1) {
    const c = classrooms[0];
    return (
      <button
        type="button"
        onClick={() => onSelectClassroom(c.id)}
        className="w-full text-left bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-2xl p-4 flex items-center gap-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        aria-label={`進入班級 ${c.name}`}
      >
        <span className="text-3xl shrink-0" aria-hidden="true">🏫</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-indigo-500 font-medium">你的班級</p>
          <p className="text-base font-bold text-indigo-900 truncate">{c.name}</p>
          <p className="text-xs text-indigo-600 mt-0.5">老師：{c.teacher_name}</p>
        </div>
        <span className="text-indigo-400 shrink-0" aria-hidden="true">→</span>
      </button>
    );
  }

  // Multiple classrooms — show a selection list
  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
        你的班級
      </p>
      {classrooms.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onSelectClassroom(c.id)}
          className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-indigo-50 border border-transparent hover:border-indigo-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          aria-label={`進入班級 ${c.name}`}
        >
          <span className="text-xl shrink-0" aria-hidden="true">🏫</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
            <p className="text-xs text-gray-500">老師：{c.teacher_name}</p>
          </div>
          <span className="text-gray-400 shrink-0" aria-hidden="true">→</span>
        </button>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const StudentHome: React.FC = () => {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [showResumePrompt, setShowResumePrompt] = useState(true);
  const [classrooms, setClassrooms] = useState<StudentEnrolledClassroom[]>([]);
  const [classroomsLoaded, setClassroomsLoaded] = useState(false);

  // Get first name for greeting
  const firstName = user?.name ?? '同學';

  // Fetch enrolled classrooms on mount
  useEffect(() => {
    if (!token) return;
    fetchMyEnrolledClassrooms(token)
      .then((res) => {
        setClassrooms(res.classrooms);
        // Auto-navigate if exactly one classroom
        if (res.classrooms.length === 1 && res.classrooms[0].is_active) {
          navigate(`/library?classroom=${res.classrooms[0].id}`, { replace: true });
        }
      })
      .catch(() => {
        // Non-fatal: student may not be enrolled yet
      })
      .finally(() => setClassroomsLoaded(true));
  }, [token, navigate]);

  const handleSelectClassroom = (classroomId: number) => {
    navigate(`/library?classroom=${classroomId}`);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Session resume prompt */}
        {showResumePrompt && (
          <SessionResumePrompt onDismiss={() => setShowResumePrompt(false)} />
        )}

        {/* Welcome banner */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-full bg-accent flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <span className="text-white text-2xl font-bold">
                {firstName.charAt(0)}
              </span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                你好，{firstName}！
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                今天也來練習朗讀吧，每天進步一點點
              </p>
            </div>
          </div>
        </div>

        {/* Classroom context card — only shown once classrooms have been fetched */}
        {classroomsLoaded && (
          <section aria-labelledby="classroom-context-title">
            <h2
              id="classroom-context-title"
              className="text-base font-bold text-gray-700 mb-3"
            >
              我的班級
            </h2>
            <ClassroomContextCard
              classrooms={classrooms}
              onSelectClassroom={handleSelectClassroom}
            />
          </section>
        )}

        {/* Quick actions */}
        <section aria-labelledby="quick-actions-title">
          <h2
            id="quick-actions-title"
            className="text-base font-bold text-gray-700 mb-3"
          >
            快速開始
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.path}
                type="button"
                onClick={() => navigate(action.path)}
                aria-label={`${action.label}：${action.description}`}
                className={`
                  flex items-center gap-4 p-4 rounded-xl border text-left transition-colors
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
                  ${action.colorClass}
                `}
              >
                <span className="text-3xl shrink-0" aria-hidden="true">
                  {action.icon}
                </span>
                <div>
                  <div className="font-semibold text-sm">{action.label}</div>
                  <div className="text-xs opacity-75 mt-0.5">{action.description}</div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Progress dashboard — streak, chart, stats */}
        <section aria-labelledby="progress-title">
          <h2
            id="progress-title"
            className="text-base font-bold text-gray-700 mb-3"
          >
            學習進度
          </h2>
          <StudentProgressDashboard onDashboardLoaded={() => {}} />
        </section>

        {/* Recommended stories */}
        <section aria-labelledby="recommended-title">
          <h2
            id="recommended-title"
            className="text-base font-bold text-gray-700 mb-3"
          >
            推薦課文
          </h2>
          <RecommendedStories />
        </section>
      </div>
    </div>
  );
};

export default StudentHome;
