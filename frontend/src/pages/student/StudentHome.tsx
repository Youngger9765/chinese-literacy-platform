/**
 * StudentHome — student landing page / dashboard.
 *
 * Issue #1215: Variant B "Book Jacket" — today's lesson is the visual anchor.
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
// NoClassroomWaitingScreen — shown to students not yet added to any classroom
// Issue #457
// ---------------------------------------------------------------------------

interface NoClassroomWaitingScreenProps {
  firstName: string;
}

const NoClassroomWaitingScreen: React.FC<NoClassroomWaitingScreenProps> = ({ firstName }) => (
  <div className="flex-1 flex items-center justify-center min-h-[60vh]">
    <div className="max-w-sm w-full mx-auto px-6 py-10 text-center space-y-6">
      <div
        className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center mx-auto"
        aria-hidden="true"
      >
        <span className="text-4xl">🏫</span>
      </div>
      <div>
        <h1 className="text-2xl font-bold font-headline text-on-surface">
          你好，{firstName}！
        </h1>
        <p className="text-base text-on-surface-variant mt-2">你的老師還沒有把你加入班級</p>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-left space-y-3">
        <p className="text-sm font-semibold text-amber-900">下一步怎麼做？</p>
        <ol className="space-y-2 text-sm text-amber-800 list-decimal list-inside">
          <li>請聯繫你的老師</li>
          <li>請老師把你加入班級</li>
          <li>加入後重新登入，即可開始學習</li>
        </ol>
      </div>
      <p className="text-xs text-on-surface-variant/60">加入班級後重新整理頁面即可繼續</p>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// InlineXPPill — compact XP + streak + level pill, not a hero block.
// Replaces the old purple-gradient GamificationHero on this page.
// ---------------------------------------------------------------------------

interface InlineXPPillProps {
  summary: GamificationSummary;
  onClick: () => void;
}

const InlineXPPill: React.FC<InlineXPPillProps> = ({ summary, onClick }) => {
  const { level_info: li, streak } = summary;
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        flex items-center gap-2.5 px-3.5 py-1.5 rounded-full
        bg-surface-container-lowest border border-[#E5E0D5]
        hover:border-accent/40 hover:shadow-sm
        transition-all duration-150
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
      "
      aria-label={`目前 Lv.${li.level}，連續 ${streak.current} 天，點我看成就`}
    >
      <span className="flex items-center gap-1 text-sm font-bold text-tertiary-fixed-dim">
        <span aria-hidden="true">{streak.current > 0 ? '🔥' : '💤'}</span>
        <span className="tabular-nums">{streak.current}</span>
        <span className="text-xs font-medium">天</span>
      </span>
      <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] font-black tabular-nums">
        Lv.{li.level}
      </span>
      <span className="hidden sm:inline text-xs text-on-surface-variant tabular-nums">
        {li.current_level_xp} / {li.next_level_xp ?? '—'} XP
      </span>
    </button>
  );
};

// ---------------------------------------------------------------------------
// BookJacketCover — 200x270 book cover with real lesson thumbnail.
// Renders amber gradient + title fallback if the image fails to load.
// ---------------------------------------------------------------------------

interface BookJacketCoverProps {
  storyId: string | null;
  title: string;
}

const THUMBNAIL_BASE = 'https://storage.googleapis.com/lingoleap-assets/stories/thumbnails';

const BookJacketCover: React.FC<BookJacketCoverProps> = ({ storyId, title }) => {
  const [imgOk, setImgOk] = useState(true);
  const imgSrc = storyId ? `${THUMBNAIL_BASE}/lesson-${storyId}.webp` : null;

  // Reset error state when the story changes, so a previous 404 doesn't
  // block a new valid thumbnail if the component is reused.
  useEffect(() => {
    setImgOk(true);
  }, [storyId]);

  return (
    <div
      className="
        relative w-[160px] sm:w-[200px] aspect-[200/270] shrink-0
        rounded-l-sm rounded-r-md overflow-hidden
        bg-gradient-to-br from-[#F7B76B] via-[#F59E42] to-[#E8841C]
        shadow-[4px_6px_16px_rgba(245,158,66,0.3),-2px_0_0_rgba(0,0,0,0.05)]
      "
      aria-hidden="true"
    >
      {/* Spine shadow line */}
      <div
        className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/15 to-transparent"
        aria-hidden="true"
      />

      {/* Real cover image (hidden on error) */}
      {imgSrc && imgOk && (
        <img
          src={imgSrc}
          alt=""
          onError={() => setImgOk(false)}
          className="absolute inset-0 w-full h-full object-cover"
          loading="eager"
        />
      )}

      {/* Text fallback (shown only if image absent or failed) */}
      {(!imgSrc || !imgOk) && (
        <div className="absolute inset-0 p-4 sm:p-5 flex flex-col justify-between text-white">
          <div className="text-xl sm:text-2xl font-bold leading-tight tracking-tight line-clamp-4">
            {title}
          </div>
          <div className="text-[10px] sm:text-xs opacity-90 tracking-widest">今 日 課 文</div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// BookJacketHero — large "today's lesson" anchor card.
// ---------------------------------------------------------------------------

interface BookJacketHeroProps {
  assignment: StudentAssignmentResponse;
  onContinue: () => void;
}

const BookJacketHero: React.FC<BookJacketHeroProps> = ({ assignment, onContinue }) => {
  const isInProgress = assignment.status === 'in_progress';
  const ctaLabel = isInProgress ? '繼續閱讀' : '開始閱讀';

  return (
    <section
      aria-labelledby="today-lesson-title"
      className="
        bg-surface-container-lowest border border-[#E5E0D5] rounded-2xl
        p-5 sm:p-7
        grid grid-cols-[160px_1fr] sm:grid-cols-[200px_1fr] gap-5 sm:gap-7
        items-center
        shadow-editorial
      "
    >
      <BookJacketCover storyId={assignment.story_id} title={assignment.story_title} />

      <div className="min-w-0">
        <div className="text-[11px] font-bold tracking-widest text-tertiary-fixed-dim uppercase mb-1.5">
          今 日 課 文
        </div>
        <h1
          id="today-lesson-title"
          className="text-xl sm:text-[26px] font-bold font-headline text-on-surface leading-tight mb-1.5 line-clamp-2"
        >
          {assignment.story_title}
        </h1>
        <p className="text-sm text-on-surface-variant mb-4">
          {assignment.classroom_name}
        </p>

        {isInProgress && assignment.current_step && (
          <div className="flex items-center gap-2 mb-4">
            <span
              className="inline-flex items-center px-2.5 py-0.5 rounded-full
                         bg-tertiary-fixed/20 text-tertiary-dim
                         text-xs font-bold"
            >
              上次讀到
            </span>
            <span className="text-xs text-on-surface-variant">可以接著讀下去</span>
          </div>
        )}

        <button
          type="button"
          onClick={onContinue}
          className="
            inline-flex items-center gap-2
            px-5 sm:px-6 py-3
            bg-accent hover:bg-accent-hover
            text-white font-bold text-sm sm:text-base
            rounded-xl
            shadow-sm hover:shadow-md
            transition-all duration-150
            active:scale-[0.98]
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
          "
          aria-label={`${ctaLabel}「${assignment.story_title}」`}
        >
          <span aria-hidden="true">▶</span>
          <span>{ctaLabel}</span>
        </button>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// ClassroomFallbackHero — shown when student has no active assignment.
// ---------------------------------------------------------------------------

interface ClassroomFallbackHeroProps {
  classroom: StudentEnrolledClassroom;
  onClick: () => void;
}

const ClassroomFallbackHero: React.FC<ClassroomFallbackHeroProps> = ({ classroom, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="
      w-full text-left
      bg-surface-container-lowest border border-[#E5E0D5] rounded-2xl
      p-5 sm:p-6
      flex items-center gap-4
      shadow-editorial
      hover:shadow-md hover:border-accent/40 transition-all duration-150
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
    "
    aria-label={`前往${classroom.name}`}
  >
    <div
      className="
        w-16 h-20 shrink-0
        rounded-sm
        bg-gradient-to-br from-[#F7B76B] via-[#F59E42] to-[#E8841C]
        flex items-center justify-center
        shadow-md
      "
      aria-hidden="true"
    >
      <span className="text-2xl">📖</span>
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-[11px] font-bold tracking-widest text-tertiary-fixed-dim uppercase mb-1">
        繼 續 學 習
      </div>
      <h1 className="text-xl sm:text-2xl font-bold font-headline text-on-surface leading-tight truncate">
        {classroom.name}
      </h1>
      <p className="text-sm text-on-surface-variant mt-0.5">
        老師：{classroom.teacher_name}
      </p>
    </div>
    <div
      className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0 text-accent font-bold"
      aria-hidden="true"
    >
      →
    </div>
  </button>
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
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => navigate('/assignments')}
            className="
              relative text-left
              bg-surface-container-lowest border border-[#E5E0D5] rounded-xl
              p-4 flex items-center gap-3
              transition-all duration-150
              hover:shadow-md hover:border-accent/40 active:scale-[0.99]
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
            "
            aria-label="查看班級作業"
          >
            <span className="text-xl sm:text-2xl" aria-hidden="true">📋</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-on-surface leading-tight">班級作業</p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                {pendingAssignmentCount > 0 ? `${pendingAssignmentCount} 個待完成` : '查看紀錄'}
              </p>
            </div>
            {pendingAssignmentCount > 0 && (
              <span
                className="px-2 py-0.5 rounded-full bg-error/10 text-error text-[11px] font-bold tabular-nums"
                aria-hidden="true"
              >
                {pendingAssignmentCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => navigate('/library')}
            className="
              text-left
              bg-surface-container-lowest border border-[#E5E0D5] rounded-xl
              p-4 flex items-center gap-3
              transition-all duration-150
              hover:shadow-md hover:border-accent/40 active:scale-[0.99]
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
            "
            aria-label="前往圖書館"
          >
            <span className="text-xl sm:text-2xl" aria-hidden="true">📚</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-on-surface leading-tight">圖書館</p>
              <p className="text-xs text-on-surface-variant mt-0.5">探索更多課文</p>
            </div>
          </button>
        </div>

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
