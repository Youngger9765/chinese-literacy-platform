/**
 * StudentHome — student landing page / dashboard (orchestrator).
 *
 * Issue #1215: Variant B "Book Jacket" — today's lesson is the visual anchor.
 * Issue #1952: Split 527 LOC into focused sub-components.
 *
 * Layout (top to bottom):
 * 1. Compact greeting row — avatar + name + inline XP pill (no purple gradient)
 * 2. Book jacket hero — 200×270 lesson cover (real thumbnail) + info + "繼續閱讀" CTA
 *    Falls back to classroom link if no active assignment.
 * 3. Practice shelf — horizontal scrollable tool cards ("想練點什麼？")
 * 4. Secondary tiles — 班級作業 + 圖書館 (2-col, smaller than hero)
 * 5. Progress dashboard + recent badges + recommended stories
 *
 * Issue #457: students not yet in any classroom see the waiting screen.
 *
 * Route: /student
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import StudentProgressDashboard from '../../components/student/StudentProgressDashboard';
import RecommendedStories from '../../components/student/RecommendedStories';
import SessionResumePrompt from '../../components/SessionResumePrompt';
import RecentBadgesStrip from '../../components/gamification/RecentBadgesStrip';
import QuickPracticeStrip from '../../components/student/QuickPracticeStrip';
import {
  BookJacketHero,
  ClassroomFallbackHero,
  NoClassroomWaitingScreen,
} from '../../components/student/home/TodayLessonCard';
import { InlineXPPill } from '../../components/student/home/HomeStats';
import AssignmentWidget from '../../components/student/home/AssignmentWidget';
import {
  fetchMyEnrolledClassrooms,
  type StudentEnrolledClassroom,
} from '../../services/learningApi';
import {
  fetchGamificationSummary,
  type GamificationSummary,
} from '../../services/gamificationApi';
import {
  getMyAssignments,
  type StudentAssignmentResponse,
} from '../../services/assignmentApi';

// ---------------------------------------------------------------------------
// Main component — orchestrator only
// ---------------------------------------------------------------------------

const StudentHome: React.FC = () => {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [showResumePrompt, setShowResumePrompt] = useState(true);
  const [classrooms, setClassrooms] = useState<StudentEnrolledClassroom[]>([]);
  const [classroomsLoaded, setClassroomsLoaded] = useState(false);
  const [gamification, setGamification] = useState<GamificationSummary | null>(null);
  const [assignments, setAssignments] = useState<StudentAssignmentResponse[]>([]);

  const firstName = user?.name ?? '同學';

  useEffect(() => {
    if (!token || !user) return;

    fetchMyEnrolledClassrooms(token)
      .then((res) => {
        setClassrooms(res.classrooms);
        if (res.classrooms.length === 1 && res.classrooms[0].is_active) {
          // keep the auto-redirect behaviour from the prior revision
          navigate(`/library?classroom=${res.classrooms[0].id}`, { replace: true });
        }
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => setClassroomsLoaded(true));

    fetchGamificationSummary(user.id, token)
      .then(setGamification)
      .catch(() => { /* non-fatal */ });

    getMyAssignments(token)
      .then(setAssignments)
      .catch(() => { /* non-fatal */ });
  }, [token, user, navigate]);

  /** Today's active assignment, if any.
   * Priority: in_progress first, then pending.
   * Within each bucket: soonest due_date, then latest assigned (highest id). */
  const todayAssignment = useMemo<StudentAssignmentResponse | null>(() => {
    const active = assignments.filter(
      (a) => a.status === 'in_progress' || a.status === 'pending',
    );
    if (active.length === 0) return null;
    const sorted = [...active].sort((a, b) => {
      // in_progress beats pending
      if (a.status !== b.status) return a.status === 'in_progress' ? -1 : 1;
      // soonest due first
      const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      if (da !== db) return da - db;
      // newest assignment last (higher id = more recent)
      return b.assignment_id - a.assignment_id;
    });
    return sorted[0];
  }, [assignments]);

  const pendingAssignmentCount = useMemo(
    () => assignments.filter((a) => a.status === 'pending' || a.status === 'in_progress').length,
    [assignments],
  );

  const handleContinueAssignment = useCallback(() => {
    // Heavy start/resume flow lives in MyAssignments — navigate there so the
    // student gets the same proven path. One extra click beats two divergent flows.
    navigate('/assignments');
  }, [navigate]);

  const handleSelectClassroom = useCallback((classroomId: number) => {
    navigate(`/library?classroom=${classroomId}`);
  }, [navigate]);

  const noop = useCallback(() => {}, []);

  if (classroomsLoaded && classrooms.length === 0) {
    return <NoClassroomWaitingScreen firstName={firstName} />;
  }

  const primaryClassroom = classrooms[0];

  return (
    <div className="flex-1 overflow-y-auto bg-surface">
      {showResumePrompt && (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-4">
          <SessionResumePrompt onDismiss={() => setShowResumePrompt(false)} />
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-10 space-y-6">
        {/* ── Top row: compact greeting + inline XP pill ─────────────────── */}
        <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-12 h-12 rounded-full bg-accent text-white flex items-center justify-center shrink-0 shadow-sm"
              aria-hidden="true"
            >
              <span className="text-xl font-bold font-headline">
                {firstName.charAt(0)}
              </span>
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold font-headline text-on-surface leading-tight truncate">
                你好，{firstName}！
              </h1>
              <p className="text-xs sm:text-sm text-on-surface-variant mt-0.5">
                今天想探索什麼故事呢？
              </p>
            </div>
          </div>
          {gamification && (
            <InlineXPPill
              summary={gamification}
              onClick={() => navigate('/achievements')}
            />
          )}
        </div>

        {/* ── Hero: book jacket OR classroom fallback ─────────────────────── */}
        {todayAssignment ? (
          <BookJacketHero
            assignment={todayAssignment}
            onContinue={handleContinueAssignment}
          />
        ) : primaryClassroom ? (
          <ClassroomFallbackHero
            classroom={primaryClassroom}
            onClick={() => handleSelectClassroom(primaryClassroom.id)}
          />
        ) : null}

        {/* ── Practice shelf ─────────────────────────────────────────────── */}
        <QuickPracticeStrip />

        {/* ── Secondary tiles: assignments + library ─────────────────────── */}
        <AssignmentWidget
          pendingCount={pendingAssignmentCount}
          onGoAssignments={() => navigate('/assignments')}
          onGoLibrary={() => navigate('/library')}
        />

        {/* ── Learning progress ──────────────────────────────────────────── */}
        <section aria-labelledby="progress-title">
          <h2
            id="progress-title"
            className="text-base font-bold font-headline text-on-surface mb-3"
          >
            學習進度
          </h2>
          <StudentProgressDashboard onDashboardLoaded={noop} />
        </section>

        {gamification && <RecentBadgesStrip badges={gamification.badges} />}

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
