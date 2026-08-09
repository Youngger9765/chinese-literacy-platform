/**
 * AppRoutes — all route definitions for the application.
 *
 * Extracts the <Routes> tree from App.tsx to keep App.tsx under 50 lines.
 * All heavy pages use React.lazy() for route-level code splitting so that
 * only the active route's JS chunk is loaded on demand.
 *
 * ## Learning routes (Issue #1891)
 *
 * The /learn/:storyId nested routes are generated automatically from STEP_CONFIG
 * via `learningRoutes.tsx`.  This eliminates the previous duplication where
 * step order and nextPath were hardcoded here instead of being derived from
 * the single source of truth in stepConfig.ts.
 */
import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import { PublicOnlyRoute, ProtectedRoute, StudentClassroomGuard, LearningRouteGate } from '../components/auth/RouteGuards';
import NoTeacherPage from '../pages/app/NoTeacherPage';
import { AppShell, LearningAppShell } from '../components/layout/AppShell';
import {
  HomePage,
  LibraryPage,
  WritePage,
  ClassroomDetailPage,
  TeacherDashboardPage,
} from '../pages/app/InlinePages';
import PageLoader from '../components/ui/PageLoader';
import { PARENT_PORTAL_ENABLED } from '../config/featureFlags';

// Learning step routes — generated from STEP_CONFIG (Issue #1891)
import { learningRoutes } from './learningRoutes';

// Auth pages — eager-loaded (small, needed immediately on first visit)
import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import ChangePasswordPage from '../pages/ChangePasswordPage';
import ForgotPassword from '../pages/ForgotPassword';
import JunyiCallbackPage from '../pages/JunyiCallbackPage';

// ---------------------------------------------------------------------------
// Route-level code splitting (lazy loading)
// Heavy pages are split into separate JS chunks to reduce initial bundle size.
// Each lazy import becomes its own chunk that loads on demand.
// ---------------------------------------------------------------------------

// Admin page — loaded only for system_admin / org_admin roles
const AdminDashboard = lazy(() => import('../pages/admin/AdminDashboard'));

// Student pages — infrequently accessed, split to reduce initial load
const JoinClassroomPage = lazy(() => import('../pages/JoinClassroomPage'));
const MyAssignments = lazy(() => import('../pages/student/MyAssignments'));
const MyVocabulary = lazy(() => import('../pages/student/MyVocabulary'));
const AchievementsPage = lazy(() => import('../pages/student/AchievementsPage'));
const StudentProfile = lazy(() => import('../pages/student/StudentProfile'));
const SessionHistoryReportPage = lazy(() => import('../pages/student/SessionHistoryReportPage'));
const LearningHistoryPage = lazy(() => import('../pages/student/LearningHistoryPage'));
const PracticeToolbox = lazy(() => import('../pages/student/PracticeToolbox'));
const DictionaryPage = lazy(() => import('../pages/student/DictionaryPage'));

// Parent dashboard — role-specific, split separately
const ParentDashboard = lazy(() => import('../pages/parent/ParentDashboard'));

// New home pages for each role
const StudentHome = lazy(() => import('../pages/student/StudentHome'));
const TeacherHome = lazy(() => import('../pages/teacher/TeacherHome'));
const TeacherMyTextsPage = lazy(() => import('../pages/teacher/TeacherMyTextsPage'));
const TeacherAssignmentsPage = lazy(() => import('../pages/teacher/TeacherAssignmentsPage'));
const TeacherSessionReportPage = lazy(() => import('../pages/teacher/TeacherSessionReportPage'));
const ProjectHubPage = lazy(() => import('../pages/ProjectHubPage'));

// OMO (Online-Merge-Offline) paper worksheet upload (Issue #1343)
const OmoPage = lazy(() => import('../pages/omo/OmoPage'));
const OmoResultStandalonePage = lazy(() => import('../pages/omo/OmoResultStandalonePage'));
const OmoHistoryPage = lazy(() => import('../pages/omo/OmoHistoryPage'));

