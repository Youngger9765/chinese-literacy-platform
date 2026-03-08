
import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import { AppView, Story } from './types';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LearningNavProvider, useLearningNav } from './contexts/LearningNavContext';
import { hasRole } from './services/authApi';
import { useAppView } from './hooks/useAppView';
import StepperNav from './components/StepperNav';
import FeedbackButton from './components/FeedbackButton';
import StoryLibrary from './pages/student/StoryLibrary';
import WriteCharacter from './components/stroke-order/WriteCharacter';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import TeacherDashboard from './pages/teacher/TeacherDashboard';
import ClassroomDetail from './pages/teacher/ClassroomDetail';
import AdminDashboard from './pages/admin/AdminDashboard';
import LearningLayout from './layouts/LearningLayout';
import IntroPage from './pages/learning/IntroPage';
import TutorPage from './pages/learning/TutorPage';
import ComprehensionPage from './pages/learning/ComprehensionPage';
import VocabPage from './pages/learning/VocabPage';
import FullReadingPage from './pages/learning/FullReadingPage';
import ReportPage from './pages/learning/ReportPage';
import JoinClassroomPage from './pages/JoinClassroomPage';
import MyAssignments from './pages/student/MyAssignments';

/** Redirect authenticated users away from auth pages. */
const PublicOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-400">載入中...</span>
        </div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

/** Redirect unauthenticated users to /login. */
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-400">載入中...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

/** Home page content — landing page with "進入圖書館" button. */
const HomePage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-6">
      <h1 className="text-5xl font-black text-gray-900">AI 朗讀助教</h1>
      <p className="text-gray-600 max-w-md">準備好開始今天的朗讀挑戰了嗎？</p>
      <button
        onClick={() => navigate('/library')}
        className="bg-accent hover:bg-accent-hover text-white px-10 py-4 rounded-xl font-bold shadow-2xl transition-all"
      >
        進入圖書館
      </button>
    </div>
  );
};

/** Library page — wraps StoryLibrary with navigation. */
const LibraryPage: React.FC = () => {
  const navigate = useNavigate();

  const handleSelectStory = (story: Story) => {
    navigate(`/learn/${story.id}/intro`);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto w-full overflow-y-auto">
      <StoryLibrary onStartReading={handleSelectStory} />
    </div>
  );
};

/** Write character page. */
const WritePage: React.FC = () => {
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
      <p className="text-gray-600 text-sm">輸入一個中文字，開始練習寫字</p>
      <div className="flex gap-3 items-center">
        <input
          type="text"
          value={writeInput}
          onChange={(e) => setWriteInput(e.target.value.slice(-1))}
          placeholder="輸入一個字"
          maxLength={1}
          className="w-24 h-12 text-center text-2xl bg-white border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:border-accent"
        />
        <button
          onClick={() => {
            if (writeInput) setWritingChar(writeInput);
          }}
          disabled={!writeInput}
          className="px-6 h-12 bg-accent hover:bg-accent-hover disabled:bg-gray-300 disabled:text-gray-400 text-white rounded-lg font-bold transition-all"
        >
          開始
        </button>
      </div>
      <div className="flex gap-2 flex-wrap justify-center max-w-md">
        {['你', '好', '我', '大', '小', '中', '人', '天', '學', '是'].map((ch) => (
          <button
            key={ch}
            onClick={() => setWritingChar(ch)}
            className="w-12 h-12 bg-gray-100 hover:bg-gray-200 text-gray-900 text-xl rounded-lg border border-gray-200 transition-colors"
          >
            {ch}
          </button>
        ))}
      </div>
    </div>
  );
};

/** Teacher classroom detail page — extracts classroomId from URL params. */
const ClassroomDetailPage: React.FC = () => {
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
const TeacherDashboardPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <TeacherDashboard
      onSelectClassroom={(id) => navigate(`/teacher/classroom/${id}`)}
    />
  );
};

