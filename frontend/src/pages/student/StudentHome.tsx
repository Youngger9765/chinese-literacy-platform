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
import LiveQuizInviteBanner from '../../components/student/home/LiveQuizInviteBanner';
import RecentBadgesStrip from '../../components/gamification/RecentBadgesStrip';
import QuickPracticeStrip from '../../components/student/QuickPracticeStrip';
import {
  BookJacketHero,
  NoClassroomWaitingScreen,
} from '../../components/student/home/TodayLessonCard';
import { ContinueLearningCard, StartLessonCard } from '../../components/student/home/ContinueLearningCard';
import { loadResumeRecord, resolveResume, type ResumeInfo } from '../../utils/resumeInfo';
import { fetchStory } from '../../services/api';
import { stepPath } from '../../config/stepPath';
import { InlineXPPill } from '../../components/student/home/HomeStats';
import LearningEntryCards from '../../components/student/dispatch/LearningEntryCards';
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
  const [classrooms, setClassrooms] = useState<StudentEnrolledClassroom[]>([]);
  const [classroomsLoaded, setClassroomsLoaded] = useState(false);
  const [gamification, setGamification] = useState<GamificationSummary | null>(null);
  const [assignments, setAssignments] = useState<StudentAssignmentResponse[]>([]);
  // 招呼語下一行的數字，來自進度儀表板的載入回呼（不另打請求）；沒回來就不顯示，避免閃一個假的「0 課」
  const [summary, setSummary] = useState<{ completed: number; week: number } | null>(null);
  // 首屏「接著做」：先讀裝置上的進行中紀錄，再抓那一課的資料，用它自己的關卡順序算第幾關
  // 依賴用原始值（使用者編號），不用整個 user 物件：物件換參照會重抓課文
  const userId = user?.id;
  const resumeRecord = useMemo(
    () => (userId !== undefined ? loadResumeRecord(String(userId)) : null),
    [userId],
  );
  const [resume, setResume] = useState<{ info: ResumeInfo | null; title: string | null } | null>(null);
  // 有紀錄但還沒算完時先不畫首屏大卡，避免先閃「選一課開始」再跳成「接著做」
  const resumePending = !!resumeRecord && resume === null;

  useEffect(() => {
    if (!resumeRecord) return;
    let cancelled = false;
    fetchStory(resumeRecord.storyId)
      .then((s) => {
        if (!cancelled) setResume({ info: resolveResume(resumeRecord, s.stepSequence), title: s.title });
      })
      .catch(() => {
        // 抓不到課文：退回預設順序，課名顯示課號
        if (!cancelled) setResume({ info: resolveResume(resumeRecord), title: null });
      });
    return () => { cancelled = true; };
  }, [resumeRecord]);
  const resumeInfo = resume?.info ?? null;

  const firstName = user?.name ?? '同學';

  useEffect(() => {
    if (!token || !user) return;

    // 沒有取消守衛的話，元件卸載後才回來的回應仍會寫狀態（#3714）。
    // #4159：單一班級自動跳去課文庫的行為拿掉了 —— 它讓學生永遠看不到首頁
    // （沒有「我做到哪、今天做什麼」）。
    let cancelled = false;

    fetchMyEnrolledClassrooms(token)
      .then((res) => {
        if (cancelled) return;
        setClassrooms(res.classrooms);
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => {
        if (!cancelled) setClassroomsLoaded(true);
      });

    fetchGamificationSummary(user.id, token)
      .then((summary) => {
        if (!cancelled) setGamification(summary);
      })
      .catch(() => { /* non-fatal */ });

    getMyAssignments(token)
      .then((list) => {
        if (!cancelled) setAssignments(list);
      })
      .catch(() => { /* non-fatal */ });

    return () => {
      cancelled = true;
    };
  }, [token, user]);

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

  // 進行中的課剛好是未完成作業：走作業流程（它帶作業情境，直接跳關卡會被當成自主練習）
  const resumeIsAssignment = useMemo(
    () => !!resumeInfo && assignments.some(
      (a) => (a.status === 'in_progress' || a.status === 'pending') && String(a.story_id ?? a.text_id) === resumeInfo.storyId,
    ),
    [assignments, resumeInfo],
  );

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

  if (classroomsLoaded && classrooms.length === 0) {
    return <NoClassroomWaitingScreen firstName={firstName} />;
  }

  const primaryClassroom = classrooms[0];

  return (
    <div className="flex-1 overflow-y-auto bg-surface">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-4">
        <LiveQuizInviteBanner />
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-10 space-y-6">
        {/* ── Top row: compact greeting + inline XP pill ─────────────────── */}
        <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-12 h-12 rounded-full bg-accent text-white flex items-center justify-center shrink-0 shadow-xs"
              aria-hidden="true"
            >
              <span className="text-xl font-bold font-headline">
                {firstName.charAt(0)}
              </span>
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold font-headline text-on-surface leading-tight sm:leading-8 truncate">
                你好，{firstName}！
              </h1>
              <p className="text-xs sm:text-sm text-on-surface-variant mt-0.5">
                {summary
                  ? `已完成 ${summary.completed} 課 · 這週讀了 ${summary.week} 次`
                  : '今天想探索什麼故事呢？'}
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
        {resumePending ? null : resumeInfo && !resumeIsAssignment ? (
          <ContinueLearningCard
            info={resumeInfo}
            title={resume?.title ?? null}
            onContinue={() => navigate(stepPath(resumeInfo.storyId, resumeInfo.stepId))}
          />
        ) : todayAssignment ? (
          <BookJacketHero
            assignment={todayAssignment}
            onContinue={handleContinueAssignment}
          />
        ) : (
          <StartLessonCard
            classroomName={primaryClassroom?.name}
            onStart={() =>
              primaryClassroom ? handleSelectClassroom(primaryClassroom.id) : navigate('/library')
            }
          />
        )}

        {/* ── Practice shelf ─────────────────────────────────────────────── */}
        <QuickPracticeStrip />

        {/* ── 這次想怎麼練：AI 派發 / 自主練習（老師作業另放提醒列）─────────── */}
        <LearningEntryCards pendingAssignments={pendingAssignmentCount} />

        {/* ── Learning progress ──────────────────────────────────────────── */}
        <section aria-labelledby="progress-title">
          <h2
            id="progress-title"
            className="text-base font-bold font-headline text-on-surface mb-3"
          >
            學習進度
          </h2>
          <StudentProgressDashboard
            onDashboardLoaded={(slugs, d) =>
              setSummary({ completed: slugs.length, week: d.week_sessions })
            }
          />
        </section>

        {gamification && <RecentBadgesStrip badges={gamification.badges} />}
      </div>
    </div>
  );
};

export default StudentHome;
