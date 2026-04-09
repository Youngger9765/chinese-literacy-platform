/**
 * AppRoutes — all route definitions for the application.
 *
 * Extracts the <Routes> tree from App.tsx to keep App.tsx under 50 lines.
 * All heavy pages use React.lazy() for route-level code splitting so that
 * only the active route's JS chunk is loaded on demand.
 */
import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';

import { PublicOnlyRoute, ProtectedRoute } from '../components/auth/RouteGuards';
import { AppShell, LearningAppShell } from '../components/layout/AppShell';
import StepErrorBoundary from '../components/StepErrorBoundary';
import {
  HomePage,
  LibraryPage,
  WritePage,
  ClassroomDetailPage,
  TeacherDashboardPage,
} from '../pages/app/InlinePages';
import PageLoader from '../components/ui/PageLoader';
import { PARENT_PORTAL_ENABLED } from '../config/featureFlags';

// Auth pages — eager-loaded (small, needed immediately on first visit)
import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import ChangePasswordPage from '../pages/ChangePasswordPage';
import ForgotPassword from '../pages/ForgotPassword';

// ---------------------------------------------------------------------------
// Route-level code splitting (lazy loading)
// Heavy pages are split into separate JS chunks to reduce initial bundle size.
// Each lazy import becomes its own chunk that loads on demand.
// ---------------------------------------------------------------------------

// Admin page — loaded only for system_admin / org_admin roles
const AdminDashboard = lazy(() => import('../pages/admin/AdminDashboard'));

// Learning step pages — split per step so only the active step's code loads
const IntroPage = lazy(() => import('../pages/learning/IntroPage'));
const TutorPage = lazy(() => import('../pages/learning/TutorPage'));
const ComprehensionPage = lazy(() => import('../pages/learning/ComprehensionPage'));
const VocabPage = lazy(() => import('../pages/learning/VocabPage'));
const DictationPage = lazy(() => import('../pages/learning/DictationPage'));
const ListeningPage = lazy(() => import('../pages/learning/ListeningPage'));
const FullReadingPage = lazy(() => import('../pages/learning/FullReadingPage'));
const ReportPage = lazy(() => import('../pages/learning/ReportPage'));
// 三民 steps (Issue #676)
const ReadingAnnotationPage = lazy(() => import('../pages/learning/ReadingAnnotationPage'));
const VocabApplicationPage = lazy(() => import('../pages/learning/VocabApplicationPage'));
const VocabDefinitionMatchPage = lazy(() => import('../pages/learning/VocabDefinitionMatchPage'));
const VocabWordSearchPage = lazy(() => import('../pages/learning/VocabWordSearchPage'));
const KnowledgeStationPage = lazy(() => import('../pages/learning/KnowledgeStationPage'));

// Student pages — infrequently accessed, split to reduce initial load
const JoinClassroomPage = lazy(() => import('../pages/JoinClassroomPage'));
const MyAssignments = lazy(() => import('../pages/student/MyAssignments'));
const MyVocabulary = lazy(() => import('../pages/student/MyVocabulary'));
const AchievementsPage = lazy(() => import('../pages/student/AchievementsPage'));
const StudentClassroomDashboard = lazy(() => import('../pages/student/StudentClassroomDashboard'));
const StudentProfile = lazy(() => import('../pages/student/StudentProfile'));
const SessionHistoryReportPage = lazy(() => import('../pages/student/SessionHistoryReportPage'));

// Parent dashboard — role-specific, split separately
const ParentDashboard = lazy(() => import('../pages/parent/ParentDashboard'));

// New home pages for each role
const StudentHome = lazy(() => import('../pages/student/StudentHome'));
const TeacherHome = lazy(() => import('../pages/teacher/TeacherHome'));
const TeacherMyTextsPage = lazy(() => import('../pages/teacher/TeacherMyTextsPage'));
const TeacherAssignmentsPage = lazy(() => import('../pages/teacher/TeacherAssignmentsPage'));
const TeacherSessionReportPage = lazy(() => import('../pages/teacher/TeacherSessionReportPage'));
const ProjectHubPage = lazy(() => import('../pages/ProjectHubPage'));

// Utility pages — rarely visited after first load
const PrivacyPolicy = lazy(() => import('../pages/PrivacyPolicy'));
const HelpPage = lazy(() => import('../pages/HelpPage'));

// ToS consent page (issue #1013)
const TermsOfService = lazy(() => import('../pages/app/TermsOfService'));

// ---------------------------------------------------------------------------
// StepRoute — wraps a learning step page in StepErrorBoundary.
// The `nextPath` prop wires the "跳過此步驟" button to navigate to the next step.
// ---------------------------------------------------------------------------

interface StepRouteProps {
  stepLabel: string;
  nextPath?: string;
  children: React.ReactNode;
}

const StepRoute: React.FC<StepRouteProps> = ({ stepLabel, nextPath, children }) => {
  const navigate = useNavigate();
  const handleSkip = nextPath ? () => navigate(nextPath, { replace: true }) : undefined;

  return (
    <StepErrorBoundary stepLabel={stepLabel} onSkip={handleSkip}>
      {children}
    </StepErrorBoundary>
  );
};

