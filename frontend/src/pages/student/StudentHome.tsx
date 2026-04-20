/**
 * StudentHome — student landing page / dashboard.
 *
 * Issue #1153: merged gamification signals into the home page.
 *
 * Layout (top to bottom):
 * 1. Greeting strip — name + avatar
 * 2. GamificationHero — streak + level + XP bar + next badge hint
 * 3. Hero classroom card — "繼續學習" → library
 * 4. Two action cards: Assignments + Library
 * 5. RecentBadgesStrip — last 3 unlocked badges
 * 6. StudentProgressDashboard — learning stats chart
 * 7. RecommendedStories
 *
 * Issue #457: Students not yet added to any classroom see a friendly waiting
 * screen instead of the full dashboard.
 *
 * Route: /student
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import StudentProgressDashboard from '../../components/student/StudentProgressDashboard';
import RecommendedStories from '../../components/student/RecommendedStories';
import SessionResumePrompt from '../../components/SessionResumePrompt';
import GamificationHero from '../../components/gamification/GamificationHero';
import RecentBadgesStrip from '../../components/gamification/RecentBadgesStrip';
import QuickPracticeStrip from '../../components/student/QuickPracticeStrip';
import {
  fetchMyEnrolledClassrooms,
  type StudentEnrolledClassroom,
} from '../../services/learningApi';
import {
  fetchGamificationSummary,
  type GamificationSummary,
} from '../../services/gamificationApi';

// ---------------------------------------------------------------------------
// NoClassroomWaitingScreen — shown to students not yet added to any classroom
// Issue #457
// ---------------------------------------------------------------------------

interface NoClassroomWaitingScreenProps {
  firstName: string;
}

const NoClassroomWaitingScreen: React.FC<NoClassroomWaitingScreenProps> = ({ firstName }) => (
  <div className="flex-1 flex items-center justify-center min-h-[60vh]">
    <div className="max-w-md w-full mx-auto p-6 text-center space-y-6">
      <div
        className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto"
        aria-hidden="true"
      >
        <span className="text-4xl">🏫</span>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">你好，{firstName}！</h1>
        <p className="text-base text-gray-600 mt-2">你的老師還沒有把你加入班級</p>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-left space-y-3">
        <p className="text-sm font-semibold text-amber-900">下一步怎麼做？</p>
        <ol className="space-y-2 text-sm text-amber-800 list-decimal list-inside">
          <li>請聯繫你的老師</li>
          <li>請老師把你加入班級</li>
          <li>加入後重新登入，即可開始學習</li>
        </ol>
      </div>
      <p className="text-xs text-gray-400">加入班級後重新整理頁面即可繼續</p>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const StudentHome: React.FC = () => {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [showResumePrompt, setShowResumePrompt] = useState(true);
  const [classrooms, setClassrooms] = useState<StudentEnrolledClassroom[]>([]);
  const [classroomsLoaded, setClassroomsLoaded] = useState(false);
  const [gamification, setGamification] = useState<GamificationSummary | null>(null);

  const firstName = user?.name ?? '同學';

  // Fetch classrooms and gamification summary in parallel
  useEffect(() => {
    if (!token || !user) return;

    // Classrooms
    fetchMyEnrolledClassrooms(token)
      .then((res) => {
        setClassrooms(res.classrooms);
        if (res.classrooms.length === 1 && res.classrooms[0].is_active) {
          navigate(`/library?classroom=${res.classrooms[0].id}`, { replace: true });
        }
      })
      .catch(() => {
        // Non-fatal
      })
      .finally(() => setClassroomsLoaded(true));

    // Gamification — non-blocking, hero appears once loaded
    fetchGamificationSummary(user.id, token)
      .then(setGamification)
      .catch(() => {
        // Non-fatal: hero simply doesn't render on error
      });
  }, [token, user, navigate]);

  const handleSelectClassroom = (classroomId: number) => {
    navigate(`/library?classroom=${classroomId}`);
  };

  // Issue #457: block full dashboard for students not yet in any classroom
  if (classroomsLoaded && classrooms.length === 0) {
    return <NoClassroomWaitingScreen firstName={firstName} />;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-5 py-8 space-y-6">
        {/* Session resume prompt */}
        {showResumePrompt && (
          <SessionResumePrompt onDismiss={() => setShowResumePrompt(false)} />
        )}

        {/* ── 1. Greeting strip ──────────────────────────────────────── */}
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-full bg-accent shadow-editorial flex items-center justify-center shrink-0"
            aria-hidden="true"
          >
            <span className="text-white text-2xl font-bold font-headline">
              {firstName.charAt(0)}
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-bold font-headline text-on-surface">
              你好，{firstName}！
            </h1>
            <p className="text-sm text-on-surface-variant mt-1">
              今天想探索什麼故事呢？
            </p>
          </div>
        </div>

        {/* ── 2. Gamification Hero ───────────────────────────────────── */}
        {gamification && (
          <GamificationHero summary={gamification} />
        )}

        {/* ── 3. Hero card: Continue Learning / Classroom ────────────── */}
        {classroomsLoaded && classrooms.length > 0 && (
          <button
            type="button"
            onClick={() => handleSelectClassroom(classrooms[0].id)}
            className="w-full text-left bg-surface-container-lowest rounded-3xl shadow-editorial p-6 flex items-center gap-5 transition-all hover:scale-[0.99] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            aria-label="繼續學習"
          >
            <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center shrink-0">
              <span className="text-3xl" aria-hidden="true">📖</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-accent uppercase tracking-wide">繼續學習</p>
              <p className="text-lg font-bold text-on-surface mt-0.5 truncate">
                {classrooms[0].name}
              </p>
              <p className="text-sm text-on-surface-variant mt-0.5">
                老師：{classrooms[0].teacher_name}
              </p>
            </div>
            <span className="text-on-surface-variant shrink-0 text-xl" aria-hidden="true">→</span>
          </button>
        )}

        {/* ── 4. Two action cards: Assignments + Library ─────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => navigate('/assignments')}
            className="text-left bg-surface-container-lowest rounded-3xl shadow-editorial p-5 flex items-center gap-4 transition-all hover:scale-[0.99] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            aria-label="查看我的作業"
          >
            <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
              <span className="text-2xl" aria-hidden="true">📋</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-on-surface">我的作業</p>
              <p className="text-sm text-on-surface-variant mt-0.5">查看待完成的作業</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate('/library')}
            className="text-left bg-surface-container-lowest rounded-3xl shadow-editorial p-5 flex items-center gap-4 transition-all hover:scale-[0.99] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            aria-label="前往圖書館"
          >
            <div className="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center shrink-0">
              <span className="text-2xl" aria-hidden="true">📚</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-on-surface">圖書館</p>
              <p className="text-sm text-on-surface-variant mt-0.5">探索更多課文</p>
            </div>
          </button>
        </div>

        {/* ── 5. Recent badges strip ─────────────────────────────────── */}
        {gamification && (
          <RecentBadgesStrip badges={gamification.badges} />
        )}

        {/* ── 6. Quick practice strip: "想練點什麼？" ─────────────────── */}
        <QuickPracticeStrip />

        {/* ── 8. Progress dashboard — streak, chart, stats ───────────── */}
        <section aria-labelledby="progress-title">
          <h2
            id="progress-title"
            className="text-base font-bold font-headline text-on-surface mb-3"
          >
            學習進度
          </h2>
          <StudentProgressDashboard onDashboardLoaded={() => {}} />
        </section>

        {/* ── 9. Recommended stories ─────────────────────────────────── */}
        <section aria-labelledby="recommended-title">
          <h2
            id="recommended-title"
            className="text-base font-bold font-headline text-on-surface mb-3"
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