/** The authenticated app shell with header. */
const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const currentView = useAppView();
  const { session: navSession, selectedStory: navStory } = useLearningNav();

  const handleStepperNavigate = (view: AppView) => {
    // Map AppView back to route paths for StepperNav clicks
    switch (view) {
      case AppView.HOME:
        navigate('/');
        break;
      case AppView.LIBRARY:
        navigate('/library');
        break;
      // Learning step navigation: extract storyId from current URL
      case AppView.INTRO:
      case AppView.TUTOR:
      case AppView.COMPREHENSION:
      case AppView.VOCAB:
      case AppView.FULL_READING:
      case AppView.REPORT: {
        const match = window.location.pathname.match(/\/learn\/([^/]+)/);
        const storyId = match?.[1];
        if (storyId) {
          const stepPath: Record<string, string> = {
            [AppView.INTRO]: 'intro',
            [AppView.TUTOR]: 'tutor',
            [AppView.COMPREHENSION]: 'comprehension',
            [AppView.VOCAB]: 'vocab',
            [AppView.FULL_READING]: 'full-reading',
            [AppView.REPORT]: 'report',
          };
          navigate(`/learn/${storyId}/${stepPath[view]}`);
        }
        break;
      }
      default:
        break;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-amber-50 text-gray-900 font-sans overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 h-12 flex items-center justify-between px-4 shrink-0">
        {/* Logo */}
        <div
          className="flex items-center gap-2 cursor-pointer shrink-0"
          onClick={() => navigate('/')}
        >
          <div className="bg-accent w-6 h-6 rounded flex items-center justify-center">
            <span className="text-white font-bold text-xs">L</span>
          </div>
          <span className="text-sm font-bold text-gray-800 hidden sm:block">AI Reading Tutor</span>
        </div>

        {![AppView.ADMIN_DASHBOARD, AppView.TEACHER_DASHBOARD, AppView.CLASSROOM_DETAIL, AppView.MY_ASSIGNMENTS].includes(currentView) && (
          <StepperNav
            currentView={currentView}
            session={navSession}
            selectedStory={navStory}
            onNavigate={handleStepperNavigate}
          />
        )}

        {/* Nav links + User info + Logout */}
        <div className="flex items-center gap-3 shrink-0">
          {hasRole(user, 'teacher', 'system_admin', 'principal', 'director') && (
            <button
              onClick={() => navigate('/teacher')}
              className={`text-xs font-medium transition-colors cursor-pointer ${
                currentView === AppView.TEACHER_DASHBOARD ||
                currentView === AppView.CLASSROOM_DETAIL
                  ? 'text-accent'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              班級管理
            </button>
          )}
          {!hasRole(user, 'teacher', 'system_admin', 'principal', 'director', 'org_owner', 'org_admin') && (
            <>
              <button
                onClick={() => navigate('/assignments')}
                className={`text-xs font-medium transition-colors cursor-pointer ${
                  currentView === AppView.MY_ASSIGNMENTS
                    ? 'text-accent'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                作業
              </button>
              <button
                onClick={() => navigate('/join')}
                className="text-xs font-medium transition-colors cursor-pointer text-gray-500 hover:text-gray-700"
              >
                加入班級
              </button>
            </>
          )}
          {hasRole(user, 'system_admin', 'org_owner', 'org_admin') && (
            <button
              onClick={() => navigate('/admin')}
              className={`text-xs font-medium transition-colors cursor-pointer ${
                currentView === AppView.ADMIN_DASHBOARD
                  ? 'text-accent'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              系統管理
            </button>
          )}
          <div className="w-px h-4 bg-gray-200" />
          {user && (
            <span className="text-xs text-gray-500 hidden sm:block">{user.name}</span>
          )}
          <button
            onClick={logout}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            登出
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col overflow-hidden">{children}</main>

      {/* Feedback button — visible to all authenticated users */}
      <FeedbackButton />
    </div>
  );
};

/**
 * AppShell wrapper specifically for the learning flow.
 * Passes session and selectedStory to StepperNav via LearningLayout context.
 */
const LearningAppShell: React.FC = () => {
  return (
    <AppShell>
      <LearningLayout />
    </AppShell>
  );
};

/** Root component with router and auth. */
const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LearningNavProvider>
        <Routes>
          {/* Public-only routes (redirect to / if already logged in) */}
          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <LoginPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/register"
            element={
              <PublicOnlyRoute>
                <RegisterPage />
              </PublicOnlyRoute>
            }
          />

          {/* Change password (after first login) */}
          <Route
            path="/change-password"
            element={
              <ProtectedRoute>
                <ChangePasswordPage />
              </ProtectedRoute>
            }
          />

          {/* Protected routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppShell>
                  <HomePage />
                </AppShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/library"
            element={
              <ProtectedRoute>
                <AppShell>
                  <LibraryPage />
                </AppShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/write"
            element={
              <ProtectedRoute>
                <AppShell>
                  <WritePage />
                </AppShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher"
            element={
              <ProtectedRoute>
                <AppShell>
                  <TeacherDashboardPage />
                </AppShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/classroom/:id"
            element={
              <ProtectedRoute>
                <AppShell>
                  <ClassroomDetailPage />
                </AppShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AppShell>
                  <AdminDashboard />
                </AppShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/assignments"
            element={
              <ProtectedRoute>
                <AppShell>
                  <MyAssignments />
                </AppShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/join"
            element={
              <ProtectedRoute>
                <JoinClassroomPage />
              </ProtectedRoute>
            }
          />

          {/* Learning flow — nested routes under LearningLayout */}
          <Route
            path="/learn/:storyId"
            element={
              <ProtectedRoute>
                <LearningAppShell />
              </ProtectedRoute>
            }
          >
            <Route path="intro" element={<IntroPage />} />
            <Route path="tutor" element={<TutorPage />} />
            <Route path="comprehension" element={<ComprehensionPage />} />
            <Route path="vocab" element={<VocabPage />} />
            <Route path="full-reading" element={<FullReadingPage />} />
            <Route path="report" element={<ReportPage />} />
            {/* Default: redirect to intro */}
            <Route index element={<Navigate to="intro" replace />} />
          </Route>

          {/* Catch-all: redirect to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </LearningNavProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
