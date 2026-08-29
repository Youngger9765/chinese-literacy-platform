/**
 * Small inline page components that are too lightweight to warrant their own
 * file but too domain-specific to live in App.tsx.
 *
 * - HomePage       — role-based redirect to teacher/student/library
 * - LibraryPage    — student library with story browsing
 * - WritePage      — standalone character writing practice
 * - ClassroomDetailPage  — resolves :id param and renders ClassroomDetail
 * - TeacherDashboardPage — thin wrapper around TeacherDashboard
 * - OnboardingWrapper    — first-time student onboarding overlay
 */
import React, { Suspense, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { lazy } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { hasRole } from '../../services/authApi';
import { clearActiveSession } from '../../services/api';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { PARENT_PORTAL_ENABLED } from '../../config/featureFlags';
import { scopedStepStorageKey } from '../../services/learningStorageScope';
import StoryLibrary from '../student/StoryLibrary';
import WriteCharacter from '../../components/stroke-order/WriteCharacter';
import SessionResumePrompt from '../../components/SessionResumePrompt';

const ACTIVE_ASSIGNMENT_CONTEXT_KEY = 'activeAssignmentContext';
const ASSIGNMENT_DB_SESSION_KEY_PREFIX = 'assignment-db-session-';
const SELF_DB_SESSION_KEY_PREFIX = 'self-db-session-';
const SELF_PRACTICE_COMPLETED_KEY_PREFIX = 'self-practice-completed-';
const SELF_PRACTICE_SCOPED_KEY_PREFIXES = [
  'tutor_completed_',
  'liveTutor_progress_',
  'annotations_',
  'comprehension_completion_',
  'vocabPractice_progress_',
  'vocabDef_progress_',
  'wordSearch_progress_',
  'knowledge_viewed_',
  'fullReading_progress_',
  'report_viewed_',
];

// Lazy-loaded — only needed when route is active
const ClassroomDetail = lazy(() => import('../teacher/ClassroomDetail'));
const TeacherDashboard = lazy(() => import('../teacher/TeacherDashboard'));
const OnboardingGuide = lazy(() => import('../../components/OnboardingGuide'));

/**
 * Home page — redirects to the appropriate home based on user role.
 * Teacher → /teacher-home, Student → /student, else → /library
 * Returns null while auth is loading to prevent flash redirects.
 */
export const HomePage: React.FC = () => {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading || !isAuthenticated) return null;
  // Wait for roles to hydrate before redirecting.
  if (!user?.roles || user.roles.length === 0) return null;

  // Derive redirect target directly from user.roles instead of reading
  // WorkspaceContext.activeView — that state re-syncs via useEffect, which
  // runs AFTER HomePage's first render, causing admins to briefly see
  // activeView='student' (the empty-set fallback) and land on the wrong
  // route. Reading user.roles directly sidesteps the race entirely.
  const ADMIN_ROLES = new Set(['system_admin', 'org_owner', 'org_admin']);
  const TEACHER_ROLES = new Set(['teacher', 'homeroom_teacher', 'principal', 'director']);

  let target = '/student';
  if (user.roles.some((r) => ADMIN_ROLES.has(r.role_name))) target = '/admin';
  else if (user.roles.some((r) => TEACHER_ROLES.has(r.role_name))) target = '/teacher-home';
  else if (user.roles.some((r) => r.role_name === 'student')) target = '/student';
  else if (PARENT_PORTAL_ENABLED && user.roles.some((r) => r.role_name === 'parent')) target = '/parent';

  return <Navigate to={target} replace />;
};

