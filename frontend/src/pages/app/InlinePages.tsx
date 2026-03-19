/**
 * Small inline page components that are too lightweight to warrant their own
 * file but too domain-specific to live in App.tsx.
 *
 * - HomePage       — role-based redirect to teacher/student/library
 * - LibraryPage    — student library with resume prompt + dashboard
 * - WritePage      — standalone character writing practice
 * - ClassroomDetailPage  — resolves :id param and renders ClassroomDetail
 * - TeacherDashboardPage — thin wrapper around TeacherDashboard
 * - OnboardingWrapper    — first-time student onboarding overlay
 */
import React, { Suspense, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { lazy } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { hasRole } from '../../services/authApi';
import StoryLibrary from '../student/StoryLibrary';
import WriteCharacter from '../../components/stroke-order/WriteCharacter';
import SessionResumePrompt from '../../components/SessionResumePrompt';
import StudentProgressDashboard from '../../components/student/StudentProgressDashboard';
import RecommendedStories from '../../components/student/RecommendedStories';
import { Story } from '../../types';

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
  const { user, isAuthenticated, isLoading } = useAuth();

  // Wait for auth to resolve before redirecting — prevents flash on load
  if (isLoading || !isAuthenticated) return null;

  if (hasRole(user, 'teacher', 'system_admin', 'principal', 'director', 'org_owner', 'org_admin', 'homeroom_teacher')) {
    return <Navigate to="/teacher-home" replace />;
  }

  return <Navigate to="/student" replace />;
};

/** Library page — wraps StoryLibrary with dashboard + session resume prompt. */
export const LibraryPage: React.FC = () => {
  const navigate = useNavigate();
  const [showResumePrompt, setShowResumePrompt] = React.useState(true);
  const [completedSlugs, setCompletedSlugs] = React.useState<string[]>([]);

  const handleSelectStory = (story: Story) => {
    navigate(`/learn/${story.id}/intro`);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto w-full overflow-y-auto">
      {showResumePrompt && (
        <SessionResumePrompt onDismiss={() => setShowResumePrompt(false)} />
      )}
      <div className="min-h-[120px]">
        <StudentProgressDashboard onDashboardLoaded={setCompletedSlugs} />
      </div>
      <div className="mt-6 min-h-[200px]">
        <RecommendedStories />
      </div>
      <StoryLibrary onStartReading={handleSelectStory} completedSlugs={completedSlugs} />
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