// Utility pages — rarely visited after first load
const PrivacyPolicy = lazy(() => import('../pages/PrivacyPolicy'));
const HelpPage = lazy(() => import('../pages/HelpPage'));

// ToS consent page (issue #1013)
const TermsOfService = lazy(() => import('../pages/app/TermsOfService'));

// Dev-only local demo harness for AI-extracted lesson_content (public, no API/DB).
const DevLessonPage = lazy(() => import('../pages/dev/DevLessonPage'));


// ---------------------------------------------------------------------------

const AppRoutes: React.FC = () => (
  <Suspense fallback={<PageLoader />}>
    <StudentClassroomGuard>
    <Routes>
      {/* Issue #457: students without classroom see this page when gating is enabled */}
      <Route
        path="/no-teacher"
        element={
          <ProtectedRoute>
            <NoTeacherPage />
          </ProtectedRoute>
        }
      />

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

      {/* Junyi SSO callback — public route, handles the one-time code exchange (issue #1198) */}
      <Route path="/junyi-callback" element={<JunyiCallbackPage />} />

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
        path="/admin/*"
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
        path="/learning-history"
        element={
          <ProtectedRoute>
            <AppShell>
              <LearningHistoryPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/history"
        element={
          <ProtectedRoute>
            <Navigate to="/learning-history" replace />
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
        path="/tools"
        element={
          <ProtectedRoute>
            <AppShell>
              <PracticeToolbox />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/classroom-dashboard"
        element={
          <ProtectedRoute>
            <Navigate to="/assignments" replace />
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
        path="/dictionary"
        element={
          <ProtectedRoute>
            <AppShell>
              <DictionaryPage />
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
      {/* OMO — paper worksheet upload + AI lesson identification (Phase 1, Issue #1343) */}
      <Route
        path="/omo"
        element={
          <ProtectedRoute>
            <OmoPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/omo/result/:uploadId"
        element={
          <ProtectedRoute>
            <OmoResultStandalonePage />
          </ProtectedRoute>
        }
      />
      {/* #1975 — history of past OMO uploads for the current student */}
      <Route
        path="/omo/history"
        element={
          <ProtectedRoute>
            <OmoHistoryPage />
          </ProtectedRoute>
        }
      />

      {/* Learning flow — nested routes under LearningAppShell.
          Step routes are generated from STEP_CONFIG via learningRoutes.tsx (Issue #1891).
          Default index redirects to the first step in DEFAULT_STEP_SEQUENCE. */}
      <Route
        path="/learn/:storyId"
        element={
          /* Not ProtectedRoute: 讀全文-做記號 is reachable from a QR code on
             paper, so an anonymous visitor gets a read-and-listen page there
             instead of a login box (#2649). Every other step still redirects. */
          <LearningRouteGate>
            <LearningAppShell />
          </LearningRouteGate>
        }
      >
        {learningRoutes}
        {/* Default: redirect to reading-annotation (new first step) */}
        <Route index element={<Navigate to="full-text-annotate" replace />} />
      </Route>

      {/* Privacy policy — public, no auth required */}
      <Route path="/privacy" element={<PrivacyPolicy />} />


      {/* Local demo harness for AI-extracted lesson_content — DEV builds only.
          #2505 review #7: don't ship an unauthenticated dev route in the production
          route table (content is public curriculum text, but dev tooling shouldn't
          live on a public prod path). Tree-shaken out of prod bundles. */}
      {import.meta.env.DEV && (
        <>
          <Route path="/dev/lesson" element={<DevLessonPage />} />
          <Route path="/dev/lesson/:code" element={<DevLessonPage />} />
        </>
      )}

      {/* Help / user manual — public, no auth required */}
      <Route path="/help" element={<HelpPage />} />
      <Route path="/hub" element={<ProjectHubPage />} />
      <Route path="/docs" element={<ProjectHubPage />} />

      {/* Catch-all: redirect to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </StudentClassroomGuard>
  </Suspense>
);

export default AppRoutes;