/** Library page — clean story browsing with session resume prompt. */
export const LibraryPage: React.FC = () => {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [searchParams] = useSearchParams();
  const classroomId = searchParams.get('classroom');
  const classroomIdNum = classroomId ? parseInt(classroomId, 10) : null;
  const [showResumePrompt, setShowResumePrompt] = useState(true);

  const clearAssignmentContext = (storyId: string) => {
    try {
      const raw = sessionStorage.getItem(ACTIVE_ASSIGNMENT_CONTEXT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { storyKey?: string | null };
        if (String(parsed.storyKey ?? '') === String(storyId)) {
          const keysToRemove: string[] = [];
          for (let i = 0; i < sessionStorage.length; i += 1) {
            const key = sessionStorage.key(i);
            if (!key) continue;
            if (!key.startsWith(ASSIGNMENT_DB_SESSION_KEY_PREFIX)) continue;
            if (key === `${ASSIGNMENT_DB_SESSION_KEY_PREFIX}${storyId}` || key.endsWith(`-${storyId}`)) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach((key) => sessionStorage.removeItem(key));
          sessionStorage.removeItem(`db-session-${storyId}`);
        }
      }
    } catch {
      // non-fatal
    }

    try { sessionStorage.removeItem('activeAssignmentId'); } catch { /* non-fatal */ }
    try { sessionStorage.removeItem('activeAssignmentGoals'); } catch { /* non-fatal */ }
    try { sessionStorage.removeItem(ACTIVE_ASSIGNMENT_CONTEXT_KEY); } catch { /* non-fatal */ }
  };

  const clearSelfPracticeProgress = (storyId: string) => {
    try { sessionStorage.removeItem(`${SELF_DB_SESSION_KEY_PREFIX}${storyId}`); } catch { /* non-fatal */ }
    try { sessionStorage.removeItem(`db-session-${storyId}`); } catch { /* non-fatal */ }
    for (const prefix of SELF_PRACTICE_SCOPED_KEY_PREFIXES) {
      try { localStorage.removeItem(scopedStepStorageKey(prefix, storyId)); } catch { /* non-fatal */ }
    }
    // Legacy keys cleanup to avoid carrying pre-scope progress forward.
    try { localStorage.removeItem(`tutor_completed_${storyId}`); } catch { /* non-fatal */ }
    try { localStorage.removeItem(`liveTutor_progress_${storyId}`); } catch { /* non-fatal */ }
    try { localStorage.removeItem(`${SELF_PRACTICE_COMPLETED_KEY_PREFIX}${storyId}`); } catch { /* non-fatal */ }
    if (user) {
      clearActiveSession(String(user.id));
    }
  };

  const cleanupAssignmentScopedProgressKeys = (storyId: string) => {
    const assignmentScopedFragment = `${storyId}__a_`;
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (!key.includes(assignmentScopedFragment)) continue;
      if (!SELF_PRACTICE_SCOPED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
      keysToRemove.push(key);
    }

    keysToRemove.forEach((key) => {
      try { localStorage.removeItem(key); } catch { /* non-fatal */ }
    });
  };

  const handleSelectStory = (story: { id: string }) => {
    clearAssignmentContext(story.id);
    cleanupAssignmentScopedProgressKeys(story.id);
    navigate(`/learn/${story.id}/lesson-intro`);
  };

  const handleClearProgress = (storyId: string) => {
    clearSelfPracticeProgress(storyId);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto w-full overflow-y-auto">
      {showResumePrompt && (
        <SessionResumePrompt onDismiss={() => setShowResumePrompt(false)} />
      )}
      <div className="mt-4">
        <StoryLibrary
          onStartReading={handleSelectStory}
          classroomId={classroomIdNum}
          onClearProgress={handleClearProgress}
        />
      </div>
    </div>
  );
};

/** Write character page. */
export const WritePage: React.FC = () => {
  const [writingChar, setWritingChar] = useState('');
  const [writeInput, setWriteInput] = useState('');

  if (writingChar) {
    return (
      <WriteCharacter
        character={writingChar}
        onComplete={() => setWritingChar('')}
        onBack={() => setWritingChar('')}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
      <h2 className="text-2xl font-bold text-gray-900">寫字練習</h2>
      <p className="text-gray-600 text-sm" id="write-hint">輸入一個中文字，開始練習寫字</p>
      <div className="flex gap-3 items-center">
        <label htmlFor="write-input" className="sr-only">輸入一個中文字</label>
        <input
          id="write-input"
          type="text"
          value={writeInput}
          onChange={(e) => setWriteInput(e.target.value.slice(-1))}
          placeholder="輸入一個字"
          maxLength={1}
          aria-describedby="write-hint"
          className="w-24 h-12 text-center text-2xl bg-white border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
        />
        <button
          type="button"
          onClick={() => {
            if (writeInput) setWritingChar(writeInput);
          }}
          disabled={!writeInput}
          aria-disabled={!writeInput}
          className="px-6 h-12 bg-accent hover:bg-accent-hover disabled:bg-gray-300 disabled:text-gray-400 text-white rounded-lg font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          開始
        </button>
      </div>
      <div
        className="flex gap-2 flex-wrap justify-center max-w-md"
        role="group"
        aria-label="常用練習字"
      >
        {['你', '好', '我', '大', '小', '中', '人', '天', '學', '是'].map((ch) => (
          <button
            key={ch}
            type="button"
            onClick={() => setWritingChar(ch)}
            aria-label={`練習「${ch}」字`}
            className="w-12 h-12 bg-gray-100 hover:bg-gray-200 text-gray-900 text-xl rounded-lg border border-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
          >
            {ch}
          </button>
        ))}
      </div>
    </div>
  );
};

/** Teacher classroom detail page — extracts classroomId from URL params. */
export const ClassroomDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const classroomId = id ? parseInt(id, 10) : null;

  if (classroomId == null || isNaN(classroomId)) {
    return <Navigate to="/teacher" replace />;
  }

  return (
    <ClassroomDetail
      classroomId={classroomId}
      onBack={() => navigate('/teacher')}
    />
  );
};

/** Teacher dashboard page — wraps TeacherDashboard with navigation. */
export const TeacherDashboardPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <TeacherDashboard
      onSelectClassroom={(id) => navigate(`/teacher/classroom/${id}`)}
    />
  );
};

/** Onboarding overlay — shown once for students who haven't completed onboarding. */
export const OnboardingWrapper: React.FC = () => {
  const { user, token, refreshUser } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  const isStudent =
    user !== null &&
    !hasRole(user, 'teacher', 'system_admin', 'principal', 'director', 'org_owner', 'org_admin', 'homeroom_teacher');

  const shouldShow = isStudent && user !== null && !user.onboarding_completed && !dismissed;

  if (!shouldShow || !token) return null;

  return (
    <OnboardingGuide
      userName={user.name}
      token={token}
      onComplete={() => {
        setDismissed(true);
        refreshUser();
      }}
    />
  );
};