// ---------------------------------------------------------------------------

const AppRoutes: React.FC = () => (
  <Suspense fallback={<PageLoader />}>
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
      <Route
        path="/forgot-password"
        element={
          <PublicOnlyRoute>
            <ForgotPassword />
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

      {/* Terms of Service consent — shown to all new users before accessing the app (issue #1013) */}
      <Route
        path="/terms"
        element={
          <ProtectedRoute>
            <TermsOfService />
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
        path="/student"
        element={
          <ProtectedRoute>
            <AppShell>
              <StudentHome />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher-home"
        element={
          <ProtectedRoute>
            <AppShell>
              <TeacherHome />
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
        path="/teacher/my-texts"
        element={
          <ProtectedRoute>
            <AppShell>
              <TeacherMyTextsPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/assignments"
        element={
          <ProtectedRoute>
            <AppShell>
              <TeacherAssignmentsPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/students/:studentId/sessions/:sessionId/report"
        element={
          <ProtectedRoute>
            <AppShell>
              <TeacherSessionReportPage />
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
      {PARENT_PORTAL_ENABLED && (
        <Route
          path="/parent"
          element={
            <ProtectedRoute>
              <AppShell>
                <ParentDashboard />
              </AppShell>
            </ProtectedRoute>
          }
        />
      )}
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
        path="/history"
        element={
          <ProtectedRoute>
            <Navigate to="/assignments" replace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/progress"
        element={
          <ProtectedRoute>
            <Navigate to="/assignments" replace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/achievements"
        element={
          <ProtectedRoute>
            <AppShell>
              <AchievementsPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/classroom-dashboard"
        element={
          <ProtectedRoute>
            <AppShell>
              <StudentClassroomDashboard />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <AppShell>
              <StudentProfile />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/sessions/:sessionId/report"
        element={
          <ProtectedRoute>
            <AppShell>
              <SessionHistoryReportPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/sessions/:sessionId/dialogue"
        element={
          <ProtectedRoute>
            <Navigate to="/assignments" replace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/vocabulary"
        element={
          <ProtectedRoute>
            <AppShell>
              <MyVocabulary />
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
        <Route path="intro" element={<Navigate to="../reading-annotation" replace />} />
        <Route
          path="reading-annotation"
          element={
            <StepRoute stepLabel="讀全文-做記號" nextPath="tutor">
              <ReadingAnnotationPage />
            </StepRoute>
          }
        />
        <Route
          path="tutor"
          element={
            <StepRoute stepLabel="逐段朗讀" nextPath="full-reading">
              <TutorPage />
            </StepRoute>
          }
        />
        <Route
          path="full-reading"
          element={
            <StepRoute stepLabel="全文朗讀" nextPath="vocab">
              <FullReadingPage />
            </StepRoute>
          }
        />
        <Route
          path="vocab"
          element={
            <StepRoute stepLabel="生字練習" nextPath="vocab-definition">
              <VocabPage />
            </StepRoute>
          }
        />
        <Route
          path="vocab-definition"
          element={
            <StepRoute stepLabel="詞語定義" nextPath="vocab-application">
              <VocabDefinitionMatchPage />
            </StepRoute>
          }
        />
        <Route
          path="vocab-application"
          element={
            <StepRoute stepLabel="語詞應用" nextPath="comprehension">
              <VocabApplicationPage />
            </StepRoute>
          }
        />
        <Route
          path="comprehension"
          element={
            <StepRoute stepLabel="課文理解" nextPath="vocab-word-search">
              <ComprehensionPage />
            </StepRoute>
          }
        />
        <Route
          path="dictation"
          element={
            <StepRoute stepLabel="聽寫練習" nextPath="vocab-word-search">
              <DictationPage />
            </StepRoute>
          }
        />
        <Route
          path="vocab-word-search"
          element={
            <StepRoute stepLabel="語詞複習" nextPath="knowledge-station">
              <VocabWordSearchPage />
            </StepRoute>
          }
        />
        <Route
          path="listening"
          element={
            <StepRoute stepLabel="聽力練習" nextPath="report">
              <ListeningPage />
            </StepRoute>
          }
        />
        <Route
          path="knowledge-station"
          element={
            <StepRoute stepLabel="知識站" nextPath="report">
              <KnowledgeStationPage />
            </StepRoute>
          }
        />
        <Route
          path="report"
          element={
            <StepRoute stepLabel="學習報告">
              <ReportPage />
            </StepRoute>
          }
        />
        {/* Default: redirect to reading-annotation (new first step) */}
        <Route index element={<Navigate to="reading-annotation" replace />} />
      </Route>

      {/* Privacy policy — public, no auth required */}
      <Route path="/privacy" element={<PrivacyPolicy />} />

      {/* Help / user manual — public, no auth required */}
      <Route path="/help" element={<HelpPage />} />
      <Route path="/hub" element={<ProjectHubPage />} />
      <Route path="/docs" element={<ProjectHubPage />} />

      {/* Catch-all: redirect to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </Suspense>
);

export default AppRoutes;
